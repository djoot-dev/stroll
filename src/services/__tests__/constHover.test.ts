import { describe, expect, it } from 'vitest'
import {
  buildPRSymbolIndex,
  createHoverableSymbols,
  resolveHoverSymbol,
  splitQualifiedName,
} from '@/services/codeContext'
import { buildLineTokenParts } from '@/services/inlineDiff'
import type { PRFile } from '@/types/pr'

function file(path: string, language: string, headContent: string, baseContent: string | null = headContent): PRFile {
  return {
    path,
    status: baseContent === null ? 'added' : 'modified',
    additions: 1,
    deletions: 1,
    patch: '',
    baseContent,
    headContent,
    language,
  }
}

const limitsCs = file(
  'src/Limits.cs',
  'csharp',
  [
    'namespace App;',
    'public static class RetryLimits',
    '{',
    '    public const int MaxRetries = 10;',
    '    private const string Prefix = "x";',
    '}',
    'public enum OrderStatus',
    '{',
    '    Pending,',
    '    Shipped,',
    '}',
  ].join('\n'),
  [
    'namespace App;',
    'public static class RetryLimits',
    '{',
    '    public const int MaxRetries = 5;',
    '    private const string Prefix = "x";',
    '}',
    'public enum OrderStatus',
    '{',
    '    Shipped,',
    '}',
  ].join('\n'),
)

const consumerCs = file(
  'src/Worker.cs',
  'csharp',
  'class Worker { void Run() { var n = RetryLimits.MaxRetries; var s = OrderStatus.Shipped; } }',
)

const configTs = file(
  'src/config.ts',
  'typescript',
  ['export const TIMEOUT_MS = 30_000', 'const LOCAL_LIMIT = 3', 'export const API = 1'].join('\n'),
  ['export const TIMEOUT_MS = 30_000', 'const LOCAL_LIMIT = 3', 'export const API = 2'].join('\n'),
)

const otherTs = file('src/other.ts', 'typescript', 'const x = TIMEOUT_MS + LOCAL_LIMIT')

const files = [limitsCs, consumerCs, configTs, otherTs]

describe('constant hover values', () => {
  const index = buildPRSymbolIndex(files)

  it('indexes C# constants under their name (not the type) with base and head values', () => {
    expect(index.has('int')).toBe(false)
    const decl = index.get('MaxRetries')![0]
    expect(decl).toMatchObject({
      kind: 'const',
      value: '10',
      baseValue: '5',
      isModifiedInPR: true,
      headSnippet: '    public const int MaxRetries = 10;',
    })
  })

  it('marks unchanged constants as not modified', () => {
    const decl = index.get('TIMEOUT_MS')![0]
    expect(decl).toMatchObject({ value: '30_000', baseValue: '30_000', isModifiedInPR: false })
    expect(index.get('API')![0]).toMatchObject({ value: '1', baseValue: '2', isModifiedInPR: true })
  })

  it('treats implicit enum value shifts as modifications', () => {
    const shipped = index.get('OrderStatus.Shipped')![0]
    expect(shipped).toMatchObject({
      kind: 'enumMember',
      value: '1',
      baseValue: '0',
      valueNote: 'implicit',
      isModifiedInPR: true,
    })
    expect(shipped.headSnippet).toBe(['public enum OrderStatus', '{', '    …', '    Shipped,'].join('\n'))
    expect(index.get('OrderStatus.Pending')![0].isModifiedInPR).toBe(true)
  })

  it('only resolves file-local constants from their own file', () => {
    expect(resolveHoverSymbol('LOCAL_LIMIT', configTs, files, index)?.declaration.value).toBe('3')
    expect(resolveHoverSymbol('LOCAL_LIMIT', otherTs, files, index)).toBeNull()
    expect(resolveHoverSymbol('TIMEOUT_MS', otherTs, files, index)?.declaration.path).toBe('src/config.ts')
  })

  it('resolves qualified enum members and type-scoped constants', () => {
    const member = resolveHoverSymbol('OrderStatus.Shipped', consumerCs, files, index)
    expect(member?.declaration).toMatchObject({ name: 'OrderStatus.Shipped', value: '1' })
    expect(member?.usages.map((u) => u.path)).toContain('src/Worker.cs')

    const scoped = resolveHoverSymbol('RetryLimits.MaxRetries', consumerCs, files, index)
    expect(scoped?.declaration).toMatchObject({ name: 'MaxRetries', path: 'src/Limits.cs', value: '10' })

    // Private constants are not reachable from other files.
    expect(resolveHoverSymbol('RetryLimits.Prefix', consumerCs, files, index)).toBeNull()
  })

  it('decides hoverability per file, including qualified names', () => {
    const inOther = createHoverableSymbols({ index, currentPath: otherTs.path })
    expect(inOther.has('TIMEOUT_MS')).toBe(true)
    expect(inOther.has('LOCAL_LIMIT')).toBe(false)

    const inConfig = createHoverableSymbols({ index, currentPath: configTs.path })
    expect(inConfig.has('LOCAL_LIMIT')).toBe(true)

    const inWorker = createHoverableSymbols({
      index,
      currentPath: consumerCs.path,
      repoNames: new Set(['RepoLimits', 'helpers']),
    })
    expect(inWorker.has('OrderStatus.Shipped')).toBe(true)
    expect(inWorker.has('RetryLimits.MaxRetries')).toBe(true)
    expect(inWorker.has('RepoLimits.Anything')).toBe(true)
    expect(inWorker.has('helpers.anything')).toBe(false)
    expect(inWorker.has('Unknown.Thing')).toBe(false)
  })

  it('splits qualified names', () => {
    expect(splitQualifiedName('Mode::Fast')).toEqual({ qualifier: 'Mode', separator: '::', member: 'Fast' })
    expect(splitQualifiedName('Fast')).toBeNull()
  })
})

describe('buildLineTokenParts qualified identifiers', () => {
  const symbols = new Set(['Status.Active', 'Mode::Fast', 'Active', 'Status.Load'])

  function identsOf(line: string) {
    // One span per line is enough: qualification works on the joined line text.
    return buildLineTokenParts([{ text: line, className: '' }], symbols)
      .filter((p) => p.ident)
      .map((p) => [p.text, p.ident])
  }

  it('prefers the qualified key for member access', () => {
    expect(identsOf('if (s === Status.Active) {}')).toEqual([['Active', 'Status.Active']])
    expect(identsOf('let m = Mode :: Fast;')).toEqual([['Fast', 'Mode::Fast']])
  })

  it('falls back to the bare name and ignores calls / generics', () => {
    expect(identsOf('other.Active')).toEqual([['Active', 'Active']])
    expect(identsOf('Status.Load()')).toEqual([])
  })

  it('works across highlight span boundaries', () => {
    const parts = buildLineTokenParts(
      [
        { text: 'Status', className: 'tok-type' },
        { text: '.', className: 'tok-punc' },
        { text: 'Active', className: 'tok-prop' },
      ],
      symbols,
    )
    expect(parts.find((p) => p.text === 'Active')?.ident).toBe('Status.Active')
  })
})
