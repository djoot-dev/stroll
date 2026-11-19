import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import { buildDiffSegments } from '@/services/diffParser'
import {
  applyInlineDiffsToHunk,
  buildLineTokenParts,
  computeInlineLineDiff,
  computeMultiLineBlockDiff,
  type DiffLineLike,
} from '@/services/inlineDiff'

function sliceRanges(line: string, ranges?: Array<{ start: number; end: number }>): string[] {
  return (ranges ?? []).map((r) => line.slice(r.start, r.end))
}

describe('computeInlineLineDiff', () => {
  it('highlights changed identifiers and numbers at word granularity', () => {
    const oldLine = 'const maxRetries = 3'
    const newLine = 'const maxAttempts = 5'
    const res = computeInlineLineDiff(oldLine, newLine)

    expect(sliceRanges(oldLine, res.oldRanges)).toEqual(['maxRetries', '3'])
    expect(sliceRanges(newLine, res.newRanges)).toEqual(['maxAttempts', '5'])
    expect(res.similarity).toBeGreaterThanOrEqual(0.3)
  })

  it('highlights single punctuation/operator additions without marking surrounding tokens', () => {
    const oldLine = 'if (count < 10) {'
    const newLine = 'if (count <= 10) {'
    const res = computeInlineLineDiff(oldLine, newLine)

    expect(sliceRanges(oldLine, res.oldRanges)).toEqual([])
    expect(sliceRanges(newLine, res.newRanges)).toEqual(['='])
  })

  it('highlights inserted function arguments cleanly', () => {
    const oldLine = 'return fetch(endpoint.url, opts)'
    const newLine = 'return fetch(endpoint.url, opts, signal)'
    const res = computeInlineLineDiff(oldLine, newLine)

    expect(sliceRanges(oldLine, res.oldRanges)).toEqual([])
    expect(sliceRanges(newLine, res.newRanges)).toEqual([', signal'])
  })

  it('highlights only extra indentation spaces rather than entire leading whitespace', () => {
    const oldLine = '  return false'
    const newLine = '    return true'
    const res = computeInlineLineDiff(oldLine, newLine)

    expect(sliceRanges(oldLine, res.oldRanges)).toEqual(['false'])
    expect(sliceRanges(newLine, res.newRanges)).toEqual(['  ', 'true'])
  })

  it('does not treat shared leading indentation as meaningful similarity for unrelated lines', () => {
    const oldLine = '        const foo = 1'
    const newLine = '        return bar(baz)'
    const res = computeInlineLineDiff(oldLine, newLine)

    expect(res.similarity).toBeLessThan(0.3)
  })

  it('returns empty ranges for identical lines and bails out gracefully on very long lines', () => {
    const same = computeInlineLineDiff('const a = 1', 'const a = 1')
    expect(same).toEqual({ oldRanges: [], newRanges: [], similarity: 1 })

    const hugeA = 'a'.repeat(2000)
    const hugeB = 'b'.repeat(2000)
    const huge = computeInlineLineDiff(hugeA, hugeB)
    expect(huge).toEqual({ oldRanges: [], newRanges: [], similarity: 0 })
  })
})

describe('computeMultiLineBlockDiff', () => {
  it('handles single-line imports reflowed into multi-line imports with new symbols', () => {
    const oldLines = [
      "import type { WebhookEndpoint, WebhookEventPayload } from '../types/webhook'",
    ]
    const newLines = [
      'import type {',
      '  RetryPolicy,',
      '  WebhookDeliveryResult,',
      '  WebhookEndpoint,',
      '  WebhookEventPayload,',
      "} from '../types/webhook'",
    ]

    const res = computeMultiLineBlockDiff(oldLines, newLines)

    expect(res.similarity).toBeGreaterThanOrEqual(0.35)
    expect(sliceRanges(oldLines[0], res.oldRangesByLine[0])).toEqual([])
    expect(sliceRanges(newLines[0], res.newRangesByLine[0])).toEqual([])
    expect(sliceRanges(newLines[1], res.newRangesByLine[1])).toEqual(['RetryPolicy,'])
    expect(sliceRanges(newLines[2], res.newRangesByLine[2])).toEqual(['WebhookDeliveryResult,'])
    expect(sliceRanges(newLines[3], res.newRangesByLine[3])).toEqual([])
    expect(sliceRanges(newLines[4], res.newRangesByLine[4])).toEqual([','])
    expect(sliceRanges(newLines[5], res.newRangesByLine[5])).toEqual([])
  })

  it('handles multi-line function signature reflows with an added param and return type change', () => {
    const oldLines = [
      '  async dispatch(endpoint: WebhookEndpoint, event: WebhookEventPayload): Promise<boolean> {',
    ]
    const newLines = [
      '  async dispatch(',
      '    endpoint: WebhookEndpoint,',
      '    event: WebhookEventPayload,',
      '    attempt = 1,',
      '  ): Promise<WebhookDeliveryResult> {',
    ]

    const res = computeMultiLineBlockDiff(oldLines, newLines)

    expect(sliceRanges(oldLines[0], res.oldRangesByLine[0])).toEqual(['boolean'])
    expect(sliceRanges(newLines[0], res.newRangesByLine[0])).toEqual([])
    expect(sliceRanges(newLines[1], res.newRangesByLine[1])).toEqual([])
    expect(sliceRanges(newLines[2], res.newRangesByLine[2])).toEqual([','])
    expect(sliceRanges(newLines[3], res.newRangesByLine[3])).toEqual(['attempt = 1,'])
    expect(sliceRanges(newLines[4], res.newRangesByLine[4])).toEqual(['WebhookDeliveryResult'])
  })

  it('highlights only the new wrapper when existing statements are wrapped in an if block', () => {
    const oldLines = [
      '  const res = await fetch(url)',
      '  return res.ok',
    ]
    const newLines = [
      '  if (endpoint.enabled) {',
      '    const res = await fetch(url)',
      '    return res.ok',
      '  }',
    ]

    const res = computeMultiLineBlockDiff(oldLines, newLines)

    expect(sliceRanges(oldLines[0], res.oldRangesByLine[0])).toEqual([])
    expect(sliceRanges(oldLines[1], res.oldRangesByLine[1])).toEqual([])
    expect(sliceRanges(newLines[0], res.newRangesByLine[0])).toEqual(['if (endpoint.enabled) {'])
    expect(sliceRanges(newLines[1], res.newRangesByLine[1])).toEqual([])
    expect(sliceRanges(newLines[2], res.newRangesByLine[2])).toEqual([])
    expect(sliceRanges(newLines[3], res.newRangesByLine[3])).toEqual(['}'])
  })
})

describe('applyInlineDiffsToHunk', () => {
  it('highlights edits and inserted statements cleanly across asymmetric del/add blocks', () => {
    const lines: DiffLineLike[] = [
      { type: 'context', content: 'function run() {' },
      { type: 'del', content: '  const retries = 3' },
      { type: 'del', content: '  return send(payload)' },
      { type: 'add', content: '  const retries = 5' },
      { type: 'add', content: '  logAttempt(retries)' },
      { type: 'add', content: '  return send(payload, retries)' },
      { type: 'context', content: '}' },
    ]

    applyInlineDiffsToHunk(lines)

    // del[0] vs add[0]: 3 -> 5
    expect(sliceRanges(lines[1].content, lines[1].inlineChanges)).toEqual(['3'])
    expect(sliceRanges(lines[3].content, lines[3].inlineChanges)).toEqual(['5'])

    // middle inserted statement is highlighted as newly added tokens
    expect(sliceRanges(lines[4].content, lines[4].inlineChanges)).toEqual(['logAttempt(retries)'])

    // del[1] vs add[2]: added `, retries`
    expect(lines[2].inlineChanges).toBeUndefined()
    expect(sliceRanges(lines[5].content, lines[5].inlineChanges)).toEqual([', retries'])
  })

  it('skips inline highlights for completely unrelated del/add replacements', () => {
    const lines: DiffLineLike[] = [
      { type: 'del', content: 'const alpha = computeFoo()' },
      { type: 'add', content: 'return renderBar(123)' },
    ]

    applyInlineDiffsToHunk(lines)

    expect(lines[0].inlineChanges).toBeUndefined()
    expect(lines[1].inlineChanges).toBeUndefined()
  })

  it('does not attach inlineChanges to pure additions or pure deletions', () => {
    const lines: DiffLineLike[] = [
      { type: 'context', content: 'a' },
      { type: 'add', content: 'b' },
      { type: 'context', content: 'c' },
      { type: 'del', content: 'd' },
    ]

    applyInlineDiffsToHunk(lines)

    expect(lines.every((l) => l.inlineChanges === undefined)).toBe(true)
  })

  it('populates inlineChanges when building diff segments from a PRFile patch', () => {
    const dispatcherFile = MOCK_PR.files.find((f) => f.path === 'src/services/webhookDispatcher.ts')
    expect(dispatcherFile).toBeDefined()

    const segments = buildDiffSegments(dispatcherFile!)
    const hunkLines = segments
      .filter((s) => s.kind === 'hunk')
      .flatMap((s) => s.lines)

    const linesWithInlineDiff = hunkLines.filter(
      (l) => l.inlineChanges && l.inlineChanges.length > 0,
    )
    expect(linesWithInlineDiff.length).toBeGreaterThan(0)
  })
})

describe('buildLineTokenParts', () => {
  it('preserves syntax classes, hover identifiers, and rounded pill boundaries across multi-span changes', () => {
    // Line: "const x = foo(1, 2)"
    // Changed range: ", 2" -> indices [15, 18)
    const spans = [
      { text: 'const', className: 'tok-kw' },
      { text: ' x ', className: '' },
      { text: '=', className: 'tok-op' },
      { text: ' foo', className: 'tok-fn' },
      { text: '(', className: 'tok-punc' },
      { text: '1', className: 'tok-num' },
      { text: ', ', className: 'tok-punc' },
      { text: '2', className: 'tok-num' },
      { text: ')', className: 'tok-punc' },
    ]
    const symbols = new Map<string, unknown>([['foo', {}]])
    const parts = buildLineTokenParts(spans, symbols, [{ start: 15, end: 18 }])

    expect(parts.map((p) => p.text).join('')).toBe('const x = foo(1, 2)')

    const fooPart = parts.find((p) => p.text === 'foo')
    expect(fooPart).toMatchObject({
      className: 'tok-fn',
      ident: 'foo',
      changed: false,
    })

    const changedParts = parts.filter((p) => p.changed)
    expect(changedParts).toEqual([
      {
        text: ', ',
        className: 'tok-punc',
        ident: null,
        changed: true,
        changeStart: true,
        changeEnd: false,
      },
      {
        text: '2',
        className: 'tok-num',
        ident: null,
        changed: true,
        changeStart: false,
        changeEnd: true,
      },
    ])
  })
})
