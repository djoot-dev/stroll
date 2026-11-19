import type { PRFile } from '@/types/pr'
import type { DiffLine } from './diffParser'
import { isTauriRuntime, resolveRepoSymbol } from './native'

export type SymbolKind =
  | 'interface'
  | 'type'
  | 'class'
  | 'enum'
  | 'function'
  | 'const'
  | 'component'
  | 'other'

export interface SymbolDeclaration {
  name: string
  kind: SymbolKind
  path: string
  line: number
  language: string
  docComment: string | null
  headSnippet: string
  baseSnippet: string | null
  isModifiedInPR: boolean
  source?: 'pr' | 'repo'
}

export interface SymbolUsage {
  path: string
  line: number
  preview: string
}

export interface HoverSymbolInfo {
  declaration: SymbolDeclaration
  usages: SymbolUsage[]
  isSameFile: boolean
}

const DECL_REGEX =
  /^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:(?:public|internal|private|protected|static|sealed|partial|abstract|readonly|ref|new|async)\s+)*(record\s+(?:struct|class)|record|interface|type|class|enum|function|const|def|fn|struct)\s+([A-Za-z_$][\w$]*)/

function normalizeKind(raw: string): SymbolKind {
  switch (raw) {
    case 'interface':
      return 'interface'
    case 'type':
      return 'type'
    case 'class':
    case 'struct':
    case 'record':
    case 'record class':
    case 'record struct':
      return 'class'
    case 'enum':
      return 'enum'
    case 'function':
    case 'def':
    case 'fn':
    case 'method':
      return 'function'
    case 'const':
      return 'const'
    case 'component':
      return 'component'
    default:
      return 'other'
  }
}

function extractLeadingDocComment(lines: string[], declLineIdx: number): string | null {
  const collected: string[] = []
  let i = declLineIdx - 1
  // Skip C# / Rust attributes (e.g. [ApiController], [Serializable], #[derive(...)]) right above the declaration
  while (i >= 0 && /^\s*#?\[.*\]\s*$/.test(lines[i])) {
    i -= 1
  }
  while (i >= 0 && lines[i].trim() === '') {
    // Allow at most 0 blank lines between doc comment and declaration
    break
  }

  // Block comment ending at i: */
  if (i >= 0 && lines[i].trim().endsWith('*/')) {
    while (i >= 0) {
      collected.unshift(lines[i])
      if (lines[i].trim().startsWith('/*')) break
      i -= 1
    }
    return collected.join('\n').trim()
  }

  // Line comments: /// or // or # or --
  while (i >= 0 && /^\s*(\/\/\/?|#|--)/.test(lines[i])) {
    collected.unshift(lines[i])
    i -= 1
  }
  return collected.length > 0 ? collected.join('\n').trim() : null
}

function extractDeclarationSnippet(lines: string[], startIdx: number, maxLines = 12): string {
  const slice: string[] = []
  let braceDepth = 0
  let sawOpenBrace = false

  for (let i = startIdx; i < Math.min(lines.length, startIdx + maxLines); i++) {
    const line = lines[i]
    slice.push(line)

    for (const ch of line) {
      if (ch === '{') {
        braceDepth += 1
        sawOpenBrace = true
      } else if (ch === '}') {
        braceDepth -= 1
      }
    }

    if (sawOpenBrace && braceDepth <= 0) {
      break
    }
    if (!sawOpenBrace && i > startIdx && line.trim() === '') {
      slice.pop()
      break
    }
  }

  return slice.join('\n').trimEnd()
}

function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function extractDeclarationsFromContent(
  content: string,
  path: string,
  language: string,
): Map<string, { line: number; kind: SymbolKind; docComment: string | null; snippet: string }> {
  const map = new Map<
    string,
    { line: number; kind: SymbolKind; docComment: string | null; snippet: string }
  >()
  const lines = content.split('\n')

  lines.forEach((line, idx) => {
    const match = line.match(DECL_REGEX)
    if (!match) return
    const rawKind = match[1]
    const name = match[2]
    // Skip very short or local-looking lowercase consts unless exported
    if (rawKind === 'const' && !/^\s*export\b/.test(line)) return
    if (map.has(name)) return

    map.set(name, {
      line: idx + 1,
      kind: normalizeKind(rawKind),
      docComment: extractLeadingDocComment(lines, idx),
      snippet: extractDeclarationSnippet(lines, idx),
    })
  })

  if (path.toLowerCase().endsWith('.vue')) {
    const baseName = path.split('/').pop() ?? ''
    const stem = baseName.replace(/\.vue$/i, '')
    const componentName =
      stem.toLowerCase() === 'index'
        ? toPascalCase(path.split('/').slice(-2, -1)[0] ?? '')
        : toPascalCase(stem)
    if (componentName && !map.has(componentName)) {
      const scriptIdx = lines.findIndex((l) => /^\s*<script\b/i.test(l))
      const startIdx = scriptIdx >= 0 ? scriptIdx : 0
      map.set(componentName, {
        line: startIdx + 1,
        kind: 'component',
        docComment: extractLeadingDocComment(lines, startIdx),
        snippet: lines.slice(startIdx, startIdx + 14).join('\n').trimEnd(),
      })
    }
  }

  return map
}

export type PRSymbolIndex = Map<string, SymbolDeclaration[]>

/**
 * Builds an index of symbol declarations across all changed files in the PR,
 * comparing `headContent` against `baseContent` to detect modified signatures/definitions.
 */
export function buildPRSymbolIndex(files: PRFile[]): PRSymbolIndex {
  const index: PRSymbolIndex = new Map()

  for (const file of files) {
    const headText = file.headContent ?? ''
    const baseText = file.baseContent ?? ''
    const headDecls = headText
      ? extractDeclarationsFromContent(headText, file.path, file.language)
      : new Map()
    const baseDecls = baseText
      ? extractDeclarationsFromContent(baseText, file.path, file.language)
      : new Map()

    for (const [name, headInfo] of headDecls.entries()) {
      const baseInfo = baseDecls.get(name) ?? null
      const isModifiedInPR =
        file.status === 'added' ||
        baseInfo === null ||
        baseInfo.snippet.trim() !== headInfo.snippet.trim()

      const decl: SymbolDeclaration = {
        name,
        kind: headInfo.kind,
        path: file.path,
        line: headInfo.line,
        language: file.language,
        docComment: headInfo.docComment,
        headSnippet: headInfo.snippet,
        baseSnippet: baseInfo?.snippet ?? null,
        isModifiedInPR,
      }

      if (!index.has(name)) index.set(name, [])
      index.get(name)!.push(decl)
    }
  }

  return index
}

/**
 * Finds call sites / references to `symbolName` across all PR files (excluding the declaration line itself).
 */
export function findUsagesInPR(
  symbolName: string,
  declPath: string,
  declLine: number,
  files: PRFile[],
  limit = 8,
): SymbolUsage[] {
  const usages: SymbolUsage[] = []
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordRegex = new RegExp(`\\b${escaped}\\b`)

  for (const file of files) {
    const content = file.headContent ?? file.baseContent
    if (!content) continue
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      if (file.path === declPath && lineNum === declLine) continue
      const line = lines[i]
      if (wordRegex.test(line)) {
        usages.push({
          path: file.path,
          line: lineNum,
          preview: line.trim(),
        })
        if (usages.length >= limit) return usages
      }
    }
  }

  return usages
}

/**
 * Resolves hover context for an identifier in `currentFile`.
 * Prefers declarations in `currentFile`, otherwise resolves to other PR files.
 */
export function resolveHoverSymbol(
  identifier: string,
  currentFile: PRFile,
  allFiles: PRFile[],
  index: PRSymbolIndex,
): HoverSymbolInfo | null {
  const candidates = index.get(identifier)
  if (!candidates || candidates.length === 0) return null

  const sameFile = candidates.find((c) => c.path === currentFile.path)
  const declaration = sameFile ?? candidates[0]
  const usages = findUsagesInPR(
    declaration.name,
    declaration.path,
    declaration.line,
    allFiles,
  )

  return {
    declaration,
    usages,
    isSameFile: declaration.path === currentFile.path,
  }
}

export interface ImportBinding {
  specifier: string
  importedName: string
}

function parseEsImportClause(
  clause: string,
): Array<{ local: string; imported: string }> {
  const bindings: Array<{ local: string; imported: string }> = []
  const cleaned = clause.replace(/\btype\s+/g, '').trim()
  if (!cleaned) return bindings

  const braceStart = cleaned.indexOf('{')
  const braceEnd = cleaned.lastIndexOf('}')

  const beforeBrace = (braceStart >= 0 ? cleaned.slice(0, braceStart) : cleaned)
    .replace(/,\s*$/, '')
    .trim()
  if (beforeBrace) {
    const nsMatch = beforeBrace.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/)
    if (nsMatch) {
      bindings.push({ local: nsMatch[1], imported: nsMatch[1] })
    } else if (/^[A-Za-z_$][\w$]*$/.test(beforeBrace)) {
      bindings.push({ local: beforeBrace, imported: beforeBrace })
    }
  }

  if (braceStart >= 0 && braceEnd > braceStart) {
    const inside = cleaned.slice(braceStart + 1, braceEnd)
    for (const rawItem of inside.split(',')) {
      const item = rawItem.trim()
      if (!item) continue
      const aliasMatch = item.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (aliasMatch) {
        bindings.push({
          local: aliasMatch[2],
          imported: aliasMatch[1] === 'default' ? aliasMatch[2] : aliasMatch[1],
        })
      } else if (/^[A-Za-z_$][\w$]*$/.test(item)) {
        bindings.push({ local: item, imported: item })
      }
    }
  }

  return bindings
}

/**
 * Extracts all local symbol names brought into scope by import statements in `content`.
 */
export function extractImportedSymbolNames(content: string | null | undefined): Set<string> {
  const names = new Set<string>()
  if (!content) return names

  const joined = content.replace(/\r\n/g, '\n')
  const esImportRegex =
    /^[ \t]*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm
  let match: RegExpExecArray | null
  while ((match = esImportRegex.exec(joined)) !== null) {
    for (const b of parseEsImportClause(match[1])) {
      names.add(b.local)
    }
  }

  for (const line of joined.split('\n')) {
    const pyMatch = line.match(/^\s*from\s+[A-Za-z0-9_.]+\s+import\s+(.+)$/)
    if (pyMatch) {
      for (const part of pyMatch[1].split(',')) {
        const cleaned = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (cleaned && /^[A-Za-z_]\w*$/.test(cleaned)) names.add(cleaned)
      }
    }

    const rustMatch = line.match(/^\s*(?:pub\s+)?use\s+([A-Za-z0-9_:{}*,\s]+)\s*;/)
    if (rustMatch) {
      const segs = rustMatch[1].match(/[A-Za-z_]\w*/g)
      if (segs && segs.length > 0) {
        names.add(segs[segs.length - 1])
      }
    }
  }

  return names
}

/**
 * Finds both the import specifier and the original exported symbol name for `symbolName`.
 */
export function findImportBindingForSymbol(
  content: string | null | undefined,
  symbolName: string,
): ImportBinding | null {
  if (!content || !symbolName) return null
  const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const wordRegex = new RegExp(`\\b${escaped}\\b`)

  const joined = content.replace(/\r\n/g, '\n')
  const esImportRegex =
    /^[ \t]*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm
  let match: RegExpExecArray | null
  while ((match = esImportRegex.exec(joined)) !== null) {
    const bindings = parseEsImportClause(match[1])
    const hit = bindings.find((b) => b.local === symbolName)
    if (hit) {
      return { specifier: match[2], importedName: hit.imported }
    }
    if (wordRegex.test(match[1])) {
      return { specifier: match[2], importedName: symbolName }
    }
  }

  const lines = joined.split('\n')
  const csharpUsings: string[] = []
  for (const line of lines) {
    const pyMatch = line.match(/^\s*from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/)
    if (pyMatch && wordRegex.test(pyMatch[2])) {
      return { specifier: pyMatch[1], importedName: symbolName }
    }

    const rustMatch = line.match(/^\s*(?:pub\s+)?use\s+([A-Za-z0-9_:]+)\s*;/)
    if (rustMatch && wordRegex.test(rustMatch[1])) {
      // Strip trailing `::Symbol` to get module path
      return {
        specifier: rustMatch[1].replace(new RegExp(`::${escaped}$`), ''),
        importedName: symbolName,
      }
    }

    // C# `using Alias = Ns.Type;` or `using static Ns.Type;` or `using Ns.SubNs;`
    const csAliasMatch = line.match(
      /^\s*(?:global\s+)?using\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)\s*;/,
    )
    if (csAliasMatch && (csAliasMatch[1] === symbolName || wordRegex.test(csAliasMatch[2]))) {
      return { specifier: csAliasMatch[2], importedName: symbolName }
    }

    const csStaticMatch = line.match(/^\s*(?:global\s+)?using\s+static\s+([A-Za-z_][\w.]*)\s*;/)
    if (csStaticMatch && wordRegex.test(csStaticMatch[1])) {
      return { specifier: csStaticMatch[1], importedName: symbolName }
    }

    const csUsingMatch = line.match(/^\s*(?:global\s+)?using\s+([A-Za-z_][\w.]*)\s*;/)
    if (csUsingMatch) {
      csharpUsings.push(csUsingMatch[1])
    }
  }

  if (csharpUsings.length > 0) {
    const nonSystem = csharpUsings.filter((ns) => ns !== 'System' && !ns.startsWith('System.'))
    const pool = nonSystem.length > 0 ? nonSystem : csharpUsings
    return { specifier: pool[0], importedName: symbolName }
  }

  return null
}

/**
 * Finds the import specifier (e.g. `'../types/webhook'`, `'@/services/storage'`, `'crate::commands::git'`)
 * that brings `symbolName` into scope in `content`.
 */
export function findImportSpecifierForSymbol(
  content: string | null | undefined,
  symbolName: string,
): string | null {
  return findImportBindingForSymbol(content, symbolName)?.specifier ?? null
}

/**
 * Resolves hover context: first checks the in-memory `PRSymbolIndex`, and if not found
 * and a local `repoPath` is configured in Tauri, falls back to native `tree-sitter` resolution.
 */
export async function resolveHoverSymbolWithRepoFallback(
  identifier: string,
  currentFile: PRFile,
  allFiles: PRFile[],
  index: PRSymbolIndex,
  repoPath: string | null,
): Promise<HoverSymbolInfo | null> {
  const fastResult = resolveHoverSymbol(identifier, currentFile, allFiles, index)
  if (fastResult) return fastResult

  if (!repoPath || !isTauriRuntime()) return null

  const sourceContent = currentFile.headContent ?? currentFile.baseContent
  const binding = findImportBindingForSymbol(sourceContent, identifier)

  const resolved = await resolveRepoSymbol({
    repoPath,
    importerPath: currentFile.path,
    symbolName: binding?.importedName ?? identifier,
    importSpecifier: binding?.specifier ?? null,
  })

  if (!resolved) return null

  const declaration: SymbolDeclaration = {
    name: resolved.name,
    kind: normalizeKind(resolved.kind),
    path: resolved.path,
    line: resolved.line,
    language: resolved.language,
    docComment: resolved.docComment,
    headSnippet: resolved.snippet,
    baseSnippet: null,
    isModifiedInPR: false,
    source: 'repo',
  }

  const usages = findUsagesInPR(
    declaration.name,
    declaration.path,
    declaration.line,
    allFiles,
  )

  return {
    declaration,
    usages,
    isSameFile: declaration.path === currentFile.path,
  }
}

const SCOPE_PATTERNS: Array<{ regex: RegExp; format: (m: RegExpMatchArray) => string }> = [
  {
    regex: /^\s*namespace\s+([A-Za-z_][\w.]*)/,
    format: (m) => `namespace ${m[1]}`,
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:(?:public|internal|private|protected|static|sealed|partial|abstract|readonly|ref|new)\s+)*(?:record\s+(?:struct|class)|record)\s+([A-Za-z_$][\w$]*)/,
    format: (m) => `record ${m[1]}`,
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:(?:public|internal|private|protected|static|sealed|partial|abstract|readonly|ref|new)\s+)*class\s+([A-Za-z_$][\w$]*)/,
    format: (m) => `class ${m[1]}`,
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:(?:public|internal|private|protected|static|sealed|partial|abstract|readonly|ref|new)\s+)*struct\s+([A-Za-z_$][\w$]*)/,
    format: (m) => `struct ${m[1]}`,
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:(?:public|internal|private|protected|static|sealed|partial|abstract|new)\s+)*interface\s+([A-Za-z_$][\w$]*)/,
    format: (m) => `interface ${m[1]}`,
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:(?:public|internal|private|protected|new)\s+)*enum\s+([A-Za-z_$][\w$]*)/,
    format: (m) => `enum ${m[1]}`,
  },
  {
    regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    format: (m) => `fn ${m[1]}()`,
  },
  {
    // C# / Java typed method: `public async Task<Order> CreateOrderAsync(...)`
    regex:
      /^\s*(?:(?:public|internal|private|protected|static|async|virtual|override|sealed|abstract|new|partial)\s+)+(?:[\w<>?[\],.]+(?:\s+[\w<>?[\],.]+)?)\s+([A-Za-z_]\w*)(?:<[^>]+>)?\s*\(/,
    format: (m) => `${m[1]}()`,
  },
  {
    regex: /^\s*(?:(?:public|private|protected|static|async)\s+)+([A-Za-z_$][\w$]*)\s*\(/,
    format: (m) => `${m[1]}()`,
  },
  {
    regex: /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\s*\{/,
    format: (m) => `${m[1]}()`,
  },
  {
    regex: /^\s*(?:describe|it|test)\s*\(\s*['"`]([^'"`]+)['"`]/,
    format: (m) => `${m[1]}`,
  },
  {
    regex: /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)/i,
    format: (m) => `table ${m[1]}`,
  },
]

const SCOPE_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'constructor'])

/**
 * Computes the enclosing scope breadcrumb (e.g. `['class WebhookDispatcher', 'dispatch()']`)
 * for a given 1-based line number in `file`.
 */
export function getEnclosingScope(file: PRFile, lineNumber: number): string[] {
  const content = file.status === 'deleted' ? file.baseContent : file.headContent
  if (!content || lineNumber < 1) return []

  const lines = content.split('\n')
  const targetIdx = Math.min(lines.length - 1, lineNumber - 1)
  const targetIndent = lines[targetIdx].search(/\S/)
  const effectiveIndent = targetIndent === -1 ? 999 : targetIndent

  const scopes: string[] = []
  let minIndentSeen = effectiveIndent

  for (let i = targetIdx; i >= 0; i--) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed === '{' || trimmed === '}') continue

    const indent = line.search(/\S/)
    if (indent > minIndentSeen && i !== targetIdx) continue

    for (const pat of SCOPE_PATTERNS) {
      const m = line.match(pat.regex)
      if (!m) continue
      const name = m[1]
      if (SCOPE_KEYWORDS.has(name)) continue
      scopes.unshift(pat.format(m))
      minIndentSeen = indent - 1
      break
    }

    if (indent === 0 && scopes.length > 0) break
  }

  return scopes
}

/**
 * Given a `+` line inside a hunk, finds the contiguous `-` lines immediately
 * preceding its `+` block (if any) so the reviewer can peek what was replaced.
 */
export function getReplacedLinesForAddedLine(
  hunkLines: DiffLine[],
  lineIndex: number,
): string[] {
  const target = hunkLines[lineIndex]
  if (!target || target.type !== 'add') return []

  // Walk backwards past contiguous '+' lines
  let i = lineIndex
  while (i >= 0 && hunkLines[i].type === 'add') {
    i -= 1
  }

  // Collect contiguous '-' lines right before the '+' block
  const deleted: string[] = []
  while (i >= 0 && hunkLines[i].type === 'del') {
    deleted.unshift(hunkLines[i].content)
    i -= 1
  }

  return deleted
}
