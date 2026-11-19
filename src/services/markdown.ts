/**
 * Lightweight, XSS-safe Markdown-to-HTML renderer for PR descriptions and comments.
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

function renderInline(raw: string): string {
  // Split around inline code spans first so markdown inside backticks isn't transformed
  const parts = raw.split(/(`[^`]+`)/g)
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1 && part.startsWith('`') && part.endsWith('`')) {
        const code = escapeHtml(part.slice(1, -1))
        return `<code class="rounded bg-canvas-elevated px-1.5 py-0.5 font-mono text-[0.85em] text-ink">${code}</code>`
      }

      let html = escapeHtml(part)

      // Markdown links: [label](url)
      html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
        const safe = sanitizeHref(url)
        if (!safe) return `${label} (${url})`
        return `<a href="${safe}" data-external-url="${safe}" class="font-medium text-terra-text underline decoration-terra-border underline-offset-2 transition-colors hover:text-terra">${label}</a>`
      })

      // Bare http(s) URLs not already inside an href or data-external-url attribute
      html = html.replace(
        /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        (_match, prefix: string, url: string) => {
          const safe = sanitizeHref(url)
          if (!safe) return `${prefix}${url}`
          return `${prefix}<a href="${safe}" data-external-url="${safe}" class="font-medium text-terra-text underline decoration-terra-border underline-offset-2 transition-colors hover:text-terra">${safe}</a>`
        },
      )

      // Bold: **text** or __text__
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-ink">$1</strong>')
      html = html.replace(/__([^_]+)__/g, '<strong class="font-semibold text-ink">$1</strong>')

      // Strikethrough: ~~text~~
      html = html.replace(/~~([^~]+)~~/g, '<del class="text-ink-muted line-through">$1</del>')

      // Italic: *text*
      html = html.replace(/(^|[^\w*])\*([^*]+)\*(?!\*)/g, '$1<em class="italic">$2</em>')

      return html
    })
    .join('')
}

export function renderSafeMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim()
  if (!normalized) return ''

  const lines = normalized.split('\n')
  const out: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const fenceMatch = line.match(/^```([\w+-]*)\s*$/)
    if (fenceMatch) {
      const lang = fenceMatch[1] ? escapeHtml(fenceMatch[1]) : ''
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1 // skip closing fence
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

    // Heading (# to ####)
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const classes: Record<number, string> = {
        1: 'mt-4 mb-2 text-base font-bold text-ink first:mt-0',
        2: 'mt-4 mb-1.5 text-sm font-bold text-ink first:mt-0',
        3: 'mt-3 mb-1 text-[13px] font-semibold text-ink first:mt-0',
        4: 'mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted first:mt-0',
      }
      out.push(`<h${level} class="${classes[level]}">${renderInline(headingMatch[2].trim())}</h${level}>`)
      i += 1
      continue
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i += 1
      }
      out.push(
        `<blockquote class="my-2.5 border-l-2 border-terra-border bg-canvas/60 px-3 py-1.5 text-xs text-ink-muted">${quoteLines.map((l) => renderInline(l)).join('<br />')}</blockquote>`,
      )
      continue
    }

    // Unordered list (including GitHub task checkboxes)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      let isTaskList = false
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*+]\s+/, '')
        const taskMatch = content.match(/^\[([ xX])\]\s+(.*)$/)
        if (taskMatch) {
          isTaskList = true
          const checked = taskMatch[1].toLowerCase() === 'x'
          const box = checked
            ? '<span class="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-pine-border bg-pine text-[10px] font-bold text-white" aria-label="Checked">✓</span>'
            : '<span class="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-border bg-canvas" aria-label="Unchecked"></span>'
          items.push(
            `<li class="flex items-start gap-2">${box}<span class="${checked ? 'text-ink-muted line-through' : ''}">${renderInline(taskMatch[2])}</span></li>`,
          )
        } else {
          items.push(`<li>${renderInline(content)}</li>`)
        }
        i += 1
      }
      const listClass = isTaskList
        ? 'my-2 space-y-1.5 pl-0 list-none'
        : 'my-2 space-y-1 pl-5 list-disc marker:text-ink-faint'
      out.push(`<ul class="${listClass}">${items.join('')}</ul>`)
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+\.\s+/, '')
        items.push(`<li>${renderInline(content)}</li>`)
        i += 1
      }
      out.push(`<ol class="my-2 list-decimal space-y-1 pl-5 marker:text-ink-faint">${items.join('')}</ol>`)
      continue
    }

    // Paragraph (consume consecutive non-special lines)
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i])
      i += 1
    }
    out.push(`<p class="my-2 leading-relaxed first:mt-0 last:mb-0">${paraLines.map((l) => renderInline(l)).join('<br />')}</p>`)
  }

  return out.join('')
}
