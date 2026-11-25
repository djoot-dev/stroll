import { describe, expect, it } from 'vitest'
import {
  applyMarkdownFormat,
  computeTextDiff,
  extractHttpUrl,
  formatPastedLink,
} from '../markdownFormat'

describe('extractHttpUrl', () => {
  it('accepts http and https URLs with optional surrounding whitespace', () => {
    expect(extractHttpUrl('https://github.com/org/repo/pull/1')).toBe(
      'https://github.com/org/repo/pull/1',
    )
    expect(extractHttpUrl('  http://localhost:1420/foo?bar=1#baz  ')).toBe(
      'http://localhost:1420/foo?bar=1#baz',
    )
  })

  it('rejects non-URLs, non-http protocols, and strings with internal whitespace', () => {
    expect(extractHttpUrl('hello world')).toBeNull()
    expect(extractHttpUrl('https://a.com https://b.com')).toBeNull()
    expect(extractHttpUrl('ftp://example.com/file')).toBeNull()
    expect(extractHttpUrl('[label](https://example.com)')).toBeNull()
  })
})

describe('formatPastedLink', () => {
  it('formats a pasted URL as [](url) and leaves cursor inside [] when nothing is selected', () => {
    const result = formatPastedLink('See ', 'https://example.com/docs', 4, 4)
    expect(result).toEqual({
      text: 'See [](https://example.com/docs)',
      selectionStart: 5,
      selectionEnd: 5,
    })
  })

  it('wraps selected text as [selected](url) and places cursor after the link', () => {
    const result = formatPastedLink('Check the docs here', 'https://example.com', 10, 14)
    expect(result).toEqual({
      text: 'Check the [docs](https://example.com) here',
      selectionStart: 37,
      selectionEnd: 37,
    })
  })

  it('treats whitespace-only selection as empty and places cursor inside []', () => {
    const result = formatPastedLink('See   end', 'https://example.com', 4, 5)
    expect(result).toEqual({
      text: 'See [](https://example.com) end',
      selectionStart: 5,
      selectionEnd: 5,
    })
  })

  it('returns null for non-URLs', () => {
    expect(formatPastedLink('Hello ', 'world', 6, 6)).toBeNull()
  })

  it('returns null when pasting inside an existing markdown link target', () => {
    expect(formatPastedLink('See [docs]()', 'https://example.com', 11, 11)).toBeNull()
  })

  it('returns null when pasting inside inline code or fenced code blocks', () => {
    expect(formatPastedLink('Run `curl `', 'https://example.com', 10, 10)).toBeNull()
    expect(formatPastedLink('```\nconst u = ', 'https://example.com', 14, 14)).toBeNull()
  })
})

describe('applyMarkdownFormat', () => {
  it('wraps and toggles bold, italic, strikethrough, and inline code', () => {
    const bolded = applyMarkdownFormat('hello world', 'bold', 6, 11)
    expect(bolded).toEqual({
      text: 'hello **world**',
      selectionStart: 8,
      selectionEnd: 13,
    })

    const unbolded = applyMarkdownFormat(bolded.text, 'bold', bolded.selectionStart, bolded.selectionEnd)
    expect(unbolded).toEqual({
      text: 'hello world',
      selectionStart: 6,
      selectionEnd: 11,
    })

    expect(applyMarkdownFormat('hi', 'italic', 2, 2)).toEqual({
      text: 'hi**',
      selectionStart: 3,
      selectionEnd: 3,
    })

    expect(applyMarkdownFormat('old', 'strikethrough', 0, 3)).toEqual({
      text: '~~old~~',
      selectionStart: 2,
      selectionEnd: 5,
    })

    expect(applyMarkdownFormat('foo', 'code', 0, 3)).toEqual({
      text: '`foo`',
      selectionStart: 1,
      selectionEnd: 4,
    })
  })

  it('inserts fenced code blocks cleanly', () => {
    const empty = applyMarkdownFormat('Note:', 'codeBlock', 5, 5)
    expect(empty).toEqual({
      text: 'Note:\n```\n\n```',
      selectionStart: 10,
      selectionEnd: 10,
    })

    const wrapped = applyMarkdownFormat('const x = 1', 'codeBlock', 0, 11)
    expect(wrapped).toEqual({
      text: '```\nconst x = 1\n```',
      selectionStart: 4,
      selectionEnd: 15,
    })
  })

  it('formats links for empty selection, text selection, and URL selection', () => {
    expect(applyMarkdownFormat('See ', 'link', 4, 4)).toEqual({
      text: 'See [](url)',
      selectionStart: 7,
      selectionEnd: 10,
    })

    expect(applyMarkdownFormat('See docs', 'link', 4, 8)).toEqual({
      text: 'See [docs](url)',
      selectionStart: 11,
      selectionEnd: 14,
    })

    expect(applyMarkdownFormat('https://example.com', 'link', 0, 19)).toEqual({
      text: '[](https://example.com)',
      selectionStart: 1,
      selectionEnd: 1,
    })
  })

  it('applies and toggles quote, bullet, numbered, and task lists across lines', () => {
    const quoted = applyMarkdownFormat('a\nb', 'quote', 0, 3)
    expect(quoted).toEqual({
      text: '> a\n> b',
      selectionStart: 0,
      selectionEnd: 7,
    })
    expect(applyMarkdownFormat(quoted.text, 'quote', 0, 7)).toEqual({
      text: 'a\nb',
      selectionStart: 0,
      selectionEnd: 3,
    })

    expect(applyMarkdownFormat('one\ntwo', 'numberedList', 0, 7)).toEqual({
      text: '1. one\n2. two',
      selectionStart: 0,
      selectionEnd: 13,
    })

    expect(applyMarkdownFormat('todo', 'taskList', 4, 4)).toEqual({
      text: '- [ ] todo',
      selectionStart: 10,
      selectionEnd: 10,
    })

    expect(applyMarkdownFormat('item', 'bulletList', 0, 4)).toEqual({
      text: '- item',
      selectionStart: 0,
      selectionEnd: 6,
    })
  })
})

describe('computeTextDiff', () => {
  it('computes minimal contiguous range for insertions, wrapping, and deletions', () => {
    expect(computeTextDiff('See ', 'See [](https://example.com)')).toEqual({
      start: 4,
      end: 4,
      replacement: '[](https://example.com)',
    })

    expect(computeTextDiff('hello world', 'hello **world**')).toEqual({
      start: 6,
      end: 11,
      replacement: '**world**',
    })

    expect(computeTextDiff('- item', 'item')).toEqual({
      start: 0,
      end: 2,
      replacement: '',
    })
  })
})
