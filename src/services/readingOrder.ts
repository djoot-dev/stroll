import type {
  ArchitecturalLayer,
  PRFile,
  ReferencedContext,
  TourDirection,
  TourStep,
} from '@/types/pr'

const LAYER_WEIGHT: Record<ArchitecturalLayer, number> = {
  config: 1,
  types: 2,
  core: 3,
  ui: 4,
  tests: 5,
}

export const LAYER_META: Record<
  ArchitecturalLayer,
  { label: string; shortLabel: string; badgeClass: string }
> = {
  config: {
    label: 'Config & Schemas',
    shortLabel: 'CONFIG',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  types: {
    label: 'Types & Models',
    shortLabel: 'TYPES',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  core: {
    label: 'Core Logic',
    shortLabel: 'CORE',
    badgeClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  ui: {
    label: 'UI & Entry Points',
    shortLabel: 'UI',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  tests: {
    label: 'Tests',
    shortLabel: 'TEST',
    badgeClass: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  },
}

/**
 * Classifies a file path into one of the 5 architectural layers.
 */
export function classifyLayer(path: string): ArchitecturalLayer {
  const lower = path.toLowerCase()
  const fileName = lower.split('/').pop() ?? lower

  // 5. Tests
  if (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(lower) ||
    /_test\.(rs|py|go)$/.test(lower) ||
    /\/__tests__\//.test(lower) ||
    /(^|\/)tests?\//.test(lower)
  ) {
    return 'tests'
  }

  // 1. Config / Schemas / Migrations
  if (
    /(^|\/)(migrations?|schema|prisma|drizzle|db\/migrate)\//.test(lower) ||
    /\.sql$/.test(lower) ||
    /^(package\.json|tsconfig.*\.json|vite\.config\..*|tailwind\.config\..*|cargo\.toml|tauri\.conf\.json|\.env.*|dockerfile|docker-compose.*)$/.test(
      fileName,
    ) ||
    /\.(ya?ml|toml|ini|conf)$/.test(lower) ||
    /(^|\/)(config|configs|capabilities)\//.test(lower)
  ) {
    return 'config'
  }

  // 2. Types / Interfaces / Models
  if (
    /\.d\.ts$/.test(lower) ||
    /(^|\/)(types?|interfaces?|models?|entities|dtos?|schemas?)\//.test(lower) ||
    /\.(types|model|interface|schema|dto)\.[cm]?[jt]sx?$/.test(lower)
  ) {
    return 'types'
  }

  // 4. UI / Controllers / Entry Points
  if (
    /\.(vue|svelte|jsx|tsx|html|css|scss)$/.test(lower) ||
    /(^|\/)(components?|views?|pages?|screens?|layouts?|controllers?|routes?|handlers?|endpoints?|api|cli)\//.test(
      lower,
    ) ||
    /^(main|index|app|server)\.[cm]?[jt]sx?$/.test(fileName)
  ) {
    return 'ui'
  }

  // 3. Core Services / Logic
  return 'core'
}

function normalizePosix(path: string): string {
  const parts = path.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      stack.pop()
    } else {
      stack.push(part)
    }
  }
  return stack.join('/')
}

function stripExt(path: string): string {
  return path.replace(/\.[^./]+$/, '')
}

interface ParsedImport {
  specifier: string
  symbols: string[]
}

/**
 * Extracts relative / `@/` / Rust / Python imports along with imported symbol names.
 */
function parseImports(content: string): ParsedImport[] {
  const results: ParsedImport[] = []

  // JS/TS/Vue: import { A, B as C } from './foo' or import Foo from '../bar'
  const esImportRegex =
    /import\s+(?:type\s+)?(?:(\{[^}]+\})|([A-Za-z_$][\w$]*))?\s*(?:,\s*(?:\{([^}]+)\}))?\s*from\s*['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = esImportRegex.exec(content)) !== null) {
    const namedBlock = match[1] ?? match[3] ?? ''
    const defaultName = match[2]
    const specifier = match[4]
    const symbols: string[] = []
    if (defaultName) symbols.push(defaultName)
    if (namedBlock) {
      namedBlock
        .replace(/[{}]/g, '')
        .split(',')
        .forEach((raw) => {
          const cleaned = raw.replace(/^\s*type\s+/, '').trim()
          if (!cleaned) return
          const original = cleaned.split(/\s+as\s+/)[0]?.trim()
          if (original) symbols.push(original)
        })
    }
    results.push({ specifier, symbols })
  }

  // Side-effect import: import './styles.css'
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g
  while ((match = sideEffectRegex.exec(content)) !== null) {
    results.push({ specifier: match[1], symbols: [] })
  }

  // Python relative imports: from .foo import Bar, Baz
  const pyRegex = /from\s+(\.+[\w.]*)\s+import\s+([^\n]+)/g
  while ((match = pyRegex.exec(content)) !== null) {
    const specifier = match[1].replace(/\./g, '/')
    const symbols = match[2]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter(Boolean)
    results.push({ specifier, symbols })
  }

  return results
}

function resolveImportToPRFile(
  importerPath: string,
  specifier: string,
  allPaths: Set<string>,
  strippedPathMap: Map<string, string>,
): string | null {
  const dir = importerPath.includes('/')
    ? importerPath.slice(0, importerPath.lastIndexOf('/'))
    : ''

  let candidateBase = ''
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    candidateBase = normalizePosix(dir ? `${dir}/${specifier}` : specifier)
  } else if (specifier.startsWith('@/')) {
    candidateBase = normalizePosix(`src/${specifier.slice(2)}`)
  } else {
    return null
  }

  if (allPaths.has(candidateBase)) return candidateBase

  const exts = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.mts', '.py', '.rs', '.sql']
  for (const ext of exts) {
    if (allPaths.has(candidateBase + ext)) return candidateBase + ext
  }
  for (const ext of exts) {
    const indexPath = `${candidateBase}/index${ext}`
    if (allPaths.has(indexPath)) return indexPath
  }

  const byStripped = strippedPathMap.get(stripExt(candidateBase))
  return byStripped ?? null
}

/**
 * Extracts a concise, read-only code snippet from `sourceFile` containing the
 * definitions of `symbolNames` so the reviewer can see referenced PR context.
 */
function extractReferencedSnippet(
  sourceFile: PRFile,
  symbolNames: string[],
): ReferencedContext | null {
  const content = sourceFile.headContent ?? sourceFile.baseContent
  if (!content) return null

  const lines = content.split('\n')
  const matchedIndices: number[] = []

  if (symbolNames.length > 0) {
    const escaped = symbolNames.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const defRegex = new RegExp(
      `\\b(?:export\\s+)?(?:async\\s+)?(?:interface|type|class|enum|function|const|let|def|fn|struct)\\s+(?:${escaped.join('|')})\\b`,
    )
    lines.forEach((line, idx) => {
      if (defRegex.test(line)) {
        matchedIndices.push(idx)
      }
    })
  }

  const startIdx = matchedIndices.length > 0 ? Math.max(0, matchedIndices[0] - 1) : 0
  const endIdx = Math.min(lines.length, startIdx + 18)
  const snippet = lines.slice(startIdx, endIdx).join('\n').trimEnd()
  if (!snippet) return null

  return {
    sourcePath: sourceFile.path,
    symbolNames: symbolNames.slice(0, 6),
    snippet,
    language: sourceFile.language,
    startLine: startIdx + 1,
  }
}

/**
 * Finds the best implementation file in the PR that a test file corresponds to.
 */
function findPairedImplFile(
  testFile: PRFile,
  implFiles: PRFile[],
  depsOfTest: string[],
): string | undefined {
  // 1. Direct relative import from the test file to a non-test PR file
  const nonTestDep = depsOfTest.find((d) => classifyLayer(d) !== 'tests')
  if (nonTestDep) return nonTestDep

  // 2. Basename heuristic: foo.test.ts -> foo.ts / foo.vue
  const testName = testFile.path.split('/').pop() ?? ''
  const cleanTestBase = testName
    .replace(/\.(test|spec)\.[cm]?[jt]sx?$/i, '')
    .replace(/_test\.(rs|py|go)$/i, '')
    .toLowerCase()

  const match = implFiles.find((impl) => {
    const implName = (impl.path.split('/').pop() ?? '').toLowerCase()
    const implBase = stripExt(implName)
    return implBase === cleanTestBase
  })

  return match?.path
}

/**
 * Produces a guided, dependency-aware `TourStep[]` ordering for a PR's changed files.
 */
export function buildReadingOrder(
  files: PRFile[],
  direction: TourDirection = 'bottom-up',
): TourStep[] {
  if (files.length === 0) return []

  const fileMap = new Map<string, PRFile>()
  const allPaths = new Set<string>()
  const strippedPathMap = new Map<string, string>()

  for (const f of files) {
    fileMap.set(f.path, f)
    allPaths.add(f.path)
    strippedPathMap.set(stripExt(f.path), f.path)
  }

  // Build dependency graph: file -> Set<imported PR files>
  const dependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()
  const importedSymbols = new Map<string, Map<string, Set<string>>>()

  for (const f of files) {
    dependencies.set(f.path, new Set())
    dependents.set(f.path, new Set())
    importedSymbols.set(f.path, new Map())
  }

  for (const f of files) {
    const content = f.headContent ?? f.baseContent ?? ''
    if (!content) continue
    const parsed = parseImports(content)
    for (const imp of parsed) {
      const target = resolveImportToPRFile(f.path, imp.specifier, allPaths, strippedPathMap)
      if (!target || target === f.path) continue
      dependencies.get(f.path)!.add(target)
      dependents.get(target)!.add(f.path)

      if (imp.symbols.length > 0) {
        const symMap = importedSymbols.get(f.path)!
        if (!symMap.has(target)) symMap.set(target, new Set())
        imp.symbols.forEach((s) => symMap.get(target)!.add(s))
      }
    }
  }

  const implFiles: PRFile[] = []
  const testFiles: PRFile[] = []

  for (const f of files) {
    if (classifyLayer(f.path) === 'tests') {
      testFiles.push(f)
    } else {
      implFiles.push(f)
    }
  }

  // Topological sort of implFiles (Kahn's algorithm) with layer-priority tie breaking.
  // In bottom-up: dependencies come BEFORE consumers (in-degree = number of unvisited dependencies).
  // In top-down: consumers come BEFORE dependencies (reverse edges).
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  const implSet = new Set(implFiles.map((f) => f.path))

  for (const f of implFiles) {
    inDegree.set(f.path, 0)
    adj.set(f.path, [])
  }

  for (const f of implFiles) {
    const deps = Array.from(dependencies.get(f.path) ?? []).filter((d) => implSet.has(d))
    for (const dep of deps) {
      if (direction === 'bottom-up') {
        // dep -> f
        adj.get(dep)!.push(f.path)
        inDegree.set(f.path, (inDegree.get(f.path) ?? 0) + 1)
      } else {
        // f -> dep
        adj.get(f.path)!.push(dep)
        inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1)
      }
    }
  }

  const comparePaths = (aPath: string, bPath: string): number => {
    const layerA = LAYER_WEIGHT[classifyLayer(aPath)]
    const layerB = LAYER_WEIGHT[classifyLayer(bPath)]
    if (layerA !== layerB) {
      return direction === 'bottom-up' ? layerA - layerB : layerB - layerA
    }
    return aPath.localeCompare(bPath)
  }

  const ready: string[] = implFiles
    .filter((f) => (inDegree.get(f.path) ?? 0) === 0)
    .map((f) => f.path)
    .sort(comparePaths)

  const orderedImpls: string[] = []
  const visited = new Set<string>()

  while (orderedImpls.length < implFiles.length) {
    if (ready.length === 0) {
      // Break import cycle deterministically by picking lowest-priority unvisited node
      const remaining = implFiles
        .filter((f) => !visited.has(f.path))
        .map((f) => f.path)
        .sort(comparePaths)
      if (remaining.length === 0) break
      ready.push(remaining[0])
    }

    const current = ready.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    orderedImpls.push(current)

    for (const next of adj.get(current) ?? []) {
      if (visited.has(next)) continue
      const deg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, deg)
      if (deg <= 0) {
        ready.push(next)
        ready.sort(comparePaths)
      }
    }
  }

  // Pair test files immediately after their corresponding implementation file
  const pairedTestsByImpl = new Map<string, PRFile[]>()
  const orphanTests: PRFile[] = []
  const testPairTarget = new Map<string, string>()

  for (const tf of testFiles) {
    const deps = Array.from(dependencies.get(tf.path) ?? [])
    const target = findPairedImplFile(tf, implFiles, deps)
    if (target && implSet.has(target)) {
      testPairTarget.set(tf.path, target)
      if (!pairedTestsByImpl.has(target)) pairedTestsByImpl.set(target, [])
      pairedTestsByImpl.get(target)!.push(tf)
    } else {
      orphanTests.push(tf)
    }
  }

  const finalOrder: PRFile[] = []
  for (const implPath of orderedImpls) {
    const implFile = fileMap.get(implPath)!
    finalOrder.push(implFile)
    const paired = pairedTestsByImpl.get(implPath) ?? []
    paired.sort((a, b) => a.path.localeCompare(b.path))
    finalOrder.push(...paired)
  }
  orphanTests.sort((a, b) => a.path.localeCompare(b.path))
  finalOrder.push(...orphanTests)

  // Construct TourStep[] with explanations & referenced context cards
  return finalOrder.map((file, idx) => {
    const layer = classifyLayer(file.path)
    const deps = Array.from(dependencies.get(file.path) ?? [])
    const revs = Array.from(dependents.get(file.path) ?? [])
    const pairedWith = testPairTarget.get(file.path)

    let reason = LAYER_META[layer].label
    if (pairedWith) {
      const implName = pairedWith.split('/').pop()
      reason = `Verifies ${implName}`
    } else if (revs.length > 0 && deps.length > 0) {
      reason = `${LAYER_META[layer].label} · Imports ${deps.length} & used by ${revs.length} PR file${revs.length > 1 ? 's' : ''}`
    } else if (revs.length > 0) {
      reason = `${LAYER_META[layer].label} · Imported by ${revs.length} downstream PR file${revs.length > 1 ? 's' : ''}`
    } else if (deps.length > 0) {
      reason = `${LAYER_META[layer].label} · Consumes ${deps.length} modified PR file${deps.length > 1 ? 's' : ''}`
    }

    const symMap = importedSymbols.get(file.path) ?? new Map<string, Set<string>>()
    const referencedContexts: ReferencedContext[] = []
    for (const depPath of deps) {
      const depFile = fileMap.get(depPath)
      if (!depFile) continue
      const syms = Array.from(symMap.get(depPath) ?? [])
      const ctx = extractReferencedSnippet(depFile, syms)
      if (ctx) referencedContexts.push(ctx)
    }

    return {
      stepIndex: idx,
      file,
      layer,
      reason,
      dependencies: deps,
      dependents: revs,
      pairedWith,
      referencedContexts,
    }
  })
}
