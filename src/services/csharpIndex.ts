import { indexCSharpTypes, type CSharpTypeEntry } from './native'

/**
 * C# `using` directives bring namespaces (not type names) into scope, and .NET solutions
 * rarely mirror namespaces onto folders. Hover therefore relies on a repo-wide index of
 * declared types (built natively) to know which identifiers are resolvable and where.
 */
export type CSharpTypeIndex = ReadonlyMap<string, readonly CSharpTypeEntry[]>

const indexCache = new Map<string, { version: string; pending: Promise<CSharpTypeIndex | null> }>()

export function isCSharpPath(path: string): boolean {
  return path.toLowerCase().endsWith('.cs')
}

export function groupCSharpTypeEntries(entries: readonly CSharpTypeEntry[]): CSharpTypeIndex {
  const map = new Map<string, CSharpTypeEntry[]>()
  for (const entry of entries) {
    const list = map.get(entry.name)
    if (list) list.push(entry)
    else map.set(entry.name, [entry])
  }
  return map
}

/**
 * Loads (and caches per repo path) the C# type index. `version` (e.g. the PR head SHA)
 * invalidates the cached scan when it changes. Resolves to `null` outside Tauri or on failure.
 */
export function loadCSharpTypeIndex(
  repoPath: string,
  version = '',
): Promise<CSharpTypeIndex | null> {
  const cached = indexCache.get(repoPath)
  if (cached && cached.version === version) return cached.pending

  const pending = indexCSharpTypes(repoPath).then((entries) => {
    if (!entries) {
      if (indexCache.get(repoPath)?.pending === pending) indexCache.delete(repoPath)
      return null
    }
    return groupCSharpTypeEntries(entries)
  })
  indexCache.set(repoPath, { version, pending })
  return pending
}

export interface CSharpScopeContext {
  /** Namespaces imported via `using Ns;` / `global using Ns;` */
  usings: string[]
  /** `using Alias = Ns.Type;` → alias → fully-qualified target */
  aliases: Map<string, string>
  /** Namespace(s) declared in the file (block or file-scoped). */
  namespaces: string[]
}

export function extractCSharpScopeContext(content: string | null | undefined): CSharpScopeContext {
  const ctx: CSharpScopeContext = { usings: [], aliases: new Map(), namespaces: [] }
  if (!content) return ctx

  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const alias = line.match(/^\s*(?:global\s+)?using\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)\s*;/)
    if (alias) {
      ctx.aliases.set(alias[1], alias[2])
      continue
    }
    const using = line.match(/^\s*(?:global\s+)?using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/)
    if (using) {
      ctx.usings.push(using[1])
      continue
    }
    const ns = line.match(/^\s*namespace\s+([A-Za-z_][\w.]*)/)
    if (ns) ctx.namespaces.push(ns[1])
  }
  return ctx
}

/** All enclosing namespaces of `ns`, innermost first (C# resolves names through each of them). */
function enclosingNamespaces(ns: string): string[] {
  const parts = ns.split('.')
  const out: string[] = []
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('.'))
  return out
}

function isTestPath(path: string): boolean {
  return /(^|[/.])tests?([/.]|$)/i.test(path) || /tests?\.cs$/i.test(path)
}

function sharedPrefixLength(a: string, b: string): number {
  const pa = a.split('/')
  const pb = b.split('/')
  let i = 0
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  return i
}

/**
 * Picks the most plausible declaration of `name` for a file with the given scope context:
 * aliases, then the file's own (enclosing) namespaces, then imported namespaces. When the
 * namespace doesn't settle it (implicit/global usings, same-named types), prefer
 * non-test files closest to the importer.
 */
export function pickCSharpTypeEntry(
  name: string,
  index: CSharpTypeIndex,
  ctx: CSharpScopeContext,
  importerPath: string,
): CSharpTypeEntry | null {
  const aliasTarget = ctx.aliases.get(name)
  const lookupName = aliasTarget ? aliasTarget.split('.').pop()! : name
  const candidates = index.get(lookupName)
  if (!candidates || candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  if (aliasTarget) {
    const aliasNs = aliasTarget.split('.').slice(0, -1).join('.')
    const hit = candidates.find((c) => c.namespace === aliasNs)
    if (hit) return hit
  }

  const rank = new Map<string, number>()
  let r = 0
  for (const ns of ctx.namespaces) {
    for (const enclosing of enclosingNamespaces(ns)) {
      if (!rank.has(enclosing)) rank.set(enclosing, r++)
    }
  }
  for (const ns of ctx.usings) {
    if (!rank.has(ns)) rank.set(ns, r++)
  }

  const importerIsTest = isTestPath(importerPath)
  const score = (c: CSharpTypeEntry): [number, number, number] => [
    c.namespace != null && rank.has(c.namespace) ? rank.get(c.namespace)! : Number.MAX_SAFE_INTEGER,
    !importerIsTest && isTestPath(c.path) ? 1 : 0,
    -sharedPrefixLength(c.path, importerPath),
  ]

  return [...candidates].sort((a, b) => {
    const sa = score(a)
    const sb = score(b)
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return sa[i] - sb[i]
    }
    return a.path.localeCompare(b.path)
  })[0]
}
