export interface FormatResult {
  text: string
  selectionStart: number
  selectionEnd: number
}

export type MarkdownFormatAction =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'codeBlock'
  | 'link'
  | 'quote'
  | 'bulletList'
  | 'numberedList'
  | 'taskList'

const INLINE_MARKERS: Record<'bold' | 'italic' | 'strikethrough' | 'code', string> = {
  bold: '**',
  italic: '*',
  strikethrough: '~~',
  code: '`',
}

/**
 * Returns the trimmed URL if `raw` is a single valid `http:` or `https:` URL
 * with no internal whitespace, or `null` otherwise.
 */
export function extractHttpUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  if (!/^https?:\/\//i.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
      return trimmed
    }
  } catch {
    return null
  }
  return null
}

/**
 * Checks whether the caret at `pos` in `body` is inside a fenced code block
 * (odd number of ``` or ~~~ fence lines above it).
 */
function isInsideFencedCodeBlock(body: string, pos: number): boolean {
  const before = body.slice(0, pos)
  const lines = before.split('\n')
  // Exclude the current incomplete line from fence toggling if it only opened on this line?
  // Actually any complete fence line before the current line toggles state.
  let inFence = false
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*(?:```|~~~)/.test(lines[i])) {
      inFence = !inFence
    }
  }
  return inFence
}

/**
 * Checks whether the caret at `pos` is inside an inline code span on the current line.
 */
function isInsideInlineCode(body: string, pos: number): boolean {
  const lineStart = body.lastIndexOf('\n', pos - 1) + 1
  const beforeOnLine = body.slice(lineStart, pos)
  let backtickCount = 0
  for (let i = 0; i < beforeOnLine.length; i++) {
    if (beforeOnLine[i] === '`' && beforeOnLine[i - 1] !== '\\') {
      backtickCount++
    }
  }
  return backtickCount % 2 === 1
}

/**
 * Checks whether the caret is already inside a markdown link target `](...)`
 * or immediately inside `[](` where wrapping again would produce broken syntax.
 */
function isInsideMarkdownLink(body: string, selectionStart: number, selectionEnd: number): boolean {
  const lineStart = body.lastIndexOf('\n', selectionStart - 1) + 1
  const beforeOnLine = body.slice(lineStart, selectionStart)
  const lastOpen = beforeOnLine.lastIndexOf('](')
  if (lastOpen !== -1) {
    const lastClose = beforeOnLine.lastIndexOf(')')
    if (lastClose < lastOpen) {
      return true
    }
  }

  const beforeChar = body[selectionStart - 1]
  const afterSlice = body.slice(selectionEnd, selectionEnd + 2)
  if (beforeChar === '[' && afterSlice === '](') {
    return true
  }

  return false
}

/**
 * Auto-formats a pasted HTTP(S) URL as a Markdown link:
 * - No selection: inserts `[](url)` with the cursor placed inside `[]`.
 * - Single-line non-empty selection: wraps as `[selected](url)` with cursor at the end.
 * - Returns `null` when the pasted text is not a URL or when the cursor is inside
 *   code or an existing markdown link target (letting default paste proceed).
 */
export function formatPastedLink(
  body: string,
  pastedText: string,
  selectionStart: number,
  selectionEnd: number,
): FormatResult | null {
  const url = extractHttpUrl(pastedText)
  if (!url) return null

  const start = Math.max(0, Math.min(selectionStart, body.length))
  const end = Math.max(start, Math.min(selectionEnd, body.length))

  if (
    isInsideFencedCodeBlock(body, start) ||
    isInsideInlineCode(body, start) ||
    isInsideMarkdownLink(body, start, end)
  ) {
    return null
  }

  const selected = body.slice(start, end)
  if (selected.includes('\n')) {
    return null
  }

  const before = body.slice(0, start)
  const after = body.slice(end)

  if (selected.trim().length > 0) {
    const formatted = `[${selected}](${url})`
    const cursor = start + formatted.length
    return {
      text: `${before}${formatted}${after}`,
      selectionStart: cursor,
      selectionEnd: cursor,
    }
  }

  const formatted = `[](${url})`
  const cursorInsideBrackets = start + 1
  return {
    text: `${before}${formatted}${after}`,
    selectionStart: cursorInsideBrackets,
    selectionEnd: cursorInsideBrackets,
  }
}

function hasSurroundingMarker(before: string, after: string, marker: string): boolean {
  if (!before.endsWith(marker) || !after.startsWith(marker)) return false
  if (marker === '*') {
    // Avoid mistaking `**bold**` for `*italic*`
    const beforeIsDouble = before.endsWith('**') && !before.endsWith('***')
    const afterIsDouble = after.startsWith('**') && !after.startsWith('***')
    if (beforeIsDouble || afterIsDouble) return false
  }
  return true
}

function applyInlineWrap(
  body: string,
  marker: string,
  start: number,
  end: number,
): FormatResult {
  const before = body.slice(0, start)
  const selected = body.slice(start, end)
  const after = body.slice(end)

  // Toggle off if the selection itself includes the surrounding markers
  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    !(marker === '*' && selected.startsWith('**') && selected.endsWith('**'))
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length)
    return {
      text: `${before}${inner}${after}`,
      selectionStart: start,
      selectionEnd: start + inner.length,
    }
  }

  // Toggle off if the markers sit immediately outside the selection
  if (hasSurroundingMarker(before, after, marker)) {
    const nextBefore = before.slice(0, before.length - marker.length)
    const nextAfter = after.slice(marker.length)
    return {
      text: `${nextBefore}${selected}${nextAfter}`,
      selectionStart: start - marker.length,
      selectionEnd: end - marker.length,
    }
  }

  const wrapped = `${marker}${selected}${marker}`
  return {
    text: `${before}${wrapped}${after}`,
    selectionStart: start + marker.length,
    selectionEnd: end + marker.length,
  }
}

function applyCodeBlock(body: string, start: number, end: number): FormatResult {
  const before = body.slice(0, start)
  const selected = body.slice(start, end)
  const after = body.slice(end)

  const leadingNewline = before.length > 0 && !before.endsWith('\n') ? '\n' : ''
  const trailingNewline = after.length > 0 && !after.startsWith('\n') ? '\n' : ''
  const open = `${leadingNewline}\`\`\`\n`
  const close = `\n\`\`\`${trailingNewline}`

  if (!selected) {
    const text = `${before}${open}${close}${after}`
    const cursor = before.length + open.length
    return { text, selectionStart: cursor, selectionEnd: cursor }
  }

  const text = `${before}${open}${selected}${close}${after}`
  const selStart = before.length + open.length
  return {
    text,
    selectionStart: selStart,
    selectionEnd: selStart + selected.length,
  }
}

function applyLinkFormat(body: string, start: number, end: number): FormatResult {
  const before = body.slice(0, start)
  const selected = body.slice(start, end)
  const after = body.slice(end)

  if (selected.trim().length > 0 && !selected.includes('\n')) {
    const maybeUrl = extractHttpUrl(selected)
    if (maybeUrl) {
      const formatted = `[](${maybeUrl})`
      return {
        text: `${before}${formatted}${after}`,
        selectionStart: start + 1,
        selectionEnd: start + 1,
      }
    }

    const formatted = `[${selected}](url)`
    const urlStart = start + 1 + selected.length + 2
    return {
      text: `${before}${formatted}${after}`,
      selectionStart: urlStart,
      selectionEnd: urlStart + 3,
    }
  }

  const formatted = '[](url)'
  const urlStart = start + 3
  return {
    text: `${before}${formatted}${after}`,
    selectionStart: urlStart,
    selectionEnd: urlStart + 3,
  }
}

function applyLinePrefix(
  body: string,
  action: 'quote' | 'bulletList' | 'numberedList' | 'taskList',
  start: number,
  end: number,
): FormatResult {
  const lineStart = body.lastIndexOf('\n', start - 1) + 1
  const nextNewline = body.indexOf('\n', end)
  const lineEnd = nextNewline === -1 ? body.length : nextNewline

  const before = body.slice(0, lineStart)
  const block = body.slice(lineStart, lineEnd)
  const after = body.slice(lineEnd)
  const lines = block.split('\n')

  const stripPattern =
    action === 'quote'
      ? /^>\s?/
      : action === 'taskList'
        ? /^-\s\[[ xX]\]\s/
        : action === 'bulletList'
          ? /^[-*]\s/
          : /^\d+\.\s/

  const allPrefixed = lines.every((line) => stripPattern.test(line))

  const transformedLines = allPrefixed
    ? lines.map((line) => line.replace(stripPattern, ''))
    : lines.map((line, index) => {
        if (action === 'quote') return `> ${line}`
        if (action === 'taskList') return `- [ ] ${line}`
        if (action === 'bulletList') return `- ${line}`
        return `${index + 1}. ${line}`
      })

  const nextBlock = transformedLines.join('\n')
  const text = `${before}${nextBlock}${after}`

  if (start === end) {
    const delta = transformedLines[0].length - lines[0].length
    const cursor = Math.max(lineStart, start + delta)
    return { text, selectionStart: cursor, selectionEnd: cursor }
  }

  return {
    text,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  }
}

/**
 * Computes the minimal contiguous replacement `(start, end, replacement)`
 * needed to transform `before` into `after`.
 */
export function computeTextDiff(
  before: string,
  after: string,
): { start: number; end: number; replacement: string } {
  let start = 0
  const minLen = Math.min(before.length, after.length)
  while (start < minLen && before[start] === after[start]) {
    start++
  }

  let beforeEnd = before.length
  let afterEnd = after.length
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd--
    afterEnd--
  }

  return {
    start,
    end: beforeEnd,
    replacement: after.slice(start, afterEnd),
  }
}

/**
 * Applies a Markdown formatting action to `body` at the given selection range
 * and returns the updated text and selection range.
 */
export function applyMarkdownFormat(
  body: string,
  action: MarkdownFormatAction,
  selectionStart: number,
  selectionEnd: number,
): FormatResult {
  const start = Math.max(0, Math.min(selectionStart, body.length))
  const end = Math.max(start, Math.min(selectionEnd, body.length))

  if (action === 'bold' || action === 'italic' || action === 'strikethrough' || action === 'code') {
    return applyInlineWrap(body, INLINE_MARKERS[action], start, end)
  }

  if (action === 'codeBlock') {
    return applyCodeBlock(body, start, end)
  }

  if (action === 'link') {
    return applyLinkFormat(body, start, end)
  }

  return applyLinePrefix(body, action, start, end)
}
