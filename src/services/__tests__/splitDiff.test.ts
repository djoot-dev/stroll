import { describe, expect, it } from 'vitest'
import type { DiffLine } from '../diffParser'
import { buildSplitDiffRows } from '../splitDiff'

function makeLine(
  type: DiffLine['type'],
  content: string,
  oldLineNumber: number | null,
  newLineNumber: number | null,
  idx: number,
): DiffLine {
  return {
    key: `${type}-${idx}`,
    type,
    content,
    oldLineNumber,
    newLineNumber,
    commentLine: (type === 'del' ? oldLineNumber : newLineNumber) ?? 1,
    commentSide: type === 'del' ? 'LEFT' : 'RIGHT',
  }
}

describe('buildSplitDiffRows', () => {
  it('places context lines on both sides', () => {
    const line = makeLine('context', 'const a = 1', 1, 1, 1)
    const rows = buildSplitDiffRows([line])
    expect(rows).toEqual([{ key: 'context-1', left: line, right: line }])
  })

  it('pairs contiguous deletions and additions and pads the shorter side', () => {
    const lines = [
      makeLine('context', 'header', 1, 1, 1),
      makeLine('del', 'old1', 2, null, 2),
      makeLine('del', 'old2', 3, null, 3),
      makeLine('add', 'new1', null, 2, 4),
      makeLine('add', 'new2', null, 3, 5),
      makeLine('add', 'new3', null, 4, 6),
      makeLine('context', 'footer', 4, 5, 7),
    ]

    const rows = buildSplitDiffRows(lines)
    expect(rows).toHaveLength(5)
    expect(rows[0].left?.content).toBe('header')
    expect(rows[0].right?.content).toBe('header')

    expect(rows[1].left?.content).toBe('old1')
    expect(rows[1].right?.content).toBe('new1')

    expect(rows[2].left?.content).toBe('old2')
    expect(rows[2].right?.content).toBe('new2')

    expect(rows[3].left).toBeNull()
    expect(rows[3].right?.content).toBe('new3')

    expect(rows[4].left?.content).toBe('footer')
    expect(rows[4].right?.content).toBe('footer')
  })

  it('handles pure deletions and pure additions', () => {
    const lines = [
      makeLine('del', 'removed', 1, null, 1),
      makeLine('context', 'mid', 2, 1, 2),
      makeLine('add', 'added', null, 2, 3),
    ]
    const rows = buildSplitDiffRows(lines)
    expect(rows[0]).toEqual({ key: 'del-1', left: lines[0], right: null })
    expect(rows[1]).toEqual({ key: 'context-2', left: lines[1], right: lines[1] })
    expect(rows[2]).toEqual({ key: 'add-3', left: null, right: lines[2] })
  })
})
