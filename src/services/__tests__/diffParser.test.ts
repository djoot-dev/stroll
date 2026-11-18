import { describe, expect, it } from 'vitest'
import { buildDiffSegments, parsePatchHunks } from '@/services/diffParser'
import type { PRFile } from '@/types/pr'

function makeFile(overrides: Partial<PRFile>): PRFile {
  return {
    path: 'src/example.ts',
    status: 'modified',
    additions: 0,
    deletions: 0,
    patch: '',
    baseContent: null,
    headContent: null,
    language: 'typescript',
    ...overrides,
  }
}

describe('diffParser', () => {
  describe('parsePatchHunks', () => {
    it('returns an empty array for blank patches', () => {
      expect(parsePatchHunks('')).toEqual([])
      expect(parsePatchHunks('   \n  ')).toEqual([])
    })

    it('parses additions, deletions, context, and ignores no-newline markers', () => {
      const patch = [
        '@@ -10,3 +10,3 @@ function greet() {',
        ' const a = 1',
        '-const b = 2',
        '+const b = 3',
        ' return a + b',
        '\\ No newline at end of file',
      ].join('\n')

      const hunks = parsePatchHunks(patch)
      expect(hunks).toHaveLength(1)
      expect(hunks[0].oldStart).toBe(10)
      expect(hunks[0].newStart).toBe(10)
      expect(hunks[0].lines).toHaveLength(4)

      const [ctx1, delLine, addLine, ctx2] = hunks[0].lines
      expect(ctx1).toMatchObject({
        type: 'context',
        oldLineNumber: 10,
        newLineNumber: 10,
        commentSide: 'RIGHT',
      })
      expect(delLine).toMatchObject({
        type: 'del',
        content: 'const b = 2',
        oldLineNumber: 11,
        newLineNumber: null,
        commentLine: 11,
        commentSide: 'LEFT',
      })
      expect(addLine).toMatchObject({
        type: 'add',
        content: 'const b = 3',
        oldLineNumber: null,
        newLineNumber: 11,
        commentLine: 11,
        commentSide: 'RIGHT',
      })
      expect(ctx2).toMatchObject({
        type: 'context',
        oldLineNumber: 12,
        newLineNumber: 12,
      })
    })

    it('defaults omitted hunk counts to 1', () => {
      const hunks = parsePatchHunks('@@ -1 +1 @@\n-old\n+new')
      expect(hunks).toHaveLength(1)
      expect(hunks[0].oldCount).toBe(1)
      expect(hunks[0].newCount).toBe(1)
    })
  })

  describe('buildDiffSegments', () => {
    it('interleaves leading, middle, and trailing gaps around hunks', () => {
      const headLines = ['l1', 'l2', 'l3', 'l4-new', 'l5', 'l6', 'l7', 'l8-new', 'l9']
      const file = makeFile({
        status: 'modified',
        headContent: headLines.join('\n'),
        patch: [
          '@@ -3,3 +3,3 @@',
          ' l3',
          '-l4-old',
          '+l4-new',
          ' l5',
          '@@ -7,2 +7,2 @@',
          ' l7',
          '-l8-old',
          '+l8-new',
        ].join('\n'),
      })

      const segments = buildDiffSegments(file)
      expect(segments.map((s) => s.kind)).toEqual(['gap', 'hunk', 'gap', 'hunk', 'gap'])

      const [leading, , middle, , trailing] = segments
      expect(leading.kind === 'gap' && leading.lineCount).toBe(2)
      expect(middle.kind === 'gap' && middle.lineCount).toBe(1)
      expect(trailing.kind === 'gap' && trailing.lineCount).toBe(1)
    })

    it('renders full-file hunk for added files without a patch', () => {
      const file = makeFile({
        status: 'added',
        headContent: 'export const x = 1\nexport const y = 2',
      })

      const segments = buildDiffSegments(file)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toMatchObject({
        id: 'hunk-full',
        kind: 'hunk',
        header: '@@ -0,0 +1,2 @@',
      })
      if (segments[0].kind === 'hunk') {
        expect(segments[0].lines.every((l) => l.type === 'add')).toBe(true)
        expect(segments[0].lines[0].commentSide).toBe('RIGHT')
      }
    })

    it('renders full-file deletion hunk for deleted files without a patch', () => {
      const file = makeFile({
        status: 'deleted',
        baseContent: 'const legacy = true',
      })

      const segments = buildDiffSegments(file)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toMatchObject({
        id: 'hunk-full',
        kind: 'hunk',
        header: '@@ -1,1 +0,0 @@',
      })
      if (segments[0].kind === 'hunk') {
        expect(segments[0].lines[0]).toMatchObject({
          type: 'del',
          oldLineNumber: 1,
          newLineNumber: null,
          commentLine: 1,
          commentSide: 'LEFT',
        })
      }
    })
  })
})
