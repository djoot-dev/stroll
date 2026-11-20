import { describe, expect, it } from 'vitest'
import {
  buildPRSymbolIndex,
  DEFAULT_SNIPPET_LINES,
  expandDeclarationSnippets,
  hiddenSnippetLines,
  resolveHoverSymbol,
} from '@/services/codeContext'
import type { PRFile } from '@/types/pr'

function file(path: string, headContent: string, baseContent: string | null): PRFile {
  return {
    path,
    status: baseContent === null ? 'added' : 'modified',
    additions: 1,
    deletions: 1,
    patch: '',
    baseContent,
    headContent,
    language: 'typescript',
  }
}

function longFunction(bodyLines: number, prefix = 'v'): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `  const ${prefix}${i} = ${i}`)
  return ['export function big() {', ...body, '}'].join('\n')
}

describe('hover snippet truncation & expansion', () => {
  const head = ['// header', '', longFunction(30), '', 'export const small = 1', ''].join('\n')
  const base = [longFunction(20, 'old'), ''].join('\n')
  const files = [file('src/big.ts', head, base)]
  const index = buildPRSymbolIndex(files)

  it('records the full declaration length alongside the truncated snippet', () => {
    const decl = resolveHoverSymbol('big', files[0], files, index)!.declaration
    expect(decl.line).toBe(3)
    expect(decl.headSnippet.split('\n')).toHaveLength(DEFAULT_SNIPPET_LINES)
    expect(decl.headTotalLines).toBe(32)
    expect(decl.baseTotalLines).toBe(22)
    expect(decl.baseLine).toBe(1)
    expect(hiddenSnippetLines(decl.headSnippet, decl.headTotalLines)).toBe(32 - DEFAULT_SNIPPET_LINES)
  })

  it('reports nothing hidden for short declarations', () => {
    const decl = resolveHoverSymbol('small', files[0], files, index)!.declaration
    expect(hiddenSnippetLines(decl.headSnippet, decl.headTotalLines)).toBe(0)
  })

  it('expands head and base together from the PR file contents', () => {
    const decl = resolveHoverSymbol('big', files[0], files, index)!.declaration

    const more = expandDeclarationSnippets(decl, 20, files)
    expect(more.headSnippet.split('\n')).toHaveLength(20)
    expect(more.baseSnippet!.split('\n')).toHaveLength(20)
    expect(more.baseSnippet).toContain('const old17 = 17')

    const all = expandDeclarationSnippets(decl, 1000, files)
    expect(all.headSnippet.split('\n')).toHaveLength(32)
    expect(all.headSnippet.endsWith('}')).toBe(true)
    expect(all.baseSnippet!.split('\n')).toHaveLength(22)
    expect(hiddenSnippetLines(all.headSnippet, all.headTotalLines)).toBe(0)
  })

  it('expands repo symbols from the full text the native resolver returned', () => {
    const full = longFunction(30)
    const decl = {
      ...resolveHoverSymbol('big', files[0], files, index)!.declaration,
      source: 'repo' as const,
      headFullSnippet: full,
    }
    const all = expandDeclarationSnippets(decl, 1000, [])
    expect(all.headSnippet).toBe(full)
  })
})
