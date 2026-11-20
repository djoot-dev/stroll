import type { DiffLine } from './diffParser'

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
