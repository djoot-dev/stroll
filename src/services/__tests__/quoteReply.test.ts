import { describe, expect, it } from 'vitest'
import { appendQuoteToDraft, formatBlockquote } from '@/services/quoteReply'

describe('quoteReply helpers', () => {
  it('formats single and multi-line text as markdown blockquotes', () => {
    expect(formatBlockquote('hello\n\nworld')).toBe('> hello\n>\n> world\n\n')
    expect(formatBlockquote('   ')).toBe('')
  })

  it('appends quotes cleanly to empty or non-empty drafts', () => {
    expect(appendQuoteToDraft('', 'line 1')).toBe('> line 1\n\n')
    expect(appendQuoteToDraft('My thoughts:', 'line 1')).toBe('My thoughts:\n\n> line 1\n\n')
    expect(appendQuoteToDraft('My thoughts:\n', 'line 1')).toBe('My thoughts:\n\n> line 1\n\n')
    expect(appendQuoteToDraft('My thoughts:\n\n', 'line 1')).toBe('My thoughts:\n\n> line 1\n\n')
  })
})
