import { describe, expect, it } from 'vitest'
import { buildDiffSegments } from '@/services/diffParser'
import {
  detectMovedCode,
  formatMovedBadgeLabel,
  getMovedLineInfo,
} from '@/services/movedCode'
import type { PRFile } from '@/types/pr'

function makeFile(overrides: Partial<PRFile> & { path: string; patch: string }): PRFile {
  return {
    status: 'modified',
    additions: 0,
    deletions: 0,
    baseContent: null,
    headContent: null,
    language: 'typescript',
    ...overrides,
  }
}

describe('detectMovedCode', () => {
  it('detects a helper function moved within the same file with changed indentation', () => {
    const file = makeFile({
      path: 'src/utils.ts',
      patch: [
        '@@ -10,6 +10,2 @@',
        '-function formatLabel(name: string): string {',
        '-  const cleaned = name.trim()',
        '-  return cleaned.toUpperCase()',
        '-}',
        ' export function main() {',
        '   return true',
        '@@ -40,2 +36,6 @@',
        ' export function helper() {',
        '+  function formatLabel(name: string): string {',
        '+    const cleaned = name.trim()',
        '+    return cleaned.toUpperCase()',
        '+  }',
        '   return formatLabel("ok")',
      ].join('\n'),
    })

    const index = detectMovedCode([file])
    expect(index.blockCount).toBe(1)

    const delStart = getMovedLineInfo(index, 'src/utils.ts', {
      type: 'del',
      oldLineNumber: 10,
      newLineNumber: null,
    })
    expect(delStart).toMatchObject({
      isBlockStart: true,
      blockLength: 4,
      peerPath: 'src/utils.ts',
      peerStartLine: 37,
      peerLine: 37,
      peerSide: 'RIGHT',
    })
    expect(formatMovedBadgeLabel('src/utils.ts', 'del', delStart!)).toBe('Moved to line 37')

    const addStart = getMovedLineInfo(index, 'src/utils.ts', {
      type: 'add',
      oldLineNumber: null,
      newLineNumber: 37,
    })
    expect(addStart).toMatchObject({
      isBlockStart: true,
      blockLength: 4,
      peerPath: 'src/utils.ts',
      peerStartLine: 10,
      peerLine: 10,
      peerSide: 'LEFT',
    })
    expect(formatMovedBadgeLabel('src/utils.ts', 'add', addStart!)).toBe('Moved from line 10')

    const addSecond = getMovedLineInfo(index, 'src/utils.ts', {
      type: 'add',
      oldLineNumber: null,
      newLineNumber: 38,
    })
    expect(addSecond?.isBlockStart).toBe(false)
    expect(addSecond?.peerLine).toBe(11)
  })

  it('detects blocks moved across different files', () => {
    const sourceFile = makeFile({
      path: 'src/old/dispatcher.ts',
      patch: [
        '@@ -20,5 +20,1 @@',
        '-export function computeRetryDelay(attempt: number): number {',
        '-  const base = 1000 * Math.pow(2, attempt)',
        '-  return Math.min(60_000, base)',
        '-}',
        ' export const READY = true',
      ].join('\n'),
    })

    const targetFile = makeFile({
      path: 'src/new/backoff.ts',
      status: 'added',
      patch: [
        '@@ -0,0 +1,4 @@',
        '+export function computeRetryDelay(attempt: number): number {',
        '+  const base = 1000 * Math.pow(2, attempt)',
        '+  return Math.min(60_000, base)',
        '+}',
      ].join('\n'),
    })

    const index = detectMovedCode([sourceFile, targetFile])
    expect(index.blockCount).toBe(1)

    const delInfo = getMovedLineInfo(index, 'src/old/dispatcher.ts', {
      type: 'del',
      oldLineNumber: 20,
      newLineNumber: null,
    })
    expect(delInfo?.peerPath).toBe('src/new/backoff.ts')
    expect(delInfo?.peerStartLine).toBe(1)
    expect(formatMovedBadgeLabel('src/old/dispatcher.ts', 'del', delInfo!)).toBe(
      'Moved to backoff.ts:1',
    )

    const addInfo = getMovedLineInfo(index, 'src/new/backoff.ts', {
      type: 'add',
      oldLineNumber: null,
      newLineNumber: 1,
    })
    expect(addInfo?.peerPath).toBe('src/old/dispatcher.ts')
    expect(addInfo?.peerStartLine).toBe(20)
    expect(formatMovedBadgeLabel('src/new/backoff.ts', 'add', addInfo!)).toBe(
      'Moved from dispatcher.ts:20',
    )
  })

  it('detects reordered blocks within the same hunk and suppresses spurious inline diffs', () => {
    const file = makeFile({
      path: 'src/order.ts',
      patch: [
        '@@ -1,6 +1,6 @@',
        '-const alpha = computeAlpha(input)',
        '-const alphaCheck = validateAlpha(alpha)',
        '-const beta = computeBeta(input)',
        '-const betaCheck = validateBeta(beta)',
        '+const beta = computeBeta(input)',
        '+const betaCheck = validateBeta(beta)',
        '+const alpha = computeAlpha(input)',
        '+const alphaCheck = validateAlpha(alpha)',
      ].join('\n'),
    })

    const index = detectMovedCode([file])
    expect(index.blockCount).toBe(2)

    const segments = buildDiffSegments(file, { movedCode: index })
    expect(segments).toHaveLength(1)
    const hunk = segments[0]
    expect(hunk.kind).toBe('hunk')
    if (hunk.kind === 'hunk') {
      for (const line of hunk.lines) {
        expect(line.moved).toBeDefined()
        expect(line.inlineChanges).toBeUndefined()
      }
    }
  })

  it('ignores in-place re-indentation of the same block', () => {
    const file = makeFile({
      path: 'src/indent.ts',
      patch: [
        '@@ -5,4 +5,4 @@',
        '-function greet(name: string) {',
        '-  return `Hello, ${name}`',
        '-}',
        '+  function greet(name: string) {',
        '+    return `Hello, ${name}`',
        '+  }',
      ].join('\n'),
    })

    const index = detectMovedCode([file])
    expect(index.blockCount).toBe(0)
  })

  it('ignores trivial brace-only blocks', () => {
    const file = makeFile({
      path: 'src/braces.ts',
      patch: [
        '@@ -1,3 +1,1 @@',
        '-  }',
        '-}',
        ' const a = 1',
        '@@ -20,1 +18,3 @@',
        ' const b = 2',
        '+  }',
        '+}',
      ].join('\n'),
    })

    const index = detectMovedCode([file])
    expect(index.blockCount).toBe(0)
  })

  it('detects unchanged sub-blocks when a moved function has an edit in the middle', () => {
    const file = makeFile({
      path: 'src/refactor.ts',
      patch: [
        '@@ -1,7 +1,1 @@',
        '-export function processItems(items: string[]) {',
        '-  const normalized = items.map((s) => s.trim())',
        '-  const filtered = normalized.filter(Boolean)',
        '-  return filtered.sort()',
        '-}',
        ' export const VERSION = 1',
        '@@ -30,1 +24,7 @@',
        ' export const END = true',
        '+export function processItems(items: string[]) {',
        '+  const normalized = items.map((s) => s.trim())',
        '+  const filtered = normalized.filter((s) => s.length > 0)',
        '+  return filtered.sort()',
        '+}',
      ].join('\n'),
    })

    const index = detectMovedCode([file])
    expect(index.blockCount).toBe(2)

    // First 2 lines moved
    expect(
      getMovedLineInfo(index, 'src/refactor.ts', {
        type: 'add',
        oldLineNumber: null,
        newLineNumber: 25,
      })?.isBlockStart,
    ).toBe(true)

    // Middle edited line is NOT marked moved
    expect(
      getMovedLineInfo(index, 'src/refactor.ts', {
        type: 'add',
        oldLineNumber: null,
        newLineNumber: 27,
      }),
    ).toBeUndefined()

    // Trailing 2 lines moved
    expect(
      getMovedLineInfo(index, 'src/refactor.ts', {
        type: 'add',
        oldLineNumber: null,
        newLineNumber: 28,
      })?.isBlockStart,
    ).toBe(true)
  })

  it('skips binary files and pure renames', () => {
    const binary = makeFile({
      path: 'assets/logo.png',
      isBinary: true,
      patch: '@@ -1,2 +1,2 @@\n-foo\n-bar\n+foo\n+bar',
    })
    const renamed = makeFile({
      path: 'src/newName.ts',
      previousPath: 'src/oldName.ts',
      status: 'renamed',
      patch: '',
    })

    const index = detectMovedCode([binary, renamed])
    expect(index.blockCount).toBe(0)
  })
})
