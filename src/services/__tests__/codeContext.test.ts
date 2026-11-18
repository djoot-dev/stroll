import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import {
  buildPRSymbolIndex,
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
})
