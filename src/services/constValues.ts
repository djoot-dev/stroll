/**
 * Detects constant declarations (and enum members) in source text and extracts the
 * value expression *as written*, so hover can show `MAX_RETRIES = 5` without the
 * reader having to scan the declaration snippet.
 *
 * This is deliberately lexical (no full parser): it understands strings, comments
 * and bracket nesting well enough to find where a value expression ends.
 */

export type ConstValueNote =
  /** Enum member without an explicit initializer; the value was inferred. */
  | 'implicit'
  /** Python `UPPER_CASE = …`: constant by naming convention only. */
  | 'convention'
  /** C# `static readonly`: fixed after initialization, but evaluated at runtime. */
  | 'readonly'

export interface ConstDeclaration {
  /** Index key / display name: `MAX`, `Status.Active`, or `Status::Active` (Rust). */
  name: string
  kind: 'const' | 'enumMember'
  /** 0-based first line of the declaration. */
  startIdx: number
  /** 0-based last line of the declaration statement. */
  endIdx: number
  /** 0-based line of the enclosing enum header (enum members only). */
  containerIdx: number | null
  value: string | null
  valueNote: ConstValueNote | null
  /** Only visible from its own file (non-exported / private). */
  fileLocal: boolean
}

export const MAX_CONST_VALUE_CHARS = 80
const MAX_SCAN_CHARS = 4000

type Lang = 'ts' | 'csharp' | 'rust' | 'python' | null

export function constLanguageFamily(language: string, path = ''): Lang {
  const lower = path.toLowerCase()
  if (language === 'typescript' || language === 'javascript' || language === 'vue') return 'ts'
  if (language === 'csharp' || lower.endsWith('.cs')) return 'csharp'
  if (language === 'rust' || lower.endsWith('.rs')) return 'rust'
  if (language === 'python' || lower.endsWith('.py')) return 'python'
  if (/\.(?:[cm]?[jt]sx?|vue)$/.test(lower)) return 'ts'
  return null
}

/** Separator used to qualify enum members / associated constants in `lang`. */
export function memberSeparator(lang: Lang): string {
  return lang === 'rust' ? '::' : '.'
}

// ---------------------------------------------------------------------------
// Lexical value scanner
// ---------------------------------------------------------------------------

interface ScanOptions {
  lang: Lang
  /** Statement may end at a newline (TS/JS without semicolons, Python). */
  stopAtNewline: boolean
  /** Characters that end the expression at nesting depth 0. */
  stopChars: string
}

interface ScanResult {
  /** Expression text with comments stripped (untrimmed). */
  raw: string
  /** Offset of the terminator (not consumed), or text length. */
  end: number
  /** True when the scan hit MAX_SCAN_CHARS before the expression ended. */
  overflow: boolean
}

const TS_CONTINUATION_END = '+-*/%|&?:,=.!~^([{'
const TS_CONTINUATION_START = '.?:+*%|&^='

function lastNonSpace(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    if (!/\s/.test(s[i])) return s[i]
  }
  return ''
}

/** Next significant character after `from`, skipping whitespace and `//` / block comments. */
function nextSignificant(text: string, from: number): string {
  let i = from
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      i++
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? text.length : close + 2
    } else {
      return ch
    }
  }
  return ''
}

function scanExpression(text: string, start: number, opts: ScanOptions): ScanResult {
  const python = opts.lang === 'python'
  let out = ''
  let depth = 0
  let i = start

  while (i < text.length) {
    if (i - start > MAX_SCAN_CHARS) return { raw: out, end: i, overflow: true }
    const ch = text[i]
    const next = text[i + 1]

    // Comments
    if (!python && ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (!python && ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? text.length : close + 2
      out += ' '
      continue
    }
    if (python && ch === '#') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }

    // Strings
    if (ch === '"' || ch === "'" || ch === '`') {
      // Rust lifetimes / char literals are short; a lone `'` with no close on the line is a lifetime.
      if (ch === "'" && opts.lang === 'rust') {
        const close = text.indexOf("'", i + 1)
        if (close === -1 || close - i > 4 || text.slice(i + 1, close).includes('\n')) {
          out += ch
          i++
          continue
        }
      }
      const tripleQuote = python && (ch === '"' || ch === "'") && text.startsWith(ch.repeat(3), i)
      const quote = tripleQuote ? ch.repeat(3) : ch
      const verbatim = opts.lang === 'csharp' && ch === '"' && (text[i - 1] === '@' || text[i - 2] === '@')
      let j = i + quote.length
      let templateDepth = 0
      while (j < text.length) {
        const c = text[j]
        if (!verbatim && c === '\\') {
          j += 2
          continue
        }
        if (ch === '`' && c === '$' && text[j + 1] === '{') {
          templateDepth++
          j += 2
          continue
        }
        if (ch === '`' && templateDepth > 0 && c === '}') {
          templateDepth--
          j++
          continue
        }
        if (templateDepth === 0 && text.startsWith(quote, j)) {
          if (verbatim && text[j + 1] === '"') {
            j += 2
            continue
          }
          j += quote.length
          break
        }
        if (!tripleQuote && ch !== '`' && !verbatim && c === '\n') break
        j++
      }
      out += text.slice(i, j)
      i = j
      continue
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      out += ch
      i++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return { raw: out, end: i, overflow: false }
      depth--
      out += ch
      i++
      continue
    }

    if (depth === 0 && opts.stopChars.includes(ch)) {
      return { raw: out, end: i, overflow: false }
    }

    if (depth === 0 && ch === '\n' && opts.stopAtNewline) {
      if (out.trim() === '') {
        out += ch
        i++
        continue
      }
      const prev = lastNonSpace(out)
      if (python) {
        if (prev !== '\\') return { raw: out, end: i, overflow: false }
      } else {
        // `=>` / `>=` etc. end with `>`; a trailing operator means the expression continues.
        const upcoming = nextSignificant(text, i + 1)
        if (!TS_CONTINUATION_END.includes(prev) && !TS_CONTINUATION_START.includes(upcoming)) {
          return { raw: out, end: i, overflow: false }
        }
      }
    }

    out += ch
    i++
  }

  return { raw: out, end: i, overflow: false }
}

/** Collapses whitespace and truncates a raw value expression for display. */
export function formatConstValue(raw: string, max = MAX_CONST_VALUE_CHARS): string | null {
  const collapsed = raw
    .replace(/\\\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    // Trailing commas from multi-line literals read as noise once collapsed.
    .replace(/, ?([)\]}])/g, (_m, close: string) => (close === '}' ? ' }' : close))
    // Tighten `( x` / `[ x` (keep `{ x }` spacing, the usual object-literal style).
    .replace(/([([]) /g, '$1')
    .replace(/ ([)\]])/g, '$1')
    .trim()
    .replace(/[;,]$/, '')
    .trim()
  if (!collapsed) return null
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

const FUNCTION_VALUE_RE =
  /^(?:async\s+)?(?:function\b|class\b|lambda\b|\([^()]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|(?:<[^>]*>\s*)?\([^()]*\)\s*=>)/

/** True when `value` is a function / lambda / class expression rather than a value. */
export function isFunctionLikeValue(value: string): boolean {
  return FUNCTION_VALUE_RE.test(value.trim())
}

const PRIMITIVE_LITERAL_RE =
  /^(?:-?(?:0[xob][\da-f_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)n?|true|false|null|undefined|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`$]*`)(?:\s+as\s+const)?$/i

export function isPrimitiveLiteral(value: string): boolean {
  return PRIMITIVE_LITERAL_RE.test(value.trim())
}

function parseIntegerLiteral(value: string): number | null {
  const v = value.trim().replace(/_/g, '').replace(/[uUlL]+$/, '')
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10)
  if (/^-?0x[\da-f]+$/i.test(v)) return v.startsWith('-') ? -Number.parseInt(v.slice(3), 16) : Number.parseInt(v.slice(2), 16)
  if (/^-?0b[01]+$/i.test(v)) return v.startsWith('-') ? -Number.parseInt(v.slice(3), 2) : Number.parseInt(v.slice(2), 2)
  return null
}

// ---------------------------------------------------------------------------
// Declaration matchers
// ---------------------------------------------------------------------------

const TS_CONST_RE =
  /^(\s*)(export\s+(?:default\s+)?)?(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?\s*=(?![=>])/
const CS_CONST_RE =
  /^\s*(?:\[[^\]]*\]\s*)*((?:(?:public|internal|private|protected|new|static|readonly|const|volatile|unsafe|file)\s+)+)([\w.]+(?:\s*<[^=;]*?>)?(?:\[[,\s]*\])*\??)\s+([A-Za-z_]\w*)\s*=(?![=>])/
const RUST_CONST_RE =
  /^\s*(pub(?:\s*\([^)]*\))?\s+)?(const|static)\s+(?!mut\b)([A-Za-z_]\w*)\s*:[^=;]+=(?!=)/
const PY_CONST_RE = /^([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+?))?\s*=(?!=)/

const TS_ENUM_RE = /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/
const CS_ENUM_RE =
  /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|internal|private|protected|new|file)\s+)*enum\s+([A-Za-z_]\w*)/
const RUST_ENUM_RE = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/
const PY_ENUM_RE = /^(\s*)class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/
const PY_ENUM_BASES_RE = /\b(?:Enum|IntEnum|StrEnum|Flag|IntFlag|ReprEnum)\b/

function isScreamingCase(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name) && /[A-Z]/.test(name)
}

class LineMap {
  readonly text: string
  private readonly starts: number[]

  constructor(lines: string[]) {
    this.text = lines.join('\n')
    this.starts = []
    let offset = 0
    for (const line of lines) {
      this.starts.push(offset)
      offset += line.length + 1
    }
  }

  offsetOf(lineIdx: number, col = 0): number {
    return (this.starts[lineIdx] ?? this.text.length) + col
  }

  lineOf(offset: number): number {
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }
}

function scanValueAfter(
  map: LineMap,
  offset: number,
  lang: Lang,
): { value: string | null; endIdx: number } {
  const res = scanExpression(map.text, offset, {
    lang,
    stopAtNewline: lang === 'ts' || lang === 'python',
    stopChars: ';',
  })
  const endOffset = Math.max(offset, res.end - 1)
  const endIdx = map.lineOf(Math.min(endOffset, map.text.length - 1))
  if (res.overflow) return { value: null, endIdx }
  return { value: formatConstValue(res.raw), endIdx }
}

/** Index of the `=` that ends `match` (match[0] always ends with `=`). */
function equalsOffset(map: LineMap, lineIdx: number, match: RegExpMatchArray): number {
  return map.offsetOf(lineIdx, (match.index ?? 0) + match[0].length)
}

function parseBraceEnumMembers(
  map: LineMap,
  lines: string[],
  headerIdx: number,
  enumName: string,
  lang: Lang,
  fileLocal: boolean,
): ConstDeclaration[] {
  const text = map.text
  const open = text.indexOf('{', map.offsetOf(headerIdx))
  if (open === -1) return []
  // The `{` must belong to this header (within a few lines, no `;` in between).
  const between = text.slice(map.offsetOf(headerIdx), open)
  if (between.includes(';') || map.lineOf(open) - headerIdx > 3) return []

  const members: Array<{ name: string; line: number; value: string | null; hasData: boolean; endIdx: number }> = []
  let i = open + 1
  while (i < text.length) {
    // Skip whitespace, comments, attributes
    const ch = text[i]
    if (/\s|,/.test(ch)) {
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? text.length : close + 2
      continue
    }
    if (ch === '[' || (ch === '#' && text[i + 1] === '[')) {
      const res = scanExpression(text, ch === '#' ? i + 2 : i + 1, { lang, stopAtNewline: false, stopChars: '' })
      i = res.end + 1
      continue
    }
    if (ch === '}') break

    const ident = /^[A-Za-z_$][\w$]*/.exec(text.slice(i, i + 256))
    if (!ident) {
      // Unexpected token (e.g. C# preprocessor) – skip the line.
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    const name = ident[0]
    const line = map.lineOf(i)
    i += name.length
    while (i < text.length && /[ \t]/.test(text[i])) i++

    let value: string | null = null
    let hasData = false
    if (text[i] === '(' || text[i] === '{') {
      hasData = true
      const res = scanExpression(text, i + 1, { lang, stopAtNewline: false, stopChars: '' })
      i = res.end + 1
      while (i < text.length && /[ \t]/.test(text[i])) i++
    }
    if (text[i] === '=' && text[i + 1] !== '>') {
      const res = scanExpression(text, i + 1, { lang, stopAtNewline: false, stopChars: ',' })
      value = res.overflow ? null : formatConstValue(res.raw)
      i = res.end
    }
    members.push({ name, line, value, hasData, endIdx: map.lineOf(Math.max(0, i - 1)) })
    // Advance to the next separator / end
    const res = scanExpression(text, i, { lang, stopAtNewline: false, stopChars: ',' })
    i = res.end
    if (text[i] === ',') i++
  }

  const sep = memberSeparator(lang)
  const anyData = members.some((m) => m.hasData)
  let counter: number | null = lang === 'rust' && anyData ? null : 0
  const result: ConstDeclaration[] = []
  for (const m of members) {
    let value = m.value
    let note: ConstValueNote | null = null
    if (value !== null) {
      const n = parseIntegerLiteral(value)
      counter = n === null ? null : n + 1
    } else if (!m.hasData && counter !== null) {
      value = String(counter)
      note = 'implicit'
      counter += 1
    } else {
      counter = null
    }
    result.push({
      name: `${enumName}${sep}${m.name}`,
      kind: 'enumMember',
      startIdx: m.line,
      endIdx: Math.max(m.line, Math.min(m.endIdx, lines.length - 1)),
      containerIdx: headerIdx,
      value,
      valueNote: note,
      fileLocal,
    })
  }
  return result
}

function parsePythonEnumMembers(
  map: LineMap,
  lines: string[],
  headerIdx: number,
  enumName: string,
  headerIndent: number,
): ConstDeclaration[] {
  const result: ConstDeclaration[] = []
  let bodyIndent: number | null = null
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const indent = line.search(/\S/)
    if (indent <= headerIndent) break
    if (bodyIndent === null) bodyIndent = indent
    if (indent !== bodyIndent) continue
    const m = line.match(/^\s+([A-Za-z]\w*)\s*(?::[^=]+?)?\s*=(?!=)/)
    if (!m) continue
    const { value, endIdx } = scanValueAfter(map, equalsOffset(map, i, m), 'python')
    result.push({
      name: `${enumName}.${m[1]}`,
      kind: 'enumMember',
      startIdx: i,
      endIdx,
      containerIdx: headerIdx,
      value,
      valueNote: null,
      fileLocal: false,
    })
  }
  return result
}

/**
 * Extracts constant declarations and enum members from `content`.
 *
 * - TS/JS/Vue: `const NAME = …` (exported → global; top-level non-exported → file-local,
 *   only when SCREAMING_CASE or a primitive literal so ordinary locals stay quiet)
 * - C#: `const` and `static readonly` fields (public/internal/protected → global)
 * - Rust: `const` / `static` (not `static mut`); `pub` → global
 * - Python: module-level `UPPER_CASE = …` (constant by convention unless `Final`)
 * - Enum members for all of the above, keyed `Enum.Member` (`Enum::Member` in Rust)
 */
export function extractConstDeclarations(
  content: string,
  language: string,
  path = '',
): ConstDeclaration[] {
  const lang = constLanguageFamily(language, path)
  if (!lang || !content) return []

  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const map = new LineMap(lines)
  const out: ConstDeclaration[] = []
  const isVue = language === 'vue' || path.toLowerCase().endsWith('.vue')
  let inVueScript = !isVue

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]

    if (isVue) {
      if (/^\s*<script\b/i.test(line)) inVueScript = true
      else if (/^\s*<\/script>/i.test(line)) inVueScript = false
      if (!inVueScript) continue
    }

    if (lang === 'ts') {
      const enumMatch = line.match(TS_ENUM_RE)
      if (enumMatch) {
        const exported = /^\s*export\b/.test(line)
        out.push(...parseBraceEnumMembers(map, lines, idx, enumMatch[1], lang, !exported))
        continue
      }
      const m = line.match(TS_CONST_RE)
      if (!m) continue
      const indent = m[1].length
      const exported = Boolean(m[2])
      if (!exported && indent > 0) continue
      const { value, endIdx } = scanValueAfter(map, equalsOffset(map, idx, m), lang)
      const shownValue = value && !isFunctionLikeValue(value) ? value : null
      if (!exported && !isScreamingCase(m[3]) && !(shownValue && isPrimitiveLiteral(shownValue))) {
        continue
      }
      out.push({
        name: m[3],
        kind: 'const',
        startIdx: idx,
        endIdx,
        containerIdx: null,
        value: shownValue,
        valueNote: null,
        fileLocal: !exported,
      })
      continue
    }

    if (lang === 'csharp') {
      const enumMatch = line.match(CS_ENUM_RE)
      if (enumMatch) {
        const isPrivate = /\bprivate\b/.test(line)
        out.push(...parseBraceEnumMembers(map, lines, idx, enumMatch[1], lang, isPrivate))
        continue
      }
      const m = line.match(CS_CONST_RE)
      if (!m) continue
      const modifiers = m[1].split(/\s+/).filter(Boolean)
      const isConst = modifiers.includes('const')
      const isStaticReadonly = modifiers.includes('static') && modifiers.includes('readonly')
      if (!isConst && !isStaticReadonly) continue
      const isVisible = modifiers.some((mod) => mod === 'public' || mod === 'internal' || mod === 'protected')
      const { value, endIdx } = scanValueAfter(map, equalsOffset(map, idx, m), lang)
      out.push({
        name: m[3],
        kind: 'const',
        startIdx: idx,
        endIdx,
        containerIdx: null,
        value: value && !isFunctionLikeValue(value) ? value : null,
        valueNote: isConst ? null : 'readonly',
        fileLocal: !isVisible,
      })
      continue
    }

    if (lang === 'rust') {
      const enumMatch = line.match(RUST_ENUM_RE)
      if (enumMatch) {
        out.push(...parseBraceEnumMembers(map, lines, idx, enumMatch[1], lang, !/^\s*pub\b/.test(line)))
        continue
      }
      const m = line.match(RUST_CONST_RE)
      if (!m) continue
      const { value, endIdx } = scanValueAfter(map, equalsOffset(map, idx, m), lang)
      out.push({
        name: m[3],
        kind: 'const',
        startIdx: idx,
        endIdx,
        containerIdx: null,
        value: value && !/^\|/.test(value) ? value : null,
        valueNote: null,
        fileLocal: !m[1],
      })
      continue
    }

    // python
    const enumMatch = line.match(PY_ENUM_RE)
    if (enumMatch && PY_ENUM_BASES_RE.test(enumMatch[3])) {
      out.push(...parsePythonEnumMembers(map, lines, idx, enumMatch[2], enumMatch[1].length))
      continue
    }
    const m = line.match(PY_CONST_RE)
    if (!m || m[1].length < 2) continue
    const { value, endIdx } = scanValueAfter(map, equalsOffset(map, idx, m), lang)
    const annotation = m[2] ?? ''
    out.push({
      name: m[1],
      kind: 'const',
      startIdx: idx,
      endIdx,
      containerIdx: null,
      value: value && !isFunctionLikeValue(value) ? value : null,
      valueNote: /\bFinal\b/.test(annotation) ? null : 'convention',
      fileLocal: false,
    })
  }

  return out
}

/**
 * Extracts the value of `name` from a standalone declaration snippet (e.g. one returned
 * by the native repo resolver). Handles `const X = …`, C# fields, Rust consts, Python
 * assignments and single enum-member lines (`Active = 2,`).
 */
export function extractConstValueFromSnippet(
  snippet: string,
  name: string,
  language: string,
): { value: string | null; valueNote: ConstValueNote | null } | null {
  const lang = constLanguageFamily(language)
  if (!lang || !snippet) return null
  const member = name.split(/\.|::/).pop() ?? name

  const decls = extractConstDeclarations(snippet, language)
  const hit = decls.find((d) => d.name === name || d.name === member)
  if (hit) return { value: hit.value, valueNote: hit.valueNote }

  // Enum member line on its own (`Active = 2,` / `ACTIVE = "a"`).
  const escaped = member.replace(/[$]/g, '\\$')
  const memberRe = new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*${escaped}\\s*=(?![=>])`)
  const lines = snippet.replace(/\r\n/g, '\n').split('\n')
  for (let idx = 0; idx < lines.length; idx++) {
    const m = lines[idx].match(memberRe)
    if (!m) continue
    const map = new LineMap(lines)
    const res = scanExpression(map.text, equalsOffset(map, idx, m), {
      lang,
      stopAtNewline: lang === 'python',
      stopChars: lang === 'python' ? '' : ',;',
    })
    if (res.overflow) return null
    return { value: formatConstValue(res.raw), valueNote: null }
  }
  return null
}
