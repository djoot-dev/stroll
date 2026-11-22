import type { DiffSide, PRFile } from '@/types/pr'
import { applyInlineDiffsToHunk, type InlineChangeRange } from './inlineDiff'
import { getMovedLineInfo, type MovedCodeIndex, type MovedLineInfo } from './movedCode'

export type { InlineChangeRange, MovedLineInfo }

export interface DiffLine {
  key: string
  type: 'add' | 'del' | 'context'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
  /** Target line number & side for GitHub review comments */
  commentLine: number
  commentSide: DiffSide
  /** Character ranges within `content` that changed relative to a paired line */
  inlineChanges?: InlineChangeRange[]
  /** Present when this line belongs to a moved block detected across the PR */
  moved?: MovedLineInfo
}

export interface DiffGap {
  id: string
  kind: 'gap'
  /** 1-based inclusive range in headContent (or baseContent for deleted files) */
  startNewLine: number
  endNewLine: number
  startOldLine: number
  lineCount: number
  lines: DiffLine[]
}

export interface DiffHunkBlock {
  id: string
  kind: 'hunk'
  header: string
  lines: DiffLine[]
}

export type DiffSegment = DiffGap | DiffHunkBlock

interface RawHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  header: string
  lines: DiffLine[]
}

function parsePatchHunks(patch: string): RawHunk[] {
  if (!patch.trim()) return []

  const rawLines = patch.split('\n')
  const hunks: RawHunk[] = []
  let current: RawHunk | null = null
  let oldLine = 0
  let newLine = 0
  let lineCounter = 0

  for (const raw of rawLines) {
    const headerMatch = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
    if (headerMatch) {
      current = {
        oldStart: Number(headerMatch[1]),
        oldCount: headerMatch[2] !== undefined ? Number(headerMatch[2]) : 1,
        newStart: Number(headerMatch[3]),
        newCount: headerMatch[4] !== undefined ? Number(headerMatch[4]) : 1,
        header: raw,
        lines: [],
      }
      oldLine = current.oldStart
      newLine = current.newStart
      hunks.push(current)
      continue
    }

    if (!current) continue
    if (raw.startsWith('\\ No newline at end of file')) continue

    const prefix = raw[0]
    const content = raw.slice(1)
    lineCounter += 1

    if (prefix === '+') {
      current.lines.push({
        key: `add-${newLine}-${lineCounter}`,
        type: 'add',
        content,
        oldLineNumber: null,
        newLineNumber: newLine,
        commentLine: newLine,
        commentSide: 'RIGHT',
      })
      newLine += 1
    } else if (prefix === '-') {
      current.lines.push({
        key: `del-${oldLine}-${lineCounter}`,
        type: 'del',
        content,
        oldLineNumber: oldLine,
        newLineNumber: null,
        commentLine: oldLine,
        commentSide: 'LEFT',
      })
      oldLine += 1
    } else {
      current.lines.push({
        key: `ctx-${oldLine}-${newLine}-${lineCounter}`,
        type: 'context',
        content: prefix === ' ' ? content : raw,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
        commentLine: newLine,
        commentSide: 'RIGHT',
      })
      oldLine += 1
      newLine += 1
    }
  }

  return hunks
}

function buildGapSegment(
  id: string,
  sourceLines: string[],
  startNewLine: number,
  endNewLine: number,
  startOldLine: number,
  isDeletedFile: boolean,
  isAddedFile = false,
): DiffGap | null {
  if (endNewLine < startNewLine) return null
  const lines: DiffLine[] = []
  for (let ln = startNewLine; ln <= endNewLine; ln++) {
    const idx = ln - 1
    const text = sourceLines[idx] ?? ''
    const oldLn = startOldLine + (ln - startNewLine)
    lines.push({
      key: `gap-${id}-${ln}`,
      type: 'context',
      content: text,
      oldLineNumber: isAddedFile ? null : oldLn,
      newLineNumber: isDeletedFile ? null : ln,
      commentLine: isDeletedFile ? oldLn : ln,
      commentSide: isDeletedFile ? 'LEFT' : 'RIGHT',
    })
  }
  return {
    id,
    kind: 'gap',
    startNewLine,
    endNewLine,
    startOldLine,
    lineCount: lines.length,
    lines,
  }
}

/**
 * Returns true if the file was renamed without any textual content modifications.
 */
export function isPureRename(file: PRFile): boolean {
  return (
    file.status === 'renamed' &&
    !file.patch.trim() &&
    file.additions === 0 &&
    file.deletions === 0
  )
}

export interface BuildDiffOptions {
  ignoreWhitespace?: boolean
  movedCode?: MovedCodeIndex
}

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, '')
}

function collapseWhitespaceOnlyLines(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].type === 'del') {
      const delStart = i
      while (i < lines.length && lines[i].type === 'del') i += 1
      const addStart = i
      while (i < lines.length && lines[i].type === 'add') i += 1
      const dels = lines.slice(delStart, addStart)
      const adds = lines.slice(addStart, i)

      if (
        dels.length > 0 &&
        dels.length === adds.length &&
        dels.every((d, idx) => normalizeWs(d.content) === normalizeWs(adds[idx].content))
      ) {
        for (let k = 0; k < adds.length; k += 1) {
          out.push({
            ...adds[k],
            type: 'context',
            oldLineNumber: dels[k].oldLineNumber,
          })
        }
        continue
      }
      out.push(...dels, ...adds)
      continue
    }
    out.push(lines[i])
    i += 1
  }
  return out
}

/**
 * Converts a PRFile's unified patch + full file content into an ordered list of
 * expandable unchanged `DiffGap` segments and `DiffHunkBlock` segments.
 */
export function buildDiffSegments(file: PRFile, options?: BuildDiffOptions): DiffSegment[] {
  if (isPureRename(file)) return []
  if (file.isBinary && !file.patch.trim()) return []

  const isDeleted = file.status === 'deleted'
  const isAdded = file.status === 'added'
  const fullText = isDeleted ? file.baseContent : file.headContent
  const normalizedText =
    fullText !== null && fullText.endsWith('\n') ? fullText.slice(0, -1) : fullText
  const sourceLines = normalizedText !== null ? normalizedText.split('\n') : []
  const hunks = parsePatchHunks(file.patch)

  // If there's no patch (e.g. newly added large file or full-file view), show headContent
  if (hunks.length === 0 && sourceLines.length > 0) {
    return [
      {
        id: 'hunk-full',
        kind: 'hunk',
        header: `@@ -0,0 +1,${sourceLines.length} @@`,
        lines: sourceLines.map((content, idx) => ({
          key: `full-${idx + 1}`,
          type: file.status === 'added' ? 'add' : 'context',
          content,
          oldLineNumber: file.status === 'added' ? null : idx + 1,
          newLineNumber: isDeleted ? null : idx + 1,
          commentLine: idx + 1,
          commentSide: isDeleted ? 'LEFT' : 'RIGHT',
        })),
      },
    ]
  }

  const segments: DiffSegment[] = []
  let prevNewEnd = 0
  let prevOldEnd = 0

  hunks.forEach((hunk, idx) => {
    const targetStart = isDeleted ? hunk.oldStart : hunk.newStart
    const gapStart = prevNewEnd + 1
    const gapEnd = targetStart - 1

    if (sourceLines.length > 0 && gapEnd >= gapStart) {
      const gap = buildGapSegment(
        `gap-before-${idx}`,
        sourceLines,
        gapStart,
        gapEnd,
        prevOldEnd + 1,
        isDeleted,
        isAdded,
      )
      if (gap) segments.push(gap)
    }

    const hunkLines = options?.ignoreWhitespace
      ? collapseWhitespaceOnlyLines(hunk.lines)
      : hunk.lines

    if (options?.movedCode && options.movedCode.blockCount > 0) {
      for (const line of hunkLines) {
        const moved = getMovedLineInfo(options.movedCode, file.path, line)
        if (moved) line.moved = moved
      }
    }

    applyInlineDiffsToHunk(hunkLines)

    segments.push({
      id: `hunk-${idx}`,
      kind: 'hunk',
      header: hunk.header,
      lines: hunkLines,
    })

    prevNewEnd = isDeleted
      ? hunk.oldStart + hunk.oldCount - 1
      : hunk.newStart + hunk.newCount - 1
    prevOldEnd = hunk.oldStart + hunk.oldCount - 1
  })

  if (sourceLines.length > 0 && prevNewEnd < sourceLines.length) {
    const trailing = buildGapSegment(
      'gap-after-last',
      sourceLines,
      prevNewEnd + 1,
      sourceLines.length,
      prevOldEnd + 1,
      isDeleted,
      isAdded,
    )
    if (trailing) segments.push(trailing)
  }

  return segments
}
