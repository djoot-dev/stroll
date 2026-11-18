import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import type { LanguageSupport } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { highlightTree } from '@lezer/highlight'

export function getLanguageSupport(language: string): LanguageSupport | null {
  switch (language) {
    case 'typescript':
      return javascript({ typescript: true, jsx: true })
    case 'javascript':
      return javascript({ jsx: true })
    case 'vue':
    case 'html':
      return html()
    case 'rust':
      return rust()
    case 'python':
      return python()
    case 'sql':
      return sql()
    case 'json':
      return json()
    case 'css':
      return css()
    case 'markdown':
      return markdown()
    case 'yaml':
      return yaml()
    default:
      return null
  }
}

export interface HighlightSpan {
  text: string
  className: string
}

/**
 * Tokenizes a single line (or small snippet) with CodeMirror 6's Lezer parser
 * and `oneDarkHighlightStyle` into styled spans.
 */
export function highlightLinesWithCodeMirror(
  lines: string[],
  language: string,
): HighlightSpan[][] {
  const support = getLanguageSupport(language)
  if (!support || lines.length === 0) {
    return lines.map((line) => [{ text: line || ' ', className: '' }])
  }

  const fullText = lines.join('\n')
  const tree = support.language.parser.parse(fullText)

  // Build per-character class array or collect ranges
  const ranges: Array<{ from: number; to: number; cls: string }> = []
  highlightTree(tree, oneDarkHighlightStyle, (from, to, classes) => {
    ranges.push({ from, to, cls: classes })
  })

  const result: HighlightSpan[][] = []
  let offset = 0
  let rangeIdx = 0

  for (const line of lines) {
    const lineStart = offset
    const lineEnd = offset + line.length
    const spans: HighlightSpan[] = []

    if (line.length === 0) {
      spans.push({ text: ' ', className: '' })
      result.push(spans)
      offset = lineEnd + 1
      continue
    }

    let cursor = lineStart
    while (rangeIdx < ranges.length && ranges[rangeIdx].to <= lineStart) {
      rangeIdx += 1
    }

    let idx = rangeIdx
    while (idx < ranges.length && ranges[idx].from < lineEnd) {
      const r = ranges[idx]
      const segStart = Math.max(cursor, r.from)
      const segEnd = Math.min(lineEnd, r.to)

      if (segStart > cursor) {
        spans.push({ text: fullText.slice(cursor, segStart), className: '' })
      }
      if (segEnd > segStart) {
        spans.push({ text: fullText.slice(segStart, segEnd), className: r.cls })
        cursor = segEnd
      }

      if (r.to <= lineEnd) {
        idx += 1
      } else {
        break
      }
    }

    if (cursor < lineEnd) {
      spans.push({ text: fullText.slice(cursor, lineEnd), className: '' })
    }

    result.push(spans)
    offset = lineEnd + 1
  }

  return result
}
