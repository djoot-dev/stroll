/**
 * Formats a string as a Markdown blockquote (`> ` prefix per line) followed by a blank line.
 */
export function formatBlockquote(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').trim()
  if (!trimmed) return ''
  const quoted = trimmed
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
  return `${quoted}\n\n`
}

/**
 * Returns the currently selected text if the browser selection is inside `containerEl`,
 * otherwise falls back to `fullBody`.
 */
export function getCommentQuoteText(
  fullBody: string,
  containerEl?: HTMLElement | null,
): string {
  if (typeof window !== 'undefined' && containerEl) {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      if (containerEl.contains(range.commonAncestorContainer)) {
        const selected = sel.toString().trim()
        if (selected) return selected
      }
    }
  }
  return fullBody
}

/**
 * Appends a blockquote to an existing comment draft without clobbering user text.
 */
export function appendQuoteToDraft(currentDraft: string, rawToQuote: string): string {
  const block = formatBlockquote(rawToQuote)
  if (!block) return currentDraft
  if (!currentDraft.trim()) return block
  const sep = currentDraft.endsWith('\n\n')
    ? ''
    : currentDraft.endsWith('\n')
      ? '\n'
      : '\n\n'
  return `${currentDraft}${sep}${block}`
}
