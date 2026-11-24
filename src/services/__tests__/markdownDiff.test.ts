import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import { buildDiffSegments } from '@/services/diffParser'
import { buildMarkdownDiffBlocks } from '@/services/markdownDiff'
import type { PRFile } from '@/types/pr'

function makeMdFile(overrides: Partial<PRFile>): PRFile {
  return {
    path: 'README.md',
    status: 'modified',
    additions: 0,
    deletions: 0,
    patch: '',
    baseContent: null,
    headContent: null,
    language: 'markdown',
    ...overrides,
  }
}

describe('buildMarkdownDiffBlocks', () => {
  it('marks added, removed, modified, and unchanged blocks with accurate anchors', () => {
    const baseContent = [
      '# Overview',
      '',
      'Old intro line.',
      '',
      'Removed section text.',
      '',
      'Unchanged footer.',
    ].join('\n')

    const headContent = [
      '# Overview',
      '',
      'New intro line.',
      '',
      'Unchanged footer.',
      '',
      'Added appendix.',
    ].join('\n')

    const patch = [
      '@@ -1,7 +1,7 @@',
      ' # Overview',
      ' ',
      '-Old intro line.',
      '+New intro line.',
      ' ',
      '-Removed section text.',
      '-',
      ' Unchanged footer.',
      '+',
      '+Added appendix.',
    ].join('\n')

    const file = makeMdFile({ baseContent, headContent, patch, additions: 3, deletions: 3 })
    const segments = buildDiffSegments(file)
    const blocks = buildMarkdownDiffBlocks({
      baseContent,
      headContent,
      status: file.status,
      segments,
    })

    expect(blocks.map((b) => b.changeKind)).toEqual([
      'unchanged',
      'modified',
      'removed',
      'unchanged',
      'added',
    ])

    // Modified paragraph has both removed and added HTML + RIGHT anchor on line 3
    expect(blocks[1].removedHtml).toContain('Old intro line.')
    expect(blocks[1].addedHtml).toContain('New intro line.')
    expect(blocks[1].commentAnchor).toEqual({ line: 3, side: 'RIGHT' })
    expect(blocks[1].jumpAnchor).toEqual({ line: 3, side: 'RIGHT' })

    // Removed paragraph anchors on LEFT line 5
    expect(blocks[2].html).toContain('Removed section text.')
    expect(blocks[2].commentAnchor).toEqual({ line: 5, side: 'LEFT' })
    expect(blocks[2].jumpAnchor).toEqual({ line: 5, side: 'LEFT' })

    // Added paragraph anchors on RIGHT line 7
    expect(blocks[4].html).toContain('Added appendix.')
    expect(blocks[4].commentAnchor).toEqual({ line: 7, side: 'RIGHT' })
  })

  it('diffs list items individually inside a partially modified list', () => {
    const baseContent = [
      '- Keep one',
      '- Old item',
      '- Keep two',
    ].join('\n')

    const headContent = [
      '- Keep one',
      '- New item',
      '- Keep two',
      '- Added item',
    ].join('\n')

    const patch = [
      '@@ -1,3 +1,4 @@',
      ' - Keep one',
      '-- Old item',
      '+- New item',
      ' - Keep two',
      '+- Added item',
    ].join('\n')

    const file = makeMdFile({ baseContent, headContent, patch })
    const blocks = buildMarkdownDiffBlocks({
      baseContent,
      headContent,
      status: file.status,
      segments: buildDiffSegments(file),
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].changeKind).toBe('modified')
    expect(blocks[0].html).toContain('<li>Keep one</li>')
    expect(blocks[0].html).toContain('bg-diff-del/65')
    expect(blocks[0].html).toContain('Old item')
    expect(blocks[0].html).toContain('bg-diff-add/65')
    expect(blocks[0].html).toContain('New item')
    expect(blocks[0].html).toContain('Added item')
    expect(blocks[0].commentAnchor).toEqual({ line: 4, side: 'RIGHT' })
    expect(blocks[0].jumpAnchor).toEqual({ line: 2, side: 'RIGHT' })
  })

  it('diffs table rows individually when headers match, and falls back when columns change', () => {
    const baseContent = [
      '| Key | Value |',
      '| :--- | :--- |',
      '| a | 1 |',
      '| b | 2 |',
    ].join('\n')

    const headContent = [
      '| Key | Value |',
      '| :--- | :--- |',
      '| a | 1 |',
      '| b | 20 |',
      '| c | 30 |',
    ].join('\n')

    const patch = [
      '@@ -1,4 +1,5 @@',
      ' | Key | Value |',
      ' | :--- | :--- |',
      ' | a | 1 |',
      '-| b | 2 |',
      '+| b | 20 |',
      '+| c | 30 |',
    ].join('\n')

    const file = makeMdFile({ baseContent, headContent, patch })
    const blocks = buildMarkdownDiffBlocks({
      baseContent,
      headContent,
      status: file.status,
      segments: buildDiffSegments(file),
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].changeKind).toBe('modified')
    expect(blocks[0].html).toContain('bg-diff-del/70')
    expect(blocks[0].html).toContain('bg-diff-add/70')
    expect(blocks[0].html).toContain('30')

    // Schema change (new column) falls back to removed + added pair
    const schemaHead = [
      '| Key | Value | Notes |',
      '| :--- | :--- | :--- |',
      '| a | 1 | ok |',
    ].join('\n')
    const schemaPatch = [
      '@@ -1,4 +1,3 @@',
      '-| Key | Value |',
      '-| :--- | :--- |',
      '-| a | 1 |',
      '-| b | 2 |',
      '+| Key | Value | Notes |',
      '+| :--- | :--- | :--- |',
      '+| a | 1 | ok |',
    ].join('\n')
    const schemaFile = makeMdFile({ baseContent, headContent: schemaHead, patch: schemaPatch })
    const schemaBlocks = buildMarkdownDiffBlocks({
      baseContent,
      headContent: schemaHead,
      status: schemaFile.status,
      segments: buildDiffSegments(schemaFile),
    })
    expect(schemaBlocks).toHaveLength(1)
    expect(schemaBlocks[0].removedHtml).toContain('<table')
    expect(schemaBlocks[0].addedHtml).toContain('Notes')
  })

  it('diffs fenced code lines inside a block and marks removed lines separately from kept lines', () => {
    const baseContent = [
      '```ts',
      'const a = 1',
      'const b = 2',
      '```',
    ].join('\n')

    const headContent = [
      '```ts',
      'const a = 1',
      'const b = 42',
      'const c = 3',
      '```',
    ].join('\n')

    const patch = [
      '@@ -1,4 +1,5 @@',
      ' ```ts',
      ' const a = 1',
      '-const b = 2',
      '+const b = 42',
      '+const c = 3',
      ' ```',
    ].join('\n')

    const file = makeMdFile({ baseContent, headContent, patch })
    const blocks = buildMarkdownDiffBlocks({
      baseContent,
      headContent,
      status: file.status,
      segments: buildDiffSegments(file),
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].changeKind).toBe('modified')
    expect(blocks[0].html).toContain('data-code-line="del"')
    expect(blocks[0].html).toContain('const b = 2')
    expect(blocks[0].html).toContain('data-code-line="keep"')
    expect(blocks[0].html).toContain('const b = 42')
    expect(blocks[0].html).toContain('const c = 3')
    expect(blocks[0].html).toContain('data-copy-code')
  })

  it('handles pure-deletion edits inside a multi-line paragraph or list', () => {
    const baseContent = [
      '- First',
      '- Deleted middle',
      '- Last',
    ].join('\n')

    const headContent = [
      '- First',
      '- Last',
    ].join('\n')

    const patch = [
      '@@ -1,3 +1,2 @@',
      ' - First',
      '-- Deleted middle',
      ' - Last',
    ].join('\n')

    const file = makeMdFile({ baseContent, headContent, patch })
    const blocks = buildMarkdownDiffBlocks({
      baseContent,
      headContent,
      status: file.status,
      segments: buildDiffSegments(file),
    })

    expect(blocks).toHaveLength(1)
    expect(blocks[0].changeKind).toBe('modified')
    expect(blocks[0].html).toContain('Deleted middle')
    expect(blocks[0].html).toContain('bg-diff-del/65')
    expect(blocks[0].commentAnchor).toEqual({ line: 2, side: 'LEFT' })
    expect(blocks[0].jumpAnchor).toEqual({ line: 2, side: 'LEFT' })
  })

  it('handles added and deleted files without requiring a patch', () => {
    const added = buildMarkdownDiffBlocks({
      baseContent: null,
      headContent: '# New Doc\n\nBody text.',
      status: 'added',
      segments: [],
    })
    expect(added.map((b) => b.changeKind)).toEqual(['added', 'added'])
    expect(added[1].commentAnchor).toEqual({ line: 3, side: 'RIGHT' })

    const deleted = buildMarkdownDiffBlocks({
      baseContent: '# Old Doc\n\nRemoved body.',
      headContent: null,
      status: 'deleted',
      segments: [],
    })
    expect(deleted.map((b) => b.changeKind)).toEqual(['removed', 'removed'])
    expect(deleted[1].commentAnchor).toEqual({ line: 3, side: 'LEFT' })
  })

  it('diffs MOCK_PR docs/webhooks.md with per-item list, per-row table, and pure-addition code fence', () => {
    const mdFile = MOCK_PR.files.find((f) => f.path === 'docs/webhooks.md')
    expect(mdFile).toBeDefined()
    const blocks = buildMarkdownDiffBlocks({
      baseContent: mdFile!.baseContent,
      headContent: mdFile!.headContent,
      status: mdFile!.status,
      segments: buildDiffSegments(mdFile!),
    })

    expect(blocks.map((b) => b.changeKind)).toEqual([
      'unchanged', // # Webhook Delivery Guide
      'modified', // intro paragraph
      'unchanged', // ## Retry & Rate Limiting
      'modified', // sub-block list diff
      'added', // > [!NOTE]
      'unchanged', // ## Delivery Statuses
      'modified', // sub-block table diff
      'removed', // ## Legacy Signing Note
      'removed', // legacy paragraph
      'unchanged', // ## SDK Example
      'modified', // sub-block ts code diff (pure addition)
    ])

    // List preserves unchanged 3rd bullet and marks added/removed bullets
    expect(blocks[3].html).toContain('<li>Payloads include an')
    expect(blocks[3].html).toContain('bg-diff-del/65')
    expect(blocks[3].html).toContain('bg-diff-add/65')

    // Table preserves delivered row and marks dropped/retrying/failed rows
    expect(blocks[6].html).toContain('bg-diff-del/70')
    expect(blocks[6].html).toContain('bg-diff-add/70')
    expect(blocks[6].html).toContain('retrying')

    // Code block keeps context lines and highlights pure-addition line
    expect(blocks[10].html).toContain('data-code-line-row="add"')
    expect(blocks[10].html).toContain('maxRequestsPerMinute: 120,')
  })
})
