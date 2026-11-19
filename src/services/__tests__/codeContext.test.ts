import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import {
  buildPRSymbolIndex,
  extractImportedSymbolNames,
  findImportBindingForSymbol,
  findImportSpecifierForSymbol,
  getEnclosingScope,
  getReplacedLinesForAddedLine,
  resolveHoverSymbol,
  resolveHoverSymbolWithRepoFallback,
} from '@/services/codeContext'
import { buildDiffSegments } from '@/services/diffParser'

describe('codeContext', () => {
  it('indexes PR symbols, detects modified definitions, and finds cross-file usages', () => {
    const index = buildPRSymbolIndex(MOCK_PR.files)
    const dispatcherFile = MOCK_PR.files.find((f) =>
      f.path.endsWith('webhookDispatcher.ts'),
    )!

    const info = resolveHoverSymbol('WebhookEndpoint', dispatcherFile, MOCK_PR.files, index)
    expect(info).not.toBeNull()
    expect(info?.declaration.path).toBe('src/types/webhook.ts')
    expect(info?.declaration.isModifiedInPR).toBe(true)
    expect(info?.declaration.baseSnippet).toContain('enabled: boolean')
    expect(info?.declaration.headSnippet).toContain('maxRequestsPerMinute: number')
    expect(info?.isSameFile).toBe(false)
    expect(info?.usages.length).toBeGreaterThanOrEqual(2)
  })

  it('computes enclosing scope breadcrumbs for nested methods', () => {
    const dispatcherFile = MOCK_PR.files.find((f) =>
      f.path.endsWith('webhookDispatcher.ts'),
    )!
    // Line 35 is inside WebhookDispatcher.dispatch(...)
    const scopes = getEnclosingScope(dispatcherFile, 35)
    expect(scopes).toEqual(['class WebhookDispatcher', 'dispatch()'])
  })

  it('finds preceding deleted lines for an added line in a hunk', () => {
    const dispatcherFile = MOCK_PR.files.find((f) =>
      f.path.endsWith('webhookDispatcher.ts'),
    )!
    const segments = buildDiffSegments(dispatcherFile)
    const hunk = segments.find((s) => s.kind === 'hunk')!
    const addIdx = hunk.lines.findIndex(
      (l) => l.type === 'add' && l.content.includes('RetryPolicy'),
    )
    const replaced = getReplacedLinesForAddedLine(hunk.lines, addIdx)
    expect(replaced.length).toBe(1)
    expect(replaced[0]).toContain("from '../types/webhook'")
  })

  it('extracts import specifiers for TS, Python, and Rust symbols', () => {
    const tsSrc = `import { Foo, Bar as Baz } from '@/types/pr'\nimport DefaultThing from '../utils/thing'`
    expect(findImportSpecifierForSymbol(tsSrc, 'Foo')).toBe('@/types/pr')
    expect(findImportSpecifierForSymbol(tsSrc, 'DefaultThing')).toBe('../utils/thing')

    const pySrc = `from app.models.user import UserAccount`
    expect(findImportSpecifierForSymbol(pySrc, 'UserAccount')).toBe('app.models.user')

    const rsSrc = `use crate::commands::git::GitBlameInfo;`
    expect(findImportSpecifierForSymbol(rsSrc, 'GitBlameInfo')).toBe('crate::commands::git')
  })

  it('falls back gracefully in browser mode for resolveHoverSymbolWithRepoFallback', async () => {
    const index = buildPRSymbolIndex(MOCK_PR.files)
    const dispatcherFile = MOCK_PR.files.find((f) =>
      f.path.endsWith('webhookDispatcher.ts'),
    )!

    // Fast path still resolves PR symbols
    const prHit = await resolveHoverSymbolWithRepoFallback(
      'WebhookEndpoint',
      dispatcherFile,
      MOCK_PR.files,
      index,
      '/tmp/fake-repo',
    )
    expect(prHit?.declaration.path).toBe('src/types/webhook.ts')

    // Unknown symbol returns null safely without __TAURI_INTERNALS__
    const miss = await resolveHoverSymbolWithRepoFallback(
      'NonExistentExternalSymbol',
      dispatcherFile,
      MOCK_PR.files,
      index,
      '/tmp/fake-repo',
    )
    expect(miss).toBeNull()
  })

  it('indexes C# declarations with XML doc comments, computes C# scopes, and parses using directives', () => {
    const csModelFile = {
      path: 'src/Models/OrderSummary.cs',
      status: 'added' as const,
      additions: 15,
      deletions: 0,
      patch: '',
      baseContent: null,
      headContent: `namespace MyApp.Models;

/// <summary>
/// Immutable order summary DTO.
/// </summary>
public sealed record OrderSummary(string Id, decimal Total);

/// <summary>
/// Order status lifecycle.
/// </summary>
public enum OrderStatus
{
    Pending,
    Shipped
}`,
      language: 'csharp',
    }

    const csServiceFile = {
      path: 'src/Services/OrderService.cs',
      status: 'modified' as const,
      additions: 12,
      deletions: 1,
      patch: '',
      baseContent: '',
      headContent: `using System;
using MyApp.Models;

namespace MyApp.Services
{
    public sealed partial class OrderService
    {
        public async Task<OrderSummary> CreateOrderAsync(string id)
        {
            var summary = new OrderSummary(id, 10m);
            return summary;
        }
    }
}`,
      language: 'csharp',
    }

    const files = [csModelFile, csServiceFile]
    const index = buildPRSymbolIndex(files)

    const resolved = resolveHoverSymbol('OrderSummary', csServiceFile, files, index)
    expect(resolved).not.toBeNull()
    expect(resolved?.declaration.path).toBe('src/Models/OrderSummary.cs')
    expect(resolved?.declaration.kind).toBe('class')
    expect(resolved?.declaration.docComment).toContain('Immutable order summary DTO.')

    const enumResolved = resolveHoverSymbol('OrderStatus', csServiceFile, files, index)
    expect(enumResolved?.declaration.kind).toBe('enum')

    // Line 10 is inside CreateOrderAsync inside OrderService inside namespace MyApp.Services
    const scopes = getEnclosingScope(csServiceFile, 10)
    expect(scopes).toEqual(['namespace MyApp.Services', 'class OrderService', 'CreateOrderAsync()'])

    // C# `using` import specifier resolution
    expect(findImportSpecifierForSymbol(csServiceFile.headContent, 'OrderSummary')).toBe(
      'MyApp.Models',
    )
    expect(
      findImportSpecifierForSymbol('using static MyApp.Utils.HashHelper;', 'HashHelper'),
    ).toBe('MyApp.Utils.HashHelper')
  })

  it('extracts imported symbol names, resolves aliased import bindings, and indexes Vue components', () => {
    const vueSrc = `<script setup lang="ts">
import ActionCard from '@ui/ActionCard.vue'
import {
  useSession,
  type UserProfile as ProfileDTO,
} from '~/composables/useSession'
</script>`

    const imported = extractImportedSymbolNames(vueSrc)
    expect(imported.has('ActionCard')).toBe(true)
    expect(imported.has('useSession')).toBe(true)
    expect(imported.has('ProfileDTO')).toBe(true)

    expect(findImportBindingForSymbol(vueSrc, 'ActionCard')).toEqual({
      specifier: '@ui/ActionCard.vue',
      importedName: 'ActionCard',
    })
    expect(findImportBindingForSymbol(vueSrc, 'ProfileDTO')).toEqual({
      specifier: '~/composables/useSession',
      importedName: 'UserProfile',
    })

    const index = buildPRSymbolIndex(MOCK_PR.files)
    const appFile = {
      path: 'src/App.vue',
      status: 'modified' as const,
      additions: 1,
      deletions: 0,
      patch: '',
      baseContent: '',
      headContent: `<script setup lang="ts">\nimport WebhookEndpointCard from '@/components/WebhookEndpointCard.vue'\n</script>`,
      language: 'vue',
    }
    const vueHit = resolveHoverSymbol('WebhookEndpointCard', appFile, MOCK_PR.files, index)
    expect(vueHit).not.toBeNull()
    expect(vueHit?.declaration.kind).toBe('component')
    expect(vueHit?.declaration.path).toBe('src/components/WebhookEndpointCard.vue')
  })
})
