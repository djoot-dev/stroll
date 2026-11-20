import type { HighlightSpan } from './highlighter'

export interface InlineChangeRange {
  /** 0-based inclusive character offset in line content */
  start: number
  /** 0-based exclusive character offset in line content */
  end: number
}

export interface InlineLineDiffResult {
  oldRanges: InlineChangeRange[]
  newRanges: InlineChangeRange[]
  similarity: number
}

export interface DiffTokenPart {
  text: string
  className: string
  ident: string | null
  changed: boolean
  changeStart: boolean
  changeEnd: boolean
}

interface InlineToken {
  text: string
  start: number
  end: number
  isWhitespace: boolean
}

const MAX_LINE_LENGTH = 1500
const MAX_DP_CELLS = 250_000
const MAX_BLOCK_PAIR_CELLS = 625
const MAX_ONE_TO_ONE_BLOCK = 100
export const MIN_PAIR_SIMILARITY = 0.3
export const MIN_MULTILINE_SIMILARITY = 0.35

const TOKEN_RE = /[\p{L}\p{N}_$]+|[\s\S]/gu
const NON_WS_TOKEN_RE = /[\p{L}\p{N}_$]+|[^\s]/gu
const WORD_TOKEN_RE = /^[\p{L}\p{N}_$]+$/u
const IDENT_SPLIT_RE = /([A-Za-z_$][\w$]*)/g
const IDENT_TEST_RE = /^[A-Za-z_$][\w$]*$/

function tokenizeLine(line: string): InlineToken[] {
  const tokens: InlineToken[] = []
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(line)) !== null) {
    const text = match[0]
    const start = match.index
    tokens.push({
      text,
      start,
      end: start + text.length,
      isWhitespace: /^\s+$/.test(text),
    })
  }
  return tokens
}

function collectRanges(tokens: InlineToken[], matched: boolean[]): InlineChangeRange[] {
  const ranges: InlineChangeRange[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (matched[i]) continue
    const tok = tokens[i]
    const prev = ranges[ranges.length - 1]
    if (prev && prev.end === tok.start) {
      prev.end = tok.end
    } else {
      ranges.push({ start: tok.start, end: tok.end })
    }
  }
  return ranges
}

/**
 * Computes word/token-level intra-line diff ranges between an old and new line.
 * Identifiers/words stay atomic while punctuation and whitespace are character-granular.
 */
export function computeInlineLineDiff(
  oldLine: string,
  newLine: string,
): InlineLineDiffResult {
  if (oldLine === newLine) {
    return { oldRanges: [], newRanges: [], similarity: 1 }
  }
  if (
    oldLine.length === 0 ||
    newLine.length === 0 ||
    oldLine.length > MAX_LINE_LENGTH ||
    newLine.length > MAX_LINE_LENGTH
  ) {
    return { oldRanges: [], newRanges: [], similarity: 0 }
  }

  const oldTokens = tokenizeLine(oldLine)
  const newTokens = tokenizeLine(newLine)
  const oldLen = oldTokens.length
  const newLen = newTokens.length

  const oldMatched = new Array<boolean>(oldLen).fill(false)
  const newMatched = new Array<boolean>(newLen).fill(false)

  // Strip common prefix tokens
  let prefix = 0
  while (
    prefix < oldLen &&
    prefix < newLen &&
    oldTokens[prefix].text === newTokens[prefix].text
  ) {
    oldMatched[prefix] = true
    newMatched[prefix] = true
    prefix += 1
  }

  // Strip common suffix tokens
  let suffix = 0
  while (
    prefix + suffix < oldLen &&
    prefix + suffix < newLen &&
    oldTokens[oldLen - 1 - suffix].text === newTokens[newLen - 1 - suffix].text
  ) {
    oldMatched[oldLen - 1 - suffix] = true
    newMatched[newLen - 1 - suffix] = true
    suffix += 1
  }

  const midOldLen = oldLen - prefix - suffix
  const midNewLen = newLen - prefix - suffix

  if (midOldLen > 0 && midNewLen > 0) {
    if (midOldLen * midNewLen > MAX_DP_CELLS) {
      return { oldRanges: [], newRanges: [], similarity: 0 }
    }

    const cols = midNewLen + 1
    const dp = new Int32Array((midOldLen + 1) * cols)

    for (let i = midOldLen - 1; i >= 0; i--) {
      const oldTok = oldTokens[prefix + i].text
      for (let j = midNewLen - 1; j >= 0; j--) {
        const idx = i * cols + j
        if (oldTok === newTokens[prefix + j].text) {
          dp[idx] = 1 + dp[(i + 1) * cols + (j + 1)]
        } else {
          const down = dp[(i + 1) * cols + j]
          const right = dp[i * cols + (j + 1)]
          dp[idx] = down >= right ? down : right
        }
      }
    }

    let i = 0
    let j = 0
    while (i < midOldLen && j < midNewLen) {
      if (oldTokens[prefix + i].text === newTokens[prefix + j].text) {
        oldMatched[prefix + i] = true
        newMatched[prefix + j] = true
        i += 1
        j += 1
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
        i += 1
      } else {
        j += 1
      }
    }
  }

  let oldNonWs = 0
  let newNonWs = 0
  let matchedNonWs = 0
  let matchedAll = 0

  for (let i = 0; i < oldLen; i++) {
    const t = oldTokens[i]
    if (!t.isWhitespace) oldNonWs += t.text.length
    if (oldMatched[i]) {
      matchedAll += t.text.length
      if (!t.isWhitespace) matchedNonWs += t.text.length
    }
  }
  for (let j = 0; j < newLen; j++) {
    const t = newTokens[j]
    if (!t.isWhitespace) newNonWs += t.text.length
  }

  const similarity =
    oldNonWs === 0 && newNonWs === 0
      ? (2 * matchedAll) / Math.max(1, oldLine.length + newLine.length)
      : (2 * matchedNonWs) / Math.max(1, oldNonWs + newNonWs)

  return {
    oldRanges: collectRanges(oldTokens, oldMatched),
    newRanges: collectRanges(newTokens, newMatched),
    similarity,
  }
}

export interface DiffLineLike {
  type: 'add' | 'del' | 'context'
  content: string
  inlineChanges?: InlineChangeRange[]
}

interface BlockToken {
  text: string
  lineIndex: number
  start: number
  end: number
  weight: number
}

export interface MultiLineBlockDiffResult {
  oldRangesByLine: InlineChangeRange[][]
  newRangesByLine: InlineChangeRange[][]
  similarity: number
}

function tokenizeBlockNonWs(lines: string[]): BlockToken[] {
  const tokens: BlockToken[] = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (line.length > MAX_LINE_LENGTH) return []
    NON_WS_TOKEN_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = NON_WS_TOKEN_RE.exec(line)) !== null) {
      const text = match[0]
      const start = match.index
      const isWord = WORD_TOKEN_RE.test(text)
      tokens.push({
        text,
        lineIndex,
        start,
        end: start + text.length,
        weight: isWord ? text.length + 2 : 1,
      })
    }
  }
  return tokens
}

function collectBlockRangesByLine(
  lineCount: number,
  tokens: BlockToken[],
  matched: boolean[],
): InlineChangeRange[][] {
  const rangesByLine: InlineChangeRange[][] = Array.from({ length: lineCount }, () => [])

  let idx = 0
  while (idx < tokens.length) {
    const lineIdx = tokens[idx].lineIndex
    const lineRanges = rangesByLine[lineIdx]
    let openRange: InlineChangeRange | null = null

    while (idx < tokens.length && tokens[idx].lineIndex === lineIdx) {
      if (matched[idx]) {
        openRange = null
      } else {
        const tok = tokens[idx]
        if (openRange) {
          // Bridge whitespace between consecutive unmatched tokens on the same line
          openRange.end = tok.end
        } else {
          openRange = { start: tok.start, end: tok.end }
          lineRanges.push(openRange)
        }
      }
      idx += 1
    }
  }

  return rangesByLine
}

/**
 * Diffs a multi-line deletion block against a multi-line addition block as flattened
 * non-whitespace token streams using weighted LCS (prioritizing identifiers/words over
 * punctuation). Handles line reflows, multi-line splits/merges, and block wrapping
 * (e.g., wrapping existing statements in `if (...) { ... }`).
 */
export function computeMultiLineBlockDiff(
  oldLines: string[],
  newLines: string[],
): MultiLineBlockDiffResult {
  const emptyResult: MultiLineBlockDiffResult = {
    oldRangesByLine: oldLines.map(() => []),
    newRangesByLine: newLines.map(() => []),
    similarity: 0,
  }

  if (oldLines.length === 0 || newLines.length === 0) return emptyResult

  const oldTokens = tokenizeBlockNonWs(oldLines)
  const newTokens = tokenizeBlockNonWs(newLines)
  const oldLen = oldTokens.length
  const newLen = newTokens.length
  if (oldLen === 0 || newLen === 0) return emptyResult

  const oldMatched = new Array<boolean>(oldLen).fill(false)
  const newMatched = new Array<boolean>(newLen).fill(false)

  // Strip common prefix tokens across the block
  let prefix = 0
  while (
    prefix < oldLen &&
    prefix < newLen &&
    oldTokens[prefix].text === newTokens[prefix].text
  ) {
    oldMatched[prefix] = true
    newMatched[prefix] = true
    prefix += 1
  }

  // Strip common suffix tokens across the block
  let suffix = 0
  while (
    prefix + suffix < oldLen &&
    prefix + suffix < newLen &&
    oldTokens[oldLen - 1 - suffix].text === newTokens[newLen - 1 - suffix].text
  ) {
    oldMatched[oldLen - 1 - suffix] = true
    newMatched[newLen - 1 - suffix] = true
    suffix += 1
  }

  const midOldLen = oldLen - prefix - suffix
  const midNewLen = newLen - prefix - suffix

  if (midOldLen > 0 && midNewLen > 0) {
    if (midOldLen * midNewLen > MAX_DP_CELLS) {
      return emptyResult
    }

    const cols = midNewLen + 1
    const dp = new Int32Array((midOldLen + 1) * cols)

    for (let i = midOldLen - 1; i >= 0; i--) {
      const oldTok = oldTokens[prefix + i]
      for (let j = midNewLen - 1; j >= 0; j--) {
        const idx = i * cols + j
        if (oldTok.text === newTokens[prefix + j].text) {
          dp[idx] = oldTok.weight + dp[(i + 1) * cols + (j + 1)]
        } else {
          const down = dp[(i + 1) * cols + j]
          const right = dp[i * cols + (j + 1)]
          dp[idx] = down >= right ? down : right
        }
      }
    }

    let i = 0
    let j = 0
    while (i < midOldLen && j < midNewLen) {
      const oldTok = oldTokens[prefix + i]
      if (
        oldTok.text === newTokens[prefix + j].text &&
        dp[i * cols + j] === oldTok.weight + dp[(i + 1) * cols + (j + 1)]
      ) {
        oldMatched[prefix + i] = true
        newMatched[prefix + j] = true
        i += 1
        j += 1
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
        i += 1
      } else {
        j += 1
      }
    }
  }

  let oldChars = 0
  let newChars = 0
  let matchedChars = 0
  for (let i = 0; i < oldLen; i++) {
    oldChars += oldTokens[i].text.length
    if (oldMatched[i]) matchedChars += oldTokens[i].text.length
  }
  for (let j = 0; j < newLen; j++) {
    newChars += newTokens[j].text.length
  }

  const similarity = (2 * matchedChars) / Math.max(1, oldChars + newChars)

  return {
    oldRangesByLine: collectBlockRangesByLine(oldLines.length, oldTokens, oldMatched),
    newRangesByLine: collectBlockRangesByLine(newLines.length, newTokens, newMatched),
    similarity,
  }
}

/**
 * Pairs contiguous deletion and addition blocks within a diff hunk and attaches
 * `inlineChanges` character ranges to modified lines. Uses hunk-level multi-line
 * weighted token diffing for reflows/wraps and falls back to monotonic line-by-line
 * pairing when blocks are mostly unrelated.
 */
export function applyInlineDiffsToHunk<T extends DiffLineLike>(lines: T[]): void {
  let idx = 0
  while (idx < lines.length) {
    if (lines[idx].type !== 'del') {
      idx += 1
      continue
    }

    const delStart = idx
    while (idx < lines.length && lines[idx].type === 'del') {
      idx += 1
    }
    const delEnd = idx

    const addStart = idx
    while (idx < lines.length && lines[idx].type === 'add') {
      idx += 1
    }
    const addEnd = idx

    const delCount = delEnd - delStart
    const addCount = addEnd - addStart
    if (delCount === 0 || addCount === 0) continue

    if (delCount === 1 && addCount === 1) {
      const delLine = lines[delStart]
      const addLine = lines[addStart]
      const res = computeInlineLineDiff(delLine.content, addLine.content)
      if (res.similarity >= MIN_PAIR_SIMILARITY) {
        if (res.oldRanges.length > 0) delLine.inlineChanges = res.oldRanges
        if (res.newRanges.length > 0) addLine.inlineChanges = res.newRanges
      }
      continue
    }

    // Try hunk-level multi-line weighted token diff first (handles reflows, splits, wraps)
    const delContents = lines.slice(delStart, delEnd).map((l) => l.content)
    const addContents = lines.slice(addStart, addEnd).map((l) => l.content)
    const multiRes = computeMultiLineBlockDiff(delContents, addContents)
    if (multiRes.similarity >= MIN_MULTILINE_SIMILARITY) {
      for (let i = 0; i < delCount; i++) {
        if (multiRes.oldRangesByLine[i].length > 0) {
          lines[delStart + i].inlineChanges = multiRes.oldRangesByLine[i]
        }
      }
      for (let j = 0; j < addCount; j++) {
        if (multiRes.newRangesByLine[j].length > 0) {
          lines[addStart + j].inlineChanges = multiRes.newRangesByLine[j]
        }
      }
      continue
    }

    if (delCount * addCount <= MAX_BLOCK_PAIR_CELLS) {
      const results: InlineLineDiffResult[][] = Array.from({ length: delCount }, (_, i) =>
        Array.from({ length: addCount }, (_, j) =>
          computeInlineLineDiff(lines[delStart + i].content, lines[addStart + j].content),
        ),
      )

      // Weighted monotonic matching DP to maximize total similarity while preserving line order
      const cols = addCount + 1
      const dp = new Float64Array((delCount + 1) * cols)
      const choice = new Uint8Array((delCount + 1) * cols) // 0=skip del, 1=skip add, 2=pair

      for (let i = delCount - 1; i >= 0; i--) {
        for (let j = addCount - 1; j >= 0; j--) {
          let best = dp[(i + 1) * cols + j]
          let bestChoice = 0

          const skipAdd = dp[i * cols + (j + 1)]
          if (skipAdd > best) {
            best = skipAdd
            bestChoice = 1
          }

          const sim = results[i][j].similarity
          if (sim >= MIN_PAIR_SIMILARITY) {
            const pairScore = sim + dp[(i + 1) * cols + (j + 1)]
            if (pairScore > best) {
              best = pairScore
              bestChoice = 2
            }
          }

          dp[i * cols + j] = best
          choice[i * cols + j] = bestChoice
        }
      }

      let i = 0
      let j = 0
      while (i < delCount && j < addCount) {
        const c = choice[i * cols + j]
        if (c === 2) {
          const res = results[i][j]
          if (res.oldRanges.length > 0) lines[delStart + i].inlineChanges = res.oldRanges
          if (res.newRanges.length > 0) lines[addStart + j].inlineChanges = res.newRanges
          i += 1
          j += 1
        } else if (c === 0) {
          i += 1
        } else {
          j += 1
        }
      }
      continue
    }

    if (delCount === addCount && delCount <= MAX_ONE_TO_ONE_BLOCK) {
      for (let k = 0; k < delCount; k++) {
        const delLine = lines[delStart + k]
        const addLine = lines[addStart + k]
        const res = computeInlineLineDiff(delLine.content, addLine.content)
        if (res.similarity >= MIN_PAIR_SIMILARITY) {
          if (res.oldRanges.length > 0) delLine.inlineChanges = res.oldRanges
          if (res.newRanges.length > 0) addLine.inlineChanges = res.newRanges
        }
      }
    }
  }
}

const QUALIFIER_BEFORE_RE = /([A-Za-z_$][\w$]*)[ \t]*(\.|::)[ \t]*$/
const CALL_OR_GENERIC_AFTER_RE = /^[ \t]*[(<]/

/**
 * Hover key for the identifier `piece` at [start, end) in `lineText`. Member accesses
 * (`Status.Active`, `Limits::MAX`) that aren't calls try the qualified name first so
 * enum members and type-scoped constants resolve; otherwise the bare name is used.
 */
function resolveHoverIdent(
  lineText: string,
  start: number,
  end: number,
  piece: string,
  symbolIndex: { has(name: string): boolean },
): string | null {
  const before = lineText.slice(Math.max(0, start - 128), start)
  const q = QUALIFIER_BEFORE_RE.exec(before)
  if (q && !CALL_OR_GENERIC_AFTER_RE.test(lineText.slice(end))) {
    const qualified = `${q[1]}${q[2]}${piece}`
    if (symbolIndex.has(qualified)) return qualified
  }
  return piece.length >= 2 && symbolIndex.has(piece) ? piece : null
}

/**
 * Composes CodeMirror syntax highlight spans, hoverable PR identifiers, and
 * intra-line changed character ranges into renderable `DiffTokenPart` slices.
 */
export function buildLineTokenParts(
  spans: HighlightSpan[],
  symbolIndex: { has(name: string): boolean },
  inlineChanges?: InlineChangeRange[],
): DiffTokenPart[] {
  const parts: DiffTokenPart[] = []
  const ranges = inlineChanges && inlineChanges.length > 0 ? inlineChanges : null
  const lineText = spans.map((sp) => sp.text).join('')
  let charOffset = 0
  let rangeIdx = 0

  for (const sp of spans) {
    const pieces = sp.text.split(IDENT_SPLIT_RE)
    for (const piece of pieces) {
      if (!piece) continue
      const pieceStart = charOffset
      const pieceEnd = charOffset + piece.length
      charOffset = pieceEnd

      const ident = IDENT_TEST_RE.test(piece)
        ? resolveHoverIdent(lineText, pieceStart, pieceEnd, piece, symbolIndex)
        : null

      if (!ranges) {
        parts.push({
          text: piece,
          className: sp.className,
          ident,
          changed: false,
          changeStart: false,
          changeEnd: false,
        })
        continue
      }

      while (rangeIdx < ranges.length && ranges[rangeIdx].end <= pieceStart) {
        rangeIdx += 1
      }

      let cursor = pieceStart
      let rIdx = rangeIdx
      while (rIdx < ranges.length && ranges[rIdx].start < pieceEnd) {
        const r = ranges[rIdx]
        const overlapStart = Math.max(cursor, r.start)
        const overlapEnd = Math.min(pieceEnd, r.end)

        if (overlapStart > cursor) {
          parts.push({
            text: piece.slice(cursor - pieceStart, overlapStart - pieceStart),
            className: sp.className,
            ident,
            changed: false,
            changeStart: false,
            changeEnd: false,
          })
        }

        if (overlapEnd > overlapStart) {
          parts.push({
            text: piece.slice(overlapStart - pieceStart, overlapEnd - pieceStart),
            className: sp.className,
            ident,
            changed: true,
            changeStart: overlapStart === r.start,
            changeEnd: overlapEnd === r.end,
          })
          cursor = overlapEnd
        }

        if (r.end <= pieceEnd) {
          rIdx += 1
        } else {
          break
        }
      }

      if (cursor < pieceEnd) {
        parts.push({
          text: piece.slice(cursor - pieceStart),
          className: sp.className,
          ident,
          changed: false,
          changeStart: false,
          changeEnd: false,
        })
      }
    }
  }

  return parts
}
