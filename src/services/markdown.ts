/**
 * Lightweight, XSS-safe GitHub-Flavored Markdown-to-HTML renderer for PR descriptions,
 * review comments, and Markdown file previews.
 * Escapes all raw HTML before applying block and inline formatting.
 * External links are tagged with `data-external-url` so callers can delegate clicks
 * to `openExternalUrl()` (Tauri plugin-opener / browser fallback).
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeHref(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return null
}

function applyEmphasis(html: string): string {
  // Bold + Italic: ***text*** or ___text___
  html = html.replace(
    /\*\*\*([^*]+)\*\*\*/g,
    '<strong class="font-semibold text-ink"><em class="italic">$1</em></strong>',
  )
  html = html.replace(
    /___([^_]+)___/g,
    '<strong class="font-semibold text-ink"><em class="italic">$1</em></strong>',
  )

  // Bold: **text** or __text__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-ink">$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong class="font-semibold text-ink">$1</strong>')

  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+)~~/g, '<del class="text-ink-muted line-through">$1</del>')

  // Italic: *text* or _text_ (avoiding snake_case identifiers)
  html = html.replace(/(^|[^\w*])\*([^*]+)\*(?!\*)/g, '$1<em class="italic">$2</em>')
  html = html.replace(/(^|[^\w_])_([^_]+)_(?![\w_])/g, '$1<em class="italic">$2</em>')

  return html
}

function renderInline(raw: string): string {
  // Split around inline code spans first (double or single backticks) so markdown inside isn't transformed
  const parts = raw.split(/(``(?:[^`]|`(?!`))+``|`[^`]+`)/g)
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) {
        const inner = part.startsWith('``') && part.endsWith('``')
          ? part.slice(2, -2).trim()
          : part.slice(1, -1)
        return `<code class="rounded bg-canvas-elevated px-1.5 py-0.5 font-mono text-[0.85em] text-ink">${escapeHtml(inner)}</code>`
      }

      let html = escapeHtml(part)
      const tokens: string[] = []
      const stash = (tag: string): string => {
        const id = tokens.length
        tokens.push(tag)
        return `\u0000MDTAG${id}\u0000`
      }

      // Images: ![alt](url)
      html = html.replace(
        /!\[([^\]]*)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g,
        (_match, alt: string, url: string) => {
          const safe = sanitizeHref(url)
          if (!safe) return alt ? `${alt} (${url})` : url
          return stash(
            `<img src="${safe}" alt="${alt}" loading="lazy" class="my-2 max-h-96 max-w-full rounded-lg border border-border object-contain" />`,
          )
        },
      )

      // Markdown links: [label](url)
      html = html.replace(
        /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g,
        (_match, label: string, url: string) => {
          const safe = sanitizeHref(url)
          if (!safe) return `${label} (${url})`
          return stash(
            `<a href="${safe}" data-external-url="${safe}" class="font-medium text-terra-text underline decoration-terra-border underline-offset-2 transition-colors hover:text-terra">${applyEmphasis(label)}</a>`,
          )
        },
      )

      // Bare http(s) URLs
      html = html.replace(
        /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        (_match, prefix: string, url: string) => {
          const safe = sanitizeHref(url)
          if (!safe) return `${prefix}${url}`
          return `${prefix}${stash(
            `<a href="${safe}" data-external-url="${safe}" class="font-medium text-terra-text underline decoration-terra-border underline-offset-2 transition-colors hover:text-terra">${safe}</a>`,
          )}`
        },
      )

      html = applyEmphasis(html)

      return html.replace(/\u0000MDTAG(\d+)\u0000/g, (_m, id: string) => tokens[Number(id)] ?? '')
    })
    .join('')
}

const HEADING_CLASSES: Record<number, string> = {
  1: 'mt-4 mb-2 text-base font-bold text-ink first:mt-0',
  2: 'mt-4 mb-1.5 text-sm font-bold text-ink first:mt-0',
  3: 'mt-3 mb-1 text-[13px] font-semibold text-ink first:mt-0',
  4: 'mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted first:mt-0',
  5: 'mt-2 mb-1 text-xs font-semibold text-ink-muted first:mt-0',
  6: 'mt-2 mb-1 text-[11px] font-semibold text-ink-faint first:mt-0',
}

const ALERT_STYLES: Record<string, { label: string; wrapper: string; title: string }> = {
  NOTE: {
    label: 'Note',
    wrapper: 'border-terra-border bg-terra-soft/40',
    title: 'text-terra-text',
  },
  TIP: {
    label: 'Tip',
    wrapper: 'border-pine-border bg-pine-soft/40',
    title: 'text-pine-text',
  },
  IMPORTANT: {
    label: 'Important',
    wrapper: 'border-plum-border bg-plum-soft/40',
    title: 'text-plum-text',
  },
  WARNING: {
    label: 'Warning',
    wrapper: 'border-ochre-border bg-ochre-soft/40',
    title: 'text-ochre-text',
  },
  CAUTION: {
    label: 'Caution',
    wrapper: 'border-crimson-border bg-crimson-soft/40',
    title: 'text-crimson-text',
  },
}

const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/

function splitTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((cell) => cell.trim())
}

function parseTableAlignments(separatorLine: string): Array<'left' | 'center' | 'right'> {
  return splitTableRow(separatorLine).map((cell) => {
    const starts = cell.startsWith(':')
    const ends = cell.endsWith(':')
    if (starts && ends) return 'center'
    if (ends) return 'right'
    return 'left'
  })
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false
  const header = lines[index]
  const sep = lines[index + 1]
  return header.includes('|') && TABLE_SEPARATOR_RE.test(sep)
}

interface TaskCounter {
  index: number
}

function parseList(
  lines: string[],
  startIndex: number,
  baseIndent: number,
  ordered: boolean,
  interactiveChecklist: boolean,
  taskCounter: TaskCounter,
): { html: string; nextIndex: number } {
  const items: string[] = []
  let isTaskList = false
  let i = startIndex

  while (i < lines.length) {
    const match = lines[i].match(LIST_ITEM_RE)
    if (!match) break

    const indent = match[1].length
    const isItemOrdered = /^\d+\.$/.test(match[2])

    if (indent < baseIndent) break
    if (indent === baseIndent && isItemOrdered !== ordered) break

    if (indent > baseIndent) {
      // Malformed leading deeper indent without a parent item: treat at current level
      const nested = parseList(lines, i, indent, isItemOrdered, interactiveChecklist, taskCounter)
      if (items.length > 0) {
        const last = items[items.length - 1]
        items[items.length - 1] = last.replace(/<\/li>$/, `${nested.html}</li>`)
      } else {
        items.push(`<li>${nested.html}</li>`)
      }
      i = nested.nextIndex
      continue
    }

    const content = match[3]
    let itemBody: string
    const taskMatch = !ordered ? content.match(/^\[([ xX])\]\s+(.*)$/) : null
    if (taskMatch) {
      isTaskList = true
      const taskIndex = taskCounter.index++
      const checked = taskMatch[1].toLowerCase() === 'x'
      const box = interactiveChecklist
        ? checked
          ? `<button type="button" data-task-index="${taskIndex}" aria-label="Checked" aria-pressed="true" title="Mark as incomplete" class="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded border border-pine-border bg-pine text-[10px] font-bold text-white transition-colors hover:bg-pine-hover">✓</button>`
          : `<button type="button" data-task-index="${taskIndex}" aria-label="Unchecked" aria-pressed="false" title="Mark as complete" class="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded border border-border bg-canvas transition-colors hover:border-terra-border"></button>`
        : checked
          ? '<span class="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-pine-border bg-pine text-[10px] font-bold text-white" aria-label="Checked">✓</span>'
          : '<span class="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border bg-canvas" aria-label="Unchecked"></span>'
      itemBody = `<div class="flex items-start gap-2">${box}<span class="${checked ? 'text-ink-muted line-through' : ''}">${renderInline(taskMatch[2])}</span></div>`
    } else {
      itemBody = renderInline(content)
    }

    i += 1

    // Check for nested sub-list immediately following this item
    if (i < lines.length) {
      const nextMatch = lines[i].match(LIST_ITEM_RE)
      if (nextMatch && nextMatch[1].length > baseIndent) {
        const nestedOrdered = /^\d+\.$/.test(nextMatch[2])
        const nested = parseList(
          lines,
          i,
          nextMatch[1].length,
          nestedOrdered,
          interactiveChecklist,
          taskCounter,
        )
        itemBody += nested.html
        i = nested.nextIndex
      }
    }

    items.push(`<li>${itemBody}</li>`)
  }

  if (ordered) {
    return {
      html: `<ol class="my-2 list-decimal space-y-1 pl-5 marker:text-ink-faint">${items.join('')}</ol>`,
      nextIndex: i,
    }
  }

  const listClass = isTaskList
    ? 'my-2 space-y-1.5 pl-0 list-none'
    : 'my-2 space-y-1 pl-5 list-disc marker:text-ink-faint'
  return {
    html: `<ul class="${listClass}">${items.join('')}</ul>`,
    nextIndex: i,
  }
}

export interface MarkdownRenderOptions {
  originalLines?: string[]
  interactiveChecklist?: boolean
}

export interface ChecklistProgress {
  total: number
  completed: number
}

interface TaskCheckboxMatch {
  checked: boolean
  charOffset: number
}

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/

/**
 * Locate all Markdown task list checkboxes outside fenced code blocks and HTML comments,
 * returning their checked state and exact character offset in `markdown`.
 */
function findTaskCheckboxes(markdown: string): TaskCheckboxMatch[] {
  const results: TaskCheckboxMatch[] = []
  const len = markdown.length
  let i = 0
  let inFence: { char: string; len: number } | null = null
  let inHtmlComment = false

  while (i < len) {
    const lineEnd = (() => {
      const nl = markdown.indexOf('\n', i)
      return nl === -1 ? len : nl
    })()
    const rawLine = markdown.slice(i, lineEnd)
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

    if (inFence) {
      const closeRe = new RegExp(`^${inFence.char}{${inFence.len},}\\s*$`)
      if (closeRe.test(line)) {
        inFence = null
      }
      i = lineEnd + 1
      continue
    }

    if (!inHtmlComment) {
      const fenceMatch = line.match(/^(`{3,}|~{3,})([\w+-]*)\s*$/)
      if (fenceMatch) {
        inFence = { char: fenceMatch[1][0], len: fenceMatch[1].length }
        i = lineEnd + 1
        continue
      }
    }

    // Check if this line starts (outside an active HTML comment) with a task checkbox
    if (!inHtmlComment) {
      const taskMatch = line.match(TASK_LINE_RE)
      if (taskMatch) {
        results.push({
          checked: taskMatch[2].toLowerCase() === 'x',
          charOffset: i + taskMatch[1].length,
        })
      }
    }

    // Advance HTML comment state across the line (skipping inline code spans)
    let j = 0
    while (j < line.length) {
      if (inHtmlComment) {
        const closeIdx = line.indexOf('-->', j)
        if (closeIdx === -1) {
          j = line.length
        } else {
          inHtmlComment = false
          j = closeIdx + 3
        }
        continue
      }

      if (line[j] === '`') {
        let tickCount = 0
        while (j + tickCount < line.length && line[j + tickCount] === '`') {
          tickCount += 1
        }
        const closeTicks = '`'.repeat(tickCount)
        let searchFrom = j + tickCount
        let foundClose = -1
        while (searchFrom < line.length) {
          const idx = line.indexOf(closeTicks, searchFrom)
          if (idx === -1) break
          const beforeOk = idx === 0 || line[idx - 1] !== '`'
          const afterOk = idx + tickCount >= line.length || line[idx + tickCount] !== '`'
          if (beforeOk && afterOk) {
            foundClose = idx + tickCount
            break
          }
          searchFrom = idx + 1
        }
        j = foundClose !== -1 ? foundClose : j + tickCount
        continue
      }

      if (line.startsWith('<!--', j)) {
        inHtmlComment = true
        j += 4
        continue
      }

      j += 1
    }

    i = lineEnd + 1
  }

  return results
}

export function parseChecklistProgress(markdown: string): ChecklistProgress {
  const boxes = findTaskCheckboxes(markdown)
  let completed = 0
  for (const box of boxes) {
    if (box.checked) completed += 1
  }
  return { total: boxes.length, completed }
}

export function toggleChecklistItem(markdown: string, targetIndex: number): string {
  const boxes = findTaskCheckboxes(markdown)
  const target = boxes[targetIndex]
  if (!target) return markdown
  const nextChar = target.checked ? ' ' : 'x'
  return (
    markdown.slice(0, target.charOffset) +
    nextChar +
    markdown.slice(target.charOffset + 1)
  )
}

function stripHtmlComments(markdown: string): string {
  const out: string[] = []
  let i = 0
  const len = markdown.length

  while (i < len) {
    // Preserve fenced code blocks (``` or ~~~) verbatim
    if (i === 0 || markdown[i - 1] === '\n') {
      const restOfLineEnd = markdown.indexOf('\n', i)
      const lineEnd = restOfLineEnd === -1 ? len : restOfLineEnd
      const line = markdown.slice(i, lineEnd)
      const fenceMatch = line.match(/^(`{3,}|~{3,})([\w+-]*)\s*$/)
      if (fenceMatch) {
        const fenceChar = fenceMatch[1][0]
        const fenceLen = fenceMatch[1].length
        const closeRe = new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`)
        let pos = lineEnd
        while (pos < len) {
          const nextNl = markdown.indexOf('\n', pos + 1)
          const nextEnd = nextNl === -1 ? len : nextNl
          const nextLine = markdown.slice(pos + 1, nextEnd)
          pos = nextEnd
          if (closeRe.test(nextLine)) {
            break
          }
        }
        out.push(markdown.slice(i, pos))
        i = pos
        continue
      }
    }

    // Preserve inline code spans (`...` or ``...``) verbatim
    if (markdown[i] === '`') {
      let tickCount = 0
      while (i + tickCount < len && markdown[i + tickCount] === '`') {
        tickCount += 1
      }
      const closeTicks = '`'.repeat(tickCount)
      let searchFrom = i + tickCount
      let foundClose = -1
      while (searchFrom < len) {
        const idx = markdown.indexOf(closeTicks, searchFrom)
        if (idx === -1) break
        const beforeOk = idx === 0 || markdown[idx - 1] !== '`'
        const afterOk = idx + tickCount >= len || markdown[idx + tickCount] !== '`'
        if (beforeOk && afterOk) {
          foundClose = idx + tickCount
          break
        }
        searchFrom = idx + 1
      }
      if (foundClose !== -1) {
        out.push(markdown.slice(i, foundClose))
        i = foundClose
        continue
      }
      out.push(closeTicks)
      i += tickCount
      continue
    }

    // Strip HTML comments outside code blocks and code spans
    if (markdown.startsWith('<!--', i)) {
      const closeIdx = markdown.indexOf('-->', i + 4)
      if (closeIdx !== -1) {
        i = closeIdx + 3
        continue
      }
    }

    out.push(markdown[i])
    i += 1
  }

  return out.join('')
}

function renderSuggestionBlock(codeLines: string[], originalLines?: string[]): string {
  const removedHtml = (originalLines ?? [])
    .map(
      (l) =>
        `<div class="flex gap-2 bg-crimson-soft/50 px-3 py-0.5 font-mono text-xs text-crimson-text"><span class="select-none opacity-75">-</span><span class="whitespace-pre-wrap break-all">${escapeHtml(l)}</span></div>`,
    )
    .join('')
  const addedHtml = codeLines
    .map(
      (l) =>
        `<div class="flex gap-2 bg-pine-soft/50 px-3 py-0.5 font-mono text-xs text-pine-text"><span class="select-none opacity-75">+</span><span class="whitespace-pre-wrap break-all">${escapeHtml(l)}</span></div>`,
    )
    .join('')

  return `<div class="my-3 overflow-hidden rounded-lg border border-pine-border/60 bg-code"><div class="flex items-center justify-between border-b border-border-muted bg-canvas-elevated/60 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-pine-text">Suggested change</div><div class="overflow-x-auto py-1">${removedHtml}${addedHtml}</div></div>`
}

export function renderSafeMarkdown(
  markdown: string,
  options?: MarkdownRenderOptions,
): string {
  const normalized = stripHtmlComments(markdown.replace(/\r\n?/g, '\n')).trim()
  if (!normalized) return ''

  const lines = normalized.split('\n')
  const out: string[] = []
  const interactiveChecklist = Boolean(options?.interactiveChecklist)
  const taskCounter: TaskCounter = { index: 0 }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block (``` or ~~~)
    const fenceMatch = line.match(/^(`{3,}|~{3,})([\w+-]*)\s*$/)
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0]
      const fenceLen = fenceMatch[1].length
      const lang = fenceMatch[2] ? escapeHtml(fenceMatch[2]) : ''
      const closeRe = new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`)
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // skip closing fence
      if (lang.toLowerCase() === 'suggestion') {
        out.push(renderSuggestionBlock(codeLines, options?.originalLines))
        continue
      }
      const langBadge = lang
        ? `<div class="border-b border-border-muted bg-canvas-elevated/50 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">${lang}</div>`
        : ''
      out.push(
        `<div class="my-3 overflow-hidden rounded-lg border border-border bg-code">${langBadge}<pre class="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-ink"><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`,
      )
      continue
    }

    // Blank line
    if (!line.trim()) {
      i += 1
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      out.push('<hr class="my-4 border-border-muted" />')
      i += 1
      continue
    }

    // Heading (# to ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      out.push(
        `<h${level} class="${HEADING_CLASSES[level]}">${renderInline(headingMatch[2].trim())}</h${level}>`,
      )
      i += 1
      continue
    }

    // Blockquote & GitHub Alerts
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }

      const alertMatch = quoteLines[0]?.trim().match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i)
      if (alertMatch) {
        const kind = alertMatch[1].toUpperCase()
        const style = ALERT_STYLES[kind]
        const bodyLines = quoteLines.slice(1)
        const bodyHtml = bodyLines.length > 0
          ? `<div class="mt-1 text-xs text-ink-secondary">${bodyLines.map((l) => renderInline(l)).join('<br />')}</div>`
          : ''
        out.push(
          `<div class="my-2.5 rounded-lg border-l-2 px-3 py-2 ${style.wrapper}"><div class="text-[11px] font-semibold uppercase tracking-wide ${style.title}">${style.label}</div>${bodyHtml}</div>`,
        )
      } else {
        out.push(
          `<blockquote class="my-2.5 border-l-2 border-terra-border bg-canvas/60 px-3 py-1.5 text-xs text-ink-muted">${quoteLines.map((l) => renderInline(l)).join('<br />')}</blockquote>`,
        )
      }
      continue
    }

    // GFM Table
    if (isTableStart(lines, i)) {
      const headers = splitTableRow(lines[i])
      const alignments = parseTableAlignments(lines[i + 1])
      i += 2

      const bodyRows: string[][] = []
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        lines[i].includes('|') &&
        !/^(`{3,}|~{3,})/.test(lines[i])
      ) {
        bodyRows.push(splitTableRow(lines[i]))
        i += 1
      }

      const alignClass = (idx: number): string => {
        const align = alignments[idx] ?? 'left'
        if (align === 'center') return 'text-center'
        if (align === 'right') return 'text-right'
        return 'text-left'
      }

      const ths = headers
        .map(
          (h, idx) =>
            `<th class="border-b border-border bg-canvas-elevated/60 px-3 py-1.5 font-semibold text-ink ${alignClass(idx)}">${renderInline(h)}</th>`,
        )
        .join('')

      const trs = bodyRows
        .map((row) => {
          const tds = headers
            .map(
              (_h, idx) =>
                `<td class="border-b border-border-muted px-3 py-1.5 text-ink-secondary ${alignClass(idx)}">${renderInline(row[idx] ?? '')}</td>`,
            )
            .join('')
          return `<tr class="last:[&>td]:border-b-0">${tds}</tr>`
        })
        .join('')

      out.push(
        `<div class="my-3 overflow-x-auto rounded-lg border border-border"><table class="w-full border-collapse text-xs"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`,
      )
      continue
    }

    // Unordered or ordered list (with nesting)
    const listMatch = line.match(LIST_ITEM_RE)
    if (listMatch) {
      const ordered = /^\d+\.$/.test(listMatch[2])
      const parsed = parseList(
        lines,
        i,
        listMatch[1].length,
        ordered,
        interactiveChecklist,
        taskCounter,
      )
      out.push(parsed.html)
      i = parsed.nextIndex
      continue
    }

    // Paragraph (consume consecutive non-special lines)
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(`{3,}|~{3,})/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim()) &&
      !isTableStart(lines, i)
    ) {
      paraLines.push(lines[i])
      i += 1
    }
    out.push(
      `<p class="my-2 leading-relaxed first:mt-0 last:mb-0">${paraLines.map((l) => renderInline(l)).join('<br />')}</p>`,
    )
  }

  return out.join('')
}
