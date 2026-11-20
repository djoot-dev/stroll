import type { PRFile } from '@/types/pr'
import {
  constLanguageFamily,
  extractConstDeclarations,
  extractConstValueFromSnippet,
  type ConstValueNote,
} from './constValues'
import type { DiffLine } from './diffParser'
import { isTauriRuntime, resolveRepoSymbol } from './native'
import {
  extractCSharpScopeContext,
  isCSharpPath,
  pickCSharpTypeEntry,
  type CSharpTypeIndex,
} from './csharpIndex'

export type SymbolKind =
  | 'interface'
  | 'type'
  | 'class'
  | 'enum'
  | 'function'
  | 'const'
  | 'enumMember'
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
  /** Line count of the whole head declaration; larger than `headSnippet` when it is truncated. */
  headTotalLines?: number
  /** Line count of the whole base declaration. */
  baseTotalLines?: number | null
  /** 1-based line of the declaration in the base file (used to expand `baseSnippet`). */
  baseLine?: number | null
  /** Full head declaration text when it is already in memory (repo fallback). */
  headFullSnippet?: string | null
  isModifiedInPR: boolean
  source?: 'pr' | 'repo'
  /** Value expression of a constant / enum member as written (collapsed, truncated). */
  value?: string | null
  /** Value before the PR, when it differs from `value`'s declaration in the base. */
  baseValue?: string | null
  valueNote?: ConstValueNote | null
  /** Only resolvable from its own file (non-exported / private declarations). */
  fileLocal?: boolean
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
  /^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:(?:public|internal|private|protected|static|sealed|partial|abstract|readonly|ref|new|async)\s+)*(?:const\s+(?=enum\b))?(record\s+(?:struct|class)|record|interface|type|class|enum|function|const|def|fn|struct)\s+([A-Za-z_$][\w$]*)/

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
    case 'static':
      return 'const'
    case 'enumMember':
    case 'enum_member':
      return 'enumMember'
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

/** Lines shown in the hover popover before the user asks for more. */
export const DEFAULT_SNIPPET_LINES = 12
const REPO_SNIPPET_LINES = 16
/** How far a brace-delimited declaration is followed when measuring its full length. */
const EXTENT_SCAN_LIMIT = 2000

interface SlicedDeclaration {
  snippet: string
  totalLines: number
}

/** First `maxLines` of `lines[startIdx..=endIdx]`, plus the extent's length minus trailing blanks. */
function sliceDeclaration(
  lines: string[],
  startIdx: number,
  endIdx: number,
  maxLines: number,
): SlicedDeclaration {
  let end = Math.min(endIdx, lines.length - 1)
  while (end > startIdx && lines[end].trim() === '') end--
  const snippet = lines
    .slice(startIdx, Math.min(end, startIdx + maxLines - 1) + 1)
    .join('\n')
    .trimEnd()
  return { snippet, totalLines: Math.max(1, end - startIdx + 1) }
}

/** Last line of a declaration: its matching closing brace, or the line before the first blank one. */
function declarationExtentEnd(lines: string[], startIdx: number): number {
  let braceDepth = 0
  let sawOpenBrace = false
  const last = Math.min(lines.length, startIdx + EXTENT_SCAN_LIMIT) - 1

  for (let i = startIdx; i <= last; i++) {
    const line = lines[i]
    if (!sawOpenBrace && i > startIdx && line.trim() === '') return i - 1

    for (const ch of line) {
      if (ch === '{') {
        braceDepth += 1
        sawOpenBrace = true
      } else if (ch === '}') {
        braceDepth -= 1
      }
    }

    if (sawOpenBrace && braceDepth <= 0) return i
  }

  return last
}

function extractDeclarationSnippet(
  lines: string[],
  startIdx: number,
  maxLines = DEFAULT_SNIPPET_LINES,
): SlicedDeclaration {
  return sliceDeclaration(lines, startIdx, declarationExtentEnd(lines, startIdx), maxLines)
}

function toPascalCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

interface ExtractedDeclaration {
  line: number
  kind: SymbolKind
  docComment: string | null
  snippet: string
  /** Line count of the whole declaration (`snippet` may be a prefix of it). */
  totalLines: number
  /** What `isModifiedInPR` compares between base and head. */
  signature: string
  value: string | null
  valueNote: ConstValueNote | null
  fileLocal: boolean
}

/** Enum header (+ opening brace), an ellipsis for skipped members, then the member itself. */
function buildEnumMemberSnippet(
  lines: string[],
  containerIdx: number,
  startIdx: number,
  endIdx: number,
): string {
  const out: string[] = []
  let i = containerIdx
  while (i < startIdx && i <= containerIdx + 3) {
    out.push(lines[i])
    if (lines[i].includes('{') || lines[i].trimEnd().endsWith(':')) break
    i++
  }
  const memberLines = lines.slice(startIdx, Math.min(endIdx, startIdx + 5) + 1)
  if (startIdx > i + 1) {
    const indent = memberLines[0]?.match(/^\s*/)?.[0] ?? '  '
    out.push(`${indent}…`)
  }
  out.push(...memberLines)
  return out.join('\n').trimEnd()
}

function extractDeclarationsFromContent(
  content: string,
  path: string,
  language: string,
): Map<string, ExtractedDeclaration> {
  const map = new Map<string, ExtractedDeclaration>()
  const lines = content.split('\n')
  const family = constLanguageFamily(language, path)
  const constStartLines = new Set<number>()

  for (const decl of extractConstDeclarations(content, language, path)) {
    if (decl.kind === 'const') constStartLines.add(decl.startIdx)
    if (map.has(decl.name)) continue
    let snippet: string
    let totalLines: number
    if (decl.containerIdx !== null) {
      // Enum header + member excerpt: not a contiguous range, so nothing to expand.
      snippet = buildEnumMemberSnippet(lines, decl.containerIdx, decl.startIdx, decl.endIdx)
      totalLines = snippet.split('\n').length
    } else {
      ;({ snippet, totalLines } = sliceDeclaration(
        lines,
        decl.startIdx,
        decl.endIdx,
        DEFAULT_SNIPPET_LINES,
      ))
    }
    map.set(decl.name, {
      line: decl.startIdx + 1,
      kind: decl.kind,
      docComment: extractLeadingDocComment(lines, decl.startIdx),
      snippet,
      totalLines,
      signature:
        decl.kind === 'enumMember' ? `${decl.value ?? ''}|${decl.valueNote ?? ''}` : snippet,
      value: decl.value,
      valueNote: decl.valueNote,
      fileLocal: decl.fileLocal,
    })
  }

  lines.forEach((line, idx) => {
    if (constStartLines.has(idx)) return
    const match = line.match(DECL_REGEX)
    if (!match) return
    const rawKind = match[1]
    const name = match[2]
    if (rawKind === 'const') {
      // C# / Rust / Python constants are handled above (the regex would capture the type).
      if (family !== 'ts' && family !== null) return
      // Skip very short or local-looking lowercase consts unless exported
      if (!/^\s*export\b/.test(line)) return
    }
    if (map.has(name)) return

    const { snippet, totalLines } = extractDeclarationSnippet(lines, idx)
    map.set(name, {
      line: idx + 1,
      kind: normalizeKind(rawKind),
      docComment: extractLeadingDocComment(lines, idx),
      snippet,
      totalLines,
      signature: snippet,
      value: null,
      valueNote: null,
      fileLocal: false,
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
      const closeIdx = lines.findIndex((l, i) => i > startIdx && /^\s*<\/script>/i.test(l))
      const { snippet, totalLines } = sliceDeclaration(
        lines,
        startIdx,
        closeIdx >= 0 ? closeIdx : lines.length - 1,
        14,
      )
      map.set(componentName, {
        line: startIdx + 1,
        kind: 'component',
        docComment: extractLeadingDocComment(lines, startIdx),
        snippet,
        totalLines,
        signature: snippet,
        value: null,
        valueNote: null,
        fileLocal: false,
      })
    }
  }

  return map
}

export type PRSymbolIndex = Map<string, SymbolDeclaration[]>

function firstLines(text: string, n: number): string {
  return text.split('\n').slice(0, n).join('\n')
}

function lineCount(text: string | null | undefined): number {
  return text ? text.split('\n').length : 0
}

/** How many lines of the declaration `snippet` leaves out (0 when it is complete). */
export function hiddenSnippetLines(
  snippet: string | null | undefined,
  totalLines: number | null | undefined,
): number {
  if (!snippet || !totalLines) return 0
  return Math.max(0, totalLines - lineCount(snippet))
}

function expandSide(
  current: string | null,
  content: string | null | undefined,
  line: number | null | undefined,
  totalLines: number | null | undefined,
  maxLines: number,
): string | null {
  if (current === null || !content || !line || !totalLines) return current
  if (lineCount(current) >= Math.min(maxLines, totalLines)) return current
  const lines = content.split('\n')
  const start = line - 1
  return lines
    .slice(start, start + Math.min(maxLines, totalLines))
    .join('\n')
    .trimEnd()
}

/**
 * Returns a copy of `decl` whose head / base snippets show up to `maxLines` lines of the
 * declaration, read from the PR file contents (or the full text held for repo symbols).
 * Both sides grow together so the Before / After toggle keeps comparing like with like.
 */
export function expandDeclarationSnippets(
  decl: SymbolDeclaration,
  maxLines: number,
  files: PRFile[],
): SymbolDeclaration {
  if (decl.headFullSnippet) {
    return { ...decl, headSnippet: firstLines(decl.headFullSnippet, maxLines) }
  }
  const file = files.find((f) => f.path === decl.path)
  if (!file) return decl
  return {
    ...decl,
    headSnippet:
      expandSide(decl.headSnippet, file.headContent, decl.line, decl.headTotalLines, maxLines) ??
      decl.headSnippet,
    baseSnippet: expandSide(
      decl.baseSnippet,
      file.baseContent,
      decl.baseLine,
      decl.baseTotalLines,
      maxLines,
    ),
  }
}

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
        baseInfo.signature.trim() !== headInfo.signature.trim()

      const decl: SymbolDeclaration = {
        name,
        kind: headInfo.kind,
        path: file.path,
        line: headInfo.line,
        language: file.language,
        docComment: headInfo.docComment,
        headSnippet: headInfo.snippet,
        baseSnippet: baseInfo?.snippet ?? null,
        headTotalLines: headInfo.totalLines,
        baseTotalLines: baseInfo?.totalLines ?? null,
        baseLine: baseInfo?.line ?? null,
        isModifiedInPR,
        value: headInfo.value,
        baseValue: baseInfo?.value ?? null,
        valueNote: headInfo.valueNote,
        fileLocal: headInfo.fileLocal,
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
export interface QualifiedName {
  qualifier: string
  separator: '.' | '::'
  member: string
}

/** Splits `Status.Active` / `Status::Active` into qualifier and member (`null` for bare names). */
export function splitQualifiedName(identifier: string): QualifiedName | null {
  const m = identifier.match(/^([A-Za-z_$][\w$]*)(\.|::)([A-Za-z_$][\w$]*)$/)
  if (!m) return null
  return { qualifier: m[1], separator: m[2] as '.' | '::', member: m[3] }
}

function isVisibleFrom(decl: SymbolDeclaration, currentPath: string): boolean {
  return !decl.fileLocal || decl.path === currentPath
}

const CONST_LIKE_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>(['const', 'enumMember'])

/**
 * For `Qualifier.Member` with no qualified entry in the index, finds a bare constant
 * `Member` (e.g. a C# `public const` inside `class Qualifier`), preferring declarations
 * whose file declares a type named `Qualifier`.
 */
function findQualifiedMemberCandidates(
  q: QualifiedName,
  currentPath: string,
  allFiles: PRFile[],
  index: PRSymbolIndex,
): SymbolDeclaration[] {
  const bare = (index.get(q.member) ?? []).filter(
    (d) => CONST_LIKE_KINDS.has(d.kind) && isVisibleFrom(d, currentPath),
  )
  if (bare.length <= 1) return bare
  const escaped = q.qualifier.replace(/[$]/g, '\\$')
  const typeRe = new RegExp(
    `\\b(?:class|struct|record|interface|enum|object|impl|trait|namespace)\\s+${escaped}\\b`,
  )
  const declaring = bare.filter((d) => {
    const file = allFiles.find((f) => f.path === d.path)
    return typeRe.test(file?.headContent ?? file?.baseContent ?? '')
  })
  return declaring.length > 0 ? declaring : bare
}

function lookupVisibleCandidates(
  identifier: string,
  currentPath: string,
  allFiles: PRFile[],
  index: PRSymbolIndex,
): SymbolDeclaration[] {
  const direct = (index.get(identifier) ?? []).filter((d) => isVisibleFrom(d, currentPath))
  if (direct.length > 0) return direct
  const q = splitQualifiedName(identifier)
  return q ? findQualifiedMemberCandidates(q, currentPath, allFiles, index) : []
}

export function resolveHoverSymbol(
  identifier: string,
  currentFile: PRFile,
  allFiles: PRFile[],
  index: PRSymbolIndex,
): HoverSymbolInfo | null {
  const candidates = lookupVisibleCandidates(identifier, currentFile.path, allFiles, index)
  if (candidates.length === 0) return null

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

export interface HoverableSymbols {
  has(name: string): boolean
}

export interface HoverableSymbolsOptions {
  index: PRSymbolIndex
  currentPath: string
  /** Names resolvable via the local repo (imported names, C# repo types). */
  repoNames?: ReadonlySet<string> | null
}

/**
 * Decides which identifiers in the current file get hover affordances. Bare names follow the
 * PR index (minus other files' file-local declarations) plus repo-resolvable names. Qualified
 * names (`Status.Active`, `Limits::MAX`) are hoverable when indexed, when the member is a
 * visible PR constant, or when the PascalCase qualifier itself is repo-resolvable.
 */
export function createHoverableSymbols(opts: HoverableSymbolsOptions): HoverableSymbols {
  const { index, currentPath } = opts
  const repoNames = opts.repoNames ?? null
  const visible = (name: string) =>
    (index.get(name) ?? []).some((d) => isVisibleFrom(d, currentPath))

  return {
    has(name: string): boolean {
      const q = splitQualifiedName(name)
      if (!q) return visible(name) || Boolean(repoNames?.has(name))
      if (visible(name)) return true
      const memberIsConst = (index.get(q.member) ?? []).some(
        (d) => CONST_LIKE_KINDS.has(d.kind) && isVisibleFrom(d, currentPath),
      )
      if (memberIsConst) return true
      return /^[A-Z]/.test(q.qualifier) && Boolean(repoNames?.has(q.qualifier))
    },
  }
}

/** Fills `value` / `valueNote` for a constant resolved from a bare snippet (repo fallback). */
function withSnippetValue(decl: SymbolDeclaration): SymbolDeclaration {
  if (!CONST_LIKE_KINDS.has(decl.kind)) return decl
  const extracted = extractConstValueFromSnippet(decl.headSnippet, decl.name, decl.language)
  if (!extracted) return decl
  return { ...decl, value: extracted.value, valueNote: extracted.valueNote }
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
  csharpIndex: CSharpTypeIndex | null = null,
): Promise<HoverSymbolInfo | null> {
  const fastResult = resolveHoverSymbol(identifier, currentFile, allFiles, index)
  if (fastResult) return fastResult

  if (!repoPath || !isTauriRuntime()) return null

  const sourceContent = currentFile.headContent ?? currentFile.baseContent
  const qualified = splitQualifiedName(identifier)
  // For `Type.Member`, resolve the type the usual way and look the member up inside it.
  const lookupName = qualified?.qualifier ?? identifier

  const csharpEntry =
    csharpIndex && isCSharpPath(currentFile.path)
      ? pickCSharpTypeEntry(
          lookupName,
          csharpIndex,
          extractCSharpScopeContext(sourceContent),
          currentFile.path,
        )
      : null

  const binding = csharpEntry ? null : findImportBindingForSymbol(sourceContent, lookupName)
  const containerName = csharpEntry?.name ?? binding?.importedName ?? lookupName

  const resolved = await resolveRepoSymbol({
    repoPath,
    importerPath: currentFile.path,
    symbolName: qualified ? qualified.member : containerName,
    container: qualified ? containerName : null,
    importSpecifier: csharpEntry?.namespace ?? binding?.specifier ?? null,
    targetPath: csharpEntry?.path ?? null,
  })

  if (!resolved) {
    // `Namespace.Type` etc.: not a member we can find, so behave like hovering the bare name.
    return qualified
      ? resolveHoverSymbolWithRepoFallback(
          qualified.member,
          currentFile,
          allFiles,
          index,
          repoPath,
          csharpIndex,
        )
      : null
  }

  const declaration: SymbolDeclaration = withSnippetValue({
    name: qualified ? identifier : resolved.name,
    kind: normalizeKind(resolved.kind),
    path: resolved.path,
    line: resolved.line,
    language: resolved.language,
    docComment: resolved.docComment,
    headSnippet: firstLines(resolved.snippet, REPO_SNIPPET_LINES),
    baseSnippet: null,
    headFullSnippet: resolved.snippet,
    headTotalLines: resolved.totalLines ?? resolved.snippet.split('\n').length,
    isModifiedInPR: false,
    source: 'repo',
  })

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
