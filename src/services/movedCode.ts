import type { DiffSide, PRFile } from '@/types/pr'

export interface MovedLineInfo {
  /** Shared ID for the matched (del-block, add-block) pair */
  moveId: string
  /** True on the first line of the moved block (where the badge is rendered) */
  isBlockStart: boolean
  /** Number of lines in this moved block */
  blockLength: number
  /** Counterpart file path */
  peerPath: string
  /** 1-based starting line number of the counterpart block */
  peerStartLine: number
  /** 1-based line number of this specific line's counterpart */
  peerLine: number
  /** Counterpart diff side ('LEFT' for del, 'RIGHT' for add) */
  peerSide: DiffSide
}

export interface MovedCodeIndex {
  /** Keyed by `${filePath}\0del\0${oldLineNumber}` */
  deletedLines: Map<string, MovedLineInfo>
  /** Keyed by `${filePath}\0add\0${newLineNumber}` */
  addedLines: Map<string, MovedLineInfo>
  /** Total number of moved block pairs detected across the PR */
  blockCount: number
}

interface RunLine {
  filePath: string
  lineNumber: number
  trimmed: string
  nonWsLength: number
}

interface DiffRun {
  id: number
  filePath: string
  hunkIndex: number
  kind: 'del' | 'add'
  lines: RunLine[]
  /** For a 'del' run immediately followed by an 'add' run in the same hunk, the ID of that 'add' run */
  adjacentAddRunId: number | null
}

interface CandidateMatch {
  delRunIdx: number
  delOffset: number
  addRunIdx: number
  addOffset: number
  length: number
  nonEmptyCount: number
  sameFile: boolean
  lineDistance: number
}

const MIN_NON_EMPTY_LINES = 2
const MIN_NON_WS_CHARS = 20

function makeLineKey(filePath: string, kind: 'del' | 'add', lineNumber: number): string {
  return `${filePath}\0${kind}\0${lineNumber}`
}

function isPureRenameFile(file: PRFile): boolean {
  return (
    file.status === 'renamed' &&
    !file.patch.trim() &&
    file.additions === 0 &&
    file.deletions === 0
  )
}

function extractRuns(files: PRFile[]): { delRuns: DiffRun[]; addRuns: DiffRun[] } {
  const delRuns: DiffRun[] = []
  const addRuns: DiffRun[] = []
  let nextRunId = 1

  for (const file of files) {
    if (file.isBinary || isPureRenameFile(file) || !file.patch.trim()) continue

    const rawLines = file.patch.split('\n')
    let hunkIndex = -1
    let oldLine = 0
    let newLine = 0
    let currentDel: DiffRun | null = null
    let currentAdd: DiffRun | null = null
    let lastClosedDel: DiffRun | null = null

    const flushDel = (): DiffRun | null => {
      if (currentDel && currentDel.lines.length > 0) {
        const closed = currentDel
        delRuns.push(closed)
        currentDel = null
        return closed
      }
      currentDel = null
      return null
    }

    const flushAdd = () => {
      if (currentAdd && currentAdd.lines.length > 0) {
        addRuns.push(currentAdd)
      }
      currentAdd = null
    }

    for (const raw of rawLines) {
      const headerMatch = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (headerMatch) {
        flushDel()
        flushAdd()
        lastClosedDel = null
        hunkIndex += 1
        oldLine = Number(headerMatch[1])
        newLine = Number(headerMatch[2])
        continue
      }

      if (hunkIndex < 0) continue
      if (raw.startsWith('\\ No newline at end of file')) continue

      const prefix = raw[0]
      const content = raw.slice(1)
      const trimmed = content.trim()
      const nonWsLength = content.replace(/\s+/g, '').length

      if (prefix === '-') {
        if (currentAdd) {
          flushAdd()
          lastClosedDel = null
        }
        if (!currentDel) {
          currentDel = {
            id: nextRunId++,
            filePath: file.path,
            hunkIndex,
            kind: 'del',
            lines: [],
            adjacentAddRunId: null,
          }
        }
        currentDel.lines.push({
          filePath: file.path,
          lineNumber: oldLine,
          trimmed,
          nonWsLength,
        })
        oldLine += 1
      } else if (prefix === '+') {
        if (currentDel) {
          lastClosedDel = flushDel()
        }
        if (!currentAdd) {
          currentAdd = {
            id: nextRunId++,
            filePath: file.path,
            hunkIndex,
            kind: 'add',
            lines: [],
            adjacentAddRunId: null,
          }
          if (lastClosedDel && lastClosedDel.hunkIndex === hunkIndex) {
            lastClosedDel.adjacentAddRunId = currentAdd.id
          }
        }
        currentAdd.lines.push({
          filePath: file.path,
          lineNumber: newLine,
          trimmed,
          nonWsLength,
        })
        newLine += 1
      } else {
        flushDel()
        flushAdd()
        lastClosedDel = null
        oldLine += 1
        newLine += 1
      }
    }

    flushDel()
    flushAdd()
  }

  return { delRuns, addRuns }
}

function isInPlaceReindent(
  delRun: DiffRun,
  delOffset: number,
  addRun: DiffRun,
  addOffset: number,
  length: number,
): boolean {
  return (
    delRun.adjacentAddRunId === addRun.id &&
    delOffset === 0 &&
    addOffset === 0 &&
    length === delRun.lines.length &&
    length === addRun.lines.length
  )
}

/**
 * Detects moved code blocks within and across files in a pull request.
 * Matches contiguous runs of deleted and added lines by trimmed content,
 * ignoring indentation changes while filtering out trivial boilerplate and
 * in-place re-indentation.
 */
export function detectMovedCode(files: PRFile[]): MovedCodeIndex {
  const deletedLines = new Map<string, MovedLineInfo>()
  const addedLines = new Map<string, MovedLineInfo>()

  if (files.length === 0) {
    return { deletedLines, addedLines, blockCount: 0 }
  }

  const { delRuns, addRuns } = extractRuns(files)
  if (delRuns.length === 0 || addRuns.length === 0) {
    return { deletedLines, addedLines, blockCount: 0 }
  }

  // Index 2-line anchors from all add runs for O(N) candidate lookup
  const anchorMap = new Map<string, Array<{ addRunIdx: number; offset: number }>>()
  for (let rIdx = 0; rIdx < addRuns.length; rIdx += 1) {
    const run = addRuns[rIdx]
    for (let j = 0; j < run.lines.length - 1; j += 1) {
      const t0 = run.lines[j].trimmed
      const t1 = run.lines[j + 1].trimmed
      if (t0 === '' && t1 === '') continue
      const key = `${t0}\0${t1}`
      let list = anchorMap.get(key)
      if (!list) {
        list = []
        anchorMap.set(key, list)
      }
      list.push({ addRunIdx: rIdx, offset: j })
    }
  }

  const candidates: CandidateMatch[] = []
  const diagonalLastEnd = new Map<string, number>()

  for (let dIdx = 0; dIdx < delRuns.length; dIdx += 1) {
    const delRun = delRuns[dIdx]
    for (let i = 0; i < delRun.lines.length - 1; i += 1) {
      const t0 = delRun.lines[i].trimmed
      const t1 = delRun.lines[i + 1].trimmed
      if (t0 === '' && t1 === '') continue
      const key = `${t0}\0${t1}`
      const hits = anchorMap.get(key)
      if (!hits) continue

      for (const hit of hits) {
        const addRun = addRuns[hit.addRunIdx]
        const diagKey = `${dIdx}:${hit.addRunIdx}:${i - hit.offset}`
        if (i < (diagonalLastEnd.get(diagKey) ?? -1)) continue

        let len = 2
        while (
          i + len < delRun.lines.length &&
          hit.offset + len < addRun.lines.length &&
          delRun.lines[i + len].trimmed === addRun.lines[hit.offset + len].trimmed
        ) {
          len += 1
        }

        diagonalLastEnd.set(diagKey, i + len)

        // Trim leading/trailing blank lines from the matched block
        let startTrim = 0
        while (startTrim < len && delRun.lines[i + startTrim].trimmed === '') {
          startTrim += 1
        }
        let endTrim = len
        while (endTrim > startTrim && delRun.lines[i + endTrim - 1].trimmed === '') {
          endTrim -= 1
        }

        const effectiveLen = endTrim - startTrim
        if (effectiveLen < MIN_NON_EMPTY_LINES) continue

        const dStart = i + startTrim
        const aStart = hit.offset + startTrim

        let nonEmptyCount = 0
        let totalNonWsChars = 0
        for (let k = 0; k < effectiveLen; k += 1) {
          const line = delRun.lines[dStart + k]
          if (line.trimmed !== '') {
            nonEmptyCount += 1
            totalNonWsChars += line.nonWsLength
          }
        }

        if (nonEmptyCount < MIN_NON_EMPTY_LINES || totalNonWsChars < MIN_NON_WS_CHARS) {
          continue
        }

        if (isInPlaceReindent(delRun, dStart, addRun, aStart, effectiveLen)) {
          continue
        }

        const sameFile = delRun.filePath === addRun.filePath
        const lineDistance = sameFile
          ? Math.abs(delRun.lines[dStart].lineNumber - addRun.lines[aStart].lineNumber)
          : Number.MAX_SAFE_INTEGER

        candidates.push({
          delRunIdx: dIdx,
          delOffset: dStart,
          addRunIdx: hit.addRunIdx,
          addOffset: aStart,
          length: effectiveLen,
          nonEmptyCount,
          sameFile,
          lineDistance,
        })
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.nonEmptyCount !== a.nonEmptyCount) return b.nonEmptyCount - a.nonEmptyCount
    if (b.length !== a.length) return b.length - a.length
    if (a.sameFile !== b.sameFile) return a.sameFile ? -1 : 1
    if (a.lineDistance !== b.lineDistance) return a.lineDistance - b.lineDistance
    const delA = delRuns[a.delRunIdx]
    const delB = delRuns[b.delRunIdx]
    const pathCmp = delA.filePath.localeCompare(delB.filePath)
    if (pathCmp !== 0) return pathCmp
    return delA.lines[a.delOffset].lineNumber - delB.lines[b.delOffset].lineNumber
  })

  const usedDel = new Set<string>()
  const usedAdd = new Set<string>()
  let blockCount = 0

  for (const cand of candidates) {
    let conflict = false
    for (let k = 0; k < cand.length; k += 1) {
      if (
        usedDel.has(`${cand.delRunIdx}:${cand.delOffset + k}`) ||
        usedAdd.has(`${cand.addRunIdx}:${cand.addOffset + k}`)
      ) {
        conflict = true
        break
      }
    }
    if (conflict) continue

    blockCount += 1
    const moveId = `move-${blockCount}`
    const delRun = delRuns[cand.delRunIdx]
    const addRun = addRuns[cand.addRunIdx]
    const delStartLine = delRun.lines[cand.delOffset].lineNumber
    const addStartLine = addRun.lines[cand.addOffset].lineNumber

    for (let k = 0; k < cand.length; k += 1) {
      usedDel.add(`${cand.delRunIdx}:${cand.delOffset + k}`)
      usedAdd.add(`${cand.addRunIdx}:${cand.addOffset + k}`)

      const dLine = delRun.lines[cand.delOffset + k]
      const aLine = addRun.lines[cand.addOffset + k]

      deletedLines.set(makeLineKey(dLine.filePath, 'del', dLine.lineNumber), {
        moveId,
        isBlockStart: k === 0,
        blockLength: cand.length,
        peerPath: aLine.filePath,
        peerStartLine: addStartLine,
        peerLine: aLine.lineNumber,
        peerSide: 'RIGHT',
      })

      addedLines.set(makeLineKey(aLine.filePath, 'add', aLine.lineNumber), {
        moveId,
        isBlockStart: k === 0,
        blockLength: cand.length,
        peerPath: dLine.filePath,
        peerStartLine: delStartLine,
        peerLine: dLine.lineNumber,
        peerSide: 'LEFT',
      })
    }
  }

  return { deletedLines, addedLines, blockCount }
}

/**
 * Looks up moved-code metadata for a given diff line in a file.
 */
export function getMovedLineInfo(
  index: MovedCodeIndex | undefined,
  filePath: string,
  line: { type: 'add' | 'del' | 'context'; oldLineNumber: number | null; newLineNumber: number | null },
): MovedLineInfo | undefined {
  if (!index || index.blockCount === 0) return undefined
  if (line.type === 'del' && line.oldLineNumber != null) {
    return index.deletedLines.get(makeLineKey(filePath, 'del', line.oldLineNumber))
  }
  if (line.type === 'add' && line.newLineNumber != null) {
    return index.addedLines.get(makeLineKey(filePath, 'add', line.newLineNumber))
  }
  return undefined
}

/**
 * Formats a concise human-readable badge label for the start of a moved block.
 */
export function formatMovedBadgeLabel(
  currentFilePath: string,
  lineType: 'add' | 'del',
  moved: MovedLineInfo,
): string {
  const verb = lineType === 'add' ? 'Moved from' : 'Moved to'
  if (moved.peerPath === currentFilePath) {
    return `${verb} line ${moved.peerStartLine}`
  }
  const slashIdx = moved.peerPath.lastIndexOf('/')
  const shortName = slashIdx >= 0 ? moved.peerPath.slice(slashIdx + 1) : moved.peerPath
  return `${verb} ${shortName}:${moved.peerStartLine}`
}
