import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../diffParser'
import type { DiffTokenPart } from '../inlineDiff'
import {
  applySearchMatchRanges,
  buildMatchSnippet,
  computeCenteredRevealDelta,
  findDiffMatches,
  findLineMatchRanges,
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

describe('findLineMatchRanges', () => {
  it('finds all non-overlapping case-insensitive occurrences on a line', () => {
    expect(findLineMatchRanges('  return foo + FOO + foobar', 'foo')).toEqual([
      { start: 9, end: 12 },
      { start: 15, end: 18 },
      { start: 21, end: 24 },
    ])
  })

  it('does not produce overlapping matches', () => {
    expect(findLineMatchRanges('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })

  it('returns empty array for blank query', () => {
    expect(findLineMatchRanges('const foo = 1', '   ')).toEqual([])
  })
})

describe('applySearchMatchRanges', () => {
  function part(text: string, overrides: Partial<DiffTokenPart> = {}): DiffTokenPart {
    return {
      text,
      className: 'syn-var',
      ident: null,
      changed: false,
      changeStart: false,
      changeEnd: false,
      ...overrides,
    }
  }

  it('splits a single token around multiple matches while preserving ident and change flags', () => {
    const parts = [
      part('fooBar_foo', { ident: 'fooBar_foo', changed: true, changeStart: true, changeEnd: true }),
    ]
    const ranges = findLineMatchRanges('fooBar_foo', 'foo')
    const result = applySearchMatchRanges(parts, ranges)

    expect(result).toEqual([
      {
        text: 'foo',
        className: 'syn-var',
        ident: 'fooBar_foo',
        changed: true,
        changeStart: true,
        changeEnd: false,
        searchMatch: true,
        matchStart: true,
        matchEnd: true,
      },
      {
        text: 'Bar_',
        className: 'syn-var',
        ident: 'fooBar_foo',
        changed: true,
        changeStart: false,
        changeEnd: false,
        searchMatch: false,
        matchStart: false,
        matchEnd: false,
      },
      {
        text: 'foo',
        className: 'syn-var',
        ident: 'fooBar_foo',
        changed: true,
        changeStart: false,
        changeEnd: true,
        searchMatch: true,
        matchStart: true,
        matchEnd: true,
      },
    ])
  })

  it('spans a single match across multiple syntax tokens with continuous start/end flags', () => {
    const parts = [part('foo'), part('.'), part('bar')]
    const ranges = findLineMatchRanges('foo.bar', 'foo.bar')
    const result = applySearchMatchRanges(parts, ranges)

    expect(result.map((p) => ({ text: p.text, m: p.searchMatch, s: p.matchStart, e: p.matchEnd }))).toEqual([
      { text: 'foo', m: true, s: true, e: false },
      { text: '.', m: true, s: false, e: false },
      { text: 'bar', m: true, s: false, e: true },
    ])
  })
})
