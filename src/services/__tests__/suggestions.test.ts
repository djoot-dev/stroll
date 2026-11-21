import { describe, expect, it } from 'vitest'
import {
  applySuggestionToContent,
  buildGitHubPermalink,
  extractSuggestionBlocks,
  hasRepoWriteAccess,
} from '../suggestions'

describe('extractSuggestionBlocks', () => {
  it('extracts single and multiple suggestion blocks', () => {
    const md = [
      'Please simplify this:',
      '```suggestion',
      'const x = 42',
      '```',
      'And ignore normal code:',
      '```ts',
      'const y = 1',
      '```',
      '~~~suggestion',
      'return x + 1',
      '~~~',
    ].join('\n')

    expect(extractSuggestionBlocks(md)).toEqual(['const x = 42', 'return x + 1'])
  })

  it('returns empty array when no suggestion blocks exist', () => {
    expect(extractSuggestionBlocks('Looks good to me!')).toEqual([])
  })
})

describe('applySuggestionToContent', () => {
  it('replaces a single line in file content', () => {
    const content = 'line 1\nline 2\nline 3'
    expect(applySuggestionToContent(content, 2, 2, 'updated 2')).toBe('line 1\nupdated 2\nline 3')
  })

  it('replaces a multiline range with different line count', () => {
    const content = 'a\nb\nc\nd\ne'
    expect(applySuggestionToContent(content, 2, 4, 'x\ny')).toBe('a\nx\ny\ne')
  })
})

describe('hasRepoWriteAccess', () => {
  it('returns true for ADMIN, MAINTAIN, and WRITE', () => {
    expect(hasRepoWriteAccess('ADMIN')).toBe(true)
    expect(hasRepoWriteAccess('MAINTAIN')).toBe(true)
    expect(hasRepoWriteAccess('WRITE')).toBe(true)
    expect(hasRepoWriteAccess('TRIAGE')).toBe(false)
    expect(hasRepoWriteAccess('READ')).toBe(false)
    expect(hasRepoWriteAccess(null)).toBe(false)
  })
})

describe('buildGitHubPermalink', () => {
  it('builds a commit-pinned GitHub blob permalink with optional line anchor', () => {
    expect(
      buildGitHubPermalink('github.com', 'octo', 'stroll', 'abc123', 'src/App.vue', 42),
    ).toBe('https://github.com/octo/stroll/blob/abc123/src/App.vue#L42')

    expect(
      buildGitHubPermalink('ghe.corp.com', 'octo', 'stroll', 'abc123', 'src/my file.ts'),
    ).toBe('https://ghe.corp.com/octo/stroll/blob/abc123/src/my%20file.ts')
  })
})
