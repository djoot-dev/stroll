import { cpp } from '@codemirror/lang-cpp'
import { css } from '@codemirror/lang-css'
import { go } from '@codemirror/lang-go'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sass } from '@codemirror/lang-sass'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language'
import { csharp, kotlin } from '@codemirror/legacy-modes/mode/clike'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { EditorView } from '@codemirror/view'
import { highlightTree, tags } from '@lezer/highlight'

const csharpSupport = new LanguageSupport(StreamLanguage.define(csharp))
const kotlinSupport = new LanguageSupport(StreamLanguage.define(kotlin))
const shellSupport = new LanguageSupport(StreamLanguage.define(shell))
const rubySupport = new LanguageSupport(StreamLanguage.define(ruby))
const swiftSupport = new LanguageSupport(StreamLanguage.define(swift))
const tomlSupport = new LanguageSupport(StreamLanguage.define(toml))
const dockerfileSupport = new LanguageSupport(StreamLanguage.define(dockerFile))

/**
 * Brand-aligned Stroll syntax highlight style using CSS custom properties
 * so both Warm Parchment Light and Deep Night Pine Dark update instantaneously.
 */
export const strollHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.definitionKeyword], color: 'var(--syn-keyword)' },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: 'var(--syn-variable)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syn-property)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], color: 'var(--syn-function)' },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: 'var(--syn-number)' },
  { tag: [tags.definition(tags.name), tags.separator], color: 'var(--syn-variable)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.changed, tags.annotation, tags.modifier, tags.self], color: 'var(--syn-type)' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--syn-number)' },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: 'var(--syn-operator)' },
  { tag: [tags.meta, tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--syn-function)', textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold', color: 'var(--syn-keyword)' },
  { tag: [tags.string, tags.inserted], color: 'var(--syn-string)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syn-tag)' },
  { tag: [tags.punctuation, tags.bracket, tags.paren, tags.squareBracket, tags.brace], color: 'var(--syn-punctuation)' },
  { tag: tags.invalid, color: 'var(--syn-invalid)' },
])

export const strollSyntaxExtension = syntaxHighlighting(strollHighlightStyle)

let syntaxStylesMounted = false

/**
 * Ensures the generated CSS rules for `strollHighlightStyle` are mounted in
 * `document.head` even when highlighting standalone lines outside an EditorView.
 */
function ensureSyntaxStylesMounted(): void {
  if (syntaxStylesMounted || typeof document === 'undefined') return
  const rules = strollHighlightStyle.module?.getRules()
  if (!rules) return
  if (!document.getElementById('stroll-syntax-styles')) {
    const style = document.createElement('style')
    style.id = 'stroll-syntax-styles'
    style.textContent = rules
    document.head.appendChild(style)
  }
  syntaxStylesMounted = true
}

export const strollEditorTheme = EditorView.theme({
  '&': {
    fontSize: '12px',
    backgroundColor: 'var(--stroll-code)',
    color: 'var(--stroll-ink)',
  },
  '.cm-scroller': {
    fontFamily: 'JetBrains Mono, Fira Code, SF Mono, Menlo, monospace',
    lineHeight: '1.55',
  },
  '.cm-content': {
    padding: '8px 12px',
    caretColor: 'var(--stroll-terra)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--stroll-terra-soft)',
  },
})

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
    case 'scss':
      return sass({ indented: false })
    case 'sass':
      return sass({ indented: true })
    case 'markdown':
      return markdown()
    case 'yaml':
      return yaml()
    case 'go':
      return go()
    case 'java':
      return java()
    case 'cpp':
      return cpp()
    case 'php':
      return php()
    case 'xml':
      return xml()
    case 'csharp':
      return csharpSupport
    case 'kotlin':
      return kotlinSupport
    case 'shell':
      return shellSupport
    case 'ruby':
      return rubySupport
    case 'swift':
      return swiftSupport
    case 'toml':
      return tomlSupport
    case 'dockerfile':
      return dockerfileSupport
    default:
      return null
  }
}

export interface HighlightSpan {
  text: string
  className: string
}

/**
 * Tokenizes lines with CodeMirror 6's Lezer parser and `strollHighlightStyle`
 * into theme-reactive styled spans.
 */
export function highlightLinesWithCodeMirror(
  lines: string[],
  language: string,
): HighlightSpan[][] {
  ensureSyntaxStylesMounted()
  const support = getLanguageSupport(language)
  if (!support || lines.length === 0) {
    return lines.map((line) => [{ text: line || ' ', className: '' }])
  }

  const fullText = lines.join('\n')
  const tree = support.language.parser.parse(fullText)

  const ranges: Array<{ from: number; to: number; cls: string }> = []
  highlightTree(tree, strollHighlightStyle, (from, to, classes) => {
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
