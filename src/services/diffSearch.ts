import type { DiffLine } from './diffParser'
import type { DiffTokenPart } from './inlineDiff'

export interface SearchMatchRange {
  start: number
  end: number
}

export interface SearchTokenPart extends DiffTokenPart {
  searchMatch: boolean
  matchStart: boolean
  matchEnd: boolean
}

export interface DiffSearchMatch {
  line: DiffLine
  /** Character range of the first occurrence of the query within `line.content`. */
  start: number
  end: number
}

/** Case-insensitive substring search over diff lines, in display order. */
export function findDiffMatches(lines: readonly DiffLine[], query: string): DiffSearchMatch[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const matches: DiffSearchMatch[] = []
  for (const line of lines) {
    const idx = line.content.toLowerCase().indexOf(q)
    if (idx !== -1) matches.push({ line, start: idx, end: idx + q.length })
  }
  return matches
}

/**
 * Returns all non-overlapping case-insensitive occurrence ranges of `query`
 * within `content`, in order.
 */
export function findLineMatchRanges(content: string, query: string): SearchMatchRange[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const lower = content.toLowerCase()
  const ranges: SearchMatchRange[] = []
  let from = 0
  while (from <= lower.length - q.length) {
    const idx = lower.indexOf(q, from)
    if (idx === -1) break
    ranges.push({ start: idx, end: idx + q.length })
    from = idx + q.length
  }
  return ranges
}

/**
 * Splits `DiffTokenPart` slices around `ranges` so every occurrence of a search
 * match can be highlighted without re-running syntax highlighting.
 */
export function applySearchMatchRanges(
  parts: readonly DiffTokenPart[],
  ranges: readonly SearchMatchRange[],
): SearchTokenPart[] {
  if (ranges.length === 0) {
    return parts.map((pt) => ({
      ...pt,
      searchMatch: false,
      matchStart: false,
      matchEnd: false,
    }))
  }

  const result: SearchTokenPart[] = []
  let charOffset = 0
  let rangeIdx = 0

  for (const pt of parts) {
    const ptStart = charOffset
    const ptEnd = charOffset + pt.text.length
    charOffset = ptEnd

    while (rangeIdx < ranges.length && ranges[rangeIdx].end <= ptStart) {
      rangeIdx += 1
    }

    let cursor = ptStart
    let rIdx = rangeIdx
    while (rIdx < ranges.length && ranges[rIdx].start < ptEnd) {
      const r = ranges[rIdx]
      const overlapStart = Math.max(cursor, r.start)
      const overlapEnd = Math.min(ptEnd, r.end)

      if (overlapStart > cursor) {
        result.push({
          ...pt,
          text: pt.text.slice(cursor - ptStart, overlapStart - ptStart),
          changeStart: pt.changeStart && cursor === ptStart,
          changeEnd: false,
          searchMatch: false,
          matchStart: false,
          matchEnd: false,
        })
      }

      if (overlapEnd > overlapStart) {
        result.push({
          ...pt,
          text: pt.text.slice(overlapStart - ptStart, overlapEnd - ptStart),
          changeStart: pt.changeStart && overlapStart === ptStart,
          changeEnd: pt.changeEnd && overlapEnd === ptEnd,
          searchMatch: true,
          matchStart: overlapStart === r.start,
          matchEnd: overlapEnd === r.end,
        })
        cursor = overlapEnd
      }

      if (r.end <= ptEnd) {
        rIdx += 1
      } else {
        break
      }
    }

    if (cursor < ptEnd) {
      result.push({
        ...pt,
        text: pt.text.slice(cursor - ptStart),
        changeStart: pt.changeStart && cursor === ptStart,
        changeEnd: pt.changeEnd,
        searchMatch: false,
        matchStart: false,
        matchEnd: false,
      })
    }
  }

  return result
}

/**
 * Index of the first match at or after the reader's position, wrapping to 0
 * when every match lies before it. Positions are line indices in display order
 * (collapsed gaps included), so matches inside folded context still count.
 */
export function pickStartMatchIndex(matchPositions: readonly number[], anchor: number): number {
  const idx = matchPositions.findIndex((pos) => pos >= anchor)
  return idx === -1 ? 0 : idx
}

export interface CenteredRevealInput {
  itemTop: number
  itemBottom: number
  /** Unobstructed band of the viewport the item should land in. */
  visibleTop: number
  visibleBottom: number
}

/**
 * Scroll delta that centers the item within the visible band, or 0 when the
 * item is already fully inside it (so stepping through on-screen matches
 * never moves the page).
 */
export function computeCenteredRevealDelta(input: CenteredRevealInput): number {
  const { itemTop, itemBottom, visibleTop, visibleBottom } = input
  if (itemTop >= visibleTop && itemBottom <= visibleBottom) return 0
  const itemCenter = (itemTop + itemBottom) / 2
  const bandCenter = (visibleTop + visibleBottom) / 2
  return itemCenter - bandCenter
}

export interface MatchSnippet {
  before: string
  match: string
  after: string
}

/**
 * Splits a line around its match for display: leading indentation is dropped and
 * long lines are elided so the match stays visible within roughly `maxLen` chars.
 */
export function buildMatchSnippet(
  content: string,
  start: number,
  end: number,
  maxLen = 120,
): MatchSnippet {
  const indent = content.length - content.trimStart().length
  let from = Math.min(indent, start)
  let to = content.length

  const contextBefore = Math.max(16, Math.floor((maxLen - (end - start)) / 3))
  if (start - from > contextBefore) from = start - contextBefore
  if (to - from > maxLen) to = Math.max(end, from + maxLen)

  const before = (from > Math.min(indent, start) ? '…' : '') + content.slice(from, start)
  const after = content.slice(end, to) + (to < content.length ? '…' : '')
  return { before, match: content.slice(start, end), after }
}
