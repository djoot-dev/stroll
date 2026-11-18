import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import {
  buildPRSymbolIndex,
  getEnclosingScope,
  getReplacedLinesForAddedLine,
  resolveHoverSymbol,
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
})
