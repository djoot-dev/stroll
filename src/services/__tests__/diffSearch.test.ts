import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../diffParser'
import {
  buildMatchSnippet,
  computeCenteredRevealDelta,
  findDiffMatches,
  pickStartMatchIndex,
} from '../diffSearch'

function line(key: string, content: string): DiffLine {
  return {
    key,
    type: 'context',
    content,
    oldLineNumber: 1,
    newLineNumber: 1,
    commentLine: 1,
    commentSide: 'RIGHT',
  }
}

describe('findDiffMatches', () => {
  const lines = [line('a', 'const Foo = 1'), line('b', 'bar()'), line('c', '  return foo + FOO')]

  it('matches case-insensitively in display order with the first occurrence range', () => {
    const matches = findDiffMatches(lines, 'foo')
    expect(matches.map((m) => m.line.key)).toEqual(['a', 'c'])
    expect(matches[1]).toMatchObject({ start: 9, end: 12 })
  })

  it('returns nothing for a blank query', () => {
    expect(findDiffMatches(lines, '   ')).toEqual([])
  })
})

describe('pickStartMatchIndex', () => {
  it('picks the first match at or after the anchor line', () => {
    expect(pickStartMatchIndex([10, 50, 90], 40)).toBe(1)
    expect(pickStartMatchIndex([10, 50, 90], 50)).toBe(1)
  })

  it('wraps to the first match when all are before the anchor', () => {
    expect(pickStartMatchIndex([10, 20], 40)).toBe(0)
  })

  it('starts at the top when the reader is above the diff', () => {
    expect(pickStartMatchIndex([10, 20], 0)).toBe(0)
  })
})

describe('computeCenteredRevealDelta', () => {
  const band = { visibleTop: 300, visibleBottom: 900 }

  it('does not scroll when the item is already in the band', () => {
    expect(computeCenteredRevealDelta({ ...band, itemTop: 400, itemBottom: 420 })).toBe(0)
  })

  it('centers an item hidden below the band', () => {
    expect(computeCenteredRevealDelta({ ...band, itemTop: 1490, itemBottom: 1510 })).toBe(900)
  })

  it('centers an item hidden behind the overlay above the band', () => {
    expect(computeCenteredRevealDelta({ ...band, itemTop: 200, itemBottom: 220 })).toBe(-390)
  })
})

describe('buildMatchSnippet', () => {
  it('drops indentation but keeps the rest of a short line', () => {
    expect(buildMatchSnippet('    return foo', 11, 14)).toEqual({
      before: 'return ',
      match: 'foo',
      after: '',
    })
  })

  it('elides long lines around the match', () => {
    const content = `${'x'.repeat(200)}needle${'y'.repeat(200)}`
    const snip = buildMatchSnippet(content, 200, 206, 60)
    expect(snip.match).toBe('needle')
    expect(snip.before.startsWith('…')).toBe(true)
    expect(snip.after.endsWith('…')).toBe(true)
    expect(snip.before.length + snip.match.length + snip.after.length).toBeLessThanOrEqual(62)
  })
})
