import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetCommentSnippetsForTests,
  applyConventionalPrefix,
  CONVENTIONAL_PREFIXES,
  deriveSnippetName,
  detectActivePrefix,
  insertSnippetAtCursor,
  useCommentSnippets,
} from '@/services/commentSnippets'
import { loadCommentSnippets, saveCommentSnippets } from '@/services/storage'

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear() {
      data.clear()
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null
    },
    removeItem(key: string) {
      data.delete(key)
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    },
  }
}

describe('commentSnippets', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    _resetCommentSnippetsForTests()
  })

  it('defines the four conventional comment prefixes', () => {
    expect(CONVENTIONAL_PREFIXES.map((p) => p.label)).toEqual([
      'nit:',
      'suggestion:',
      'question:',
      'praise:',
    ])
  })

  it('detects active conventional prefixes at the start of a comment', () => {
    expect(detectActivePrefix('')).toBeNull()
    expect(detectActivePrefix('Looks good')).toBeNull()
    expect(detectActivePrefix('nit: rename this variable')).toBe('nit:')
    expect(detectActivePrefix('  SUGGESTION: extract helper')).toBe('suggestion:')
    expect(detectActivePrefix('question:')).toBe('question:')
    expect(detectActivePrefix('praise: clean error handling')).toBe('praise:')
  })

  it('applies, switches, and toggles off conventional prefixes', () => {
    expect(applyConventionalPrefix('', 'nit:')).toBe('nit: ')
    expect(applyConventionalPrefix('rename this variable', 'nit:')).toBe('nit: rename this variable')
    expect(applyConventionalPrefix('nit: rename this variable', 'suggestion:')).toBe(
      'suggestion: rename this variable',
    )
    expect(applyConventionalPrefix('nit: rename this variable', 'nit:')).toBe('rename this variable')
    expect(applyConventionalPrefix('nit: ', 'nit:')).toBe('')
  })

  it('inserts snippets at cursor with clean spacing', () => {
    expect(insertSnippetAtCursor('', 'Please add a test.')).toEqual({
      text: 'Please add a test.',
      cursor: 18,
    })

    expect(insertSnippetAtCursor('nit:', 'Please add a test.', 4, 4)).toEqual({
      text: 'nit: Please add a test.',
      cursor: 23,
    })

    expect(insertSnippetAtCursor('nit: ', 'Please add a test.', 5, 5)).toEqual({
      text: 'nit: Please add a test.',
      cursor: 23,
    })

    expect(insertSnippetAtCursor('Hello old world', 'new', 6, 9)).toEqual({
      text: 'Hello new world',
      cursor: 9,
    })
  })

  it('derives readable snippet names from comment bodies', () => {
    expect(deriveSnippetName('**Add unit test**')).toBe('Add unit test')
    expect(deriveSnippetName('   \n# Extract helper\nMore details')).toBe('Extract helper')
    expect(
      deriveSnippetName('Could we please add a unit test for this edge case?'),
    ).toBe('Could we please add a u…')
    expect(deriveSnippetName('   ')).toBe('Custom snippet')
  })

  it('persists, loads, and removes user-defined comment snippets', async () => {
    expect(await loadCommentSnippets()).toEqual([])

    const { snippets, ensureLoaded, addSnippet, removeSnippet } = useCommentSnippets()
    await ensureLoaded()
    expect(snippets.value).toEqual([])

    const created = await addSnippet('Add test', 'Could we add a unit test for this?')
    expect(created).not.toBeNull()
    expect(snippets.value).toHaveLength(1)
    expect(await loadCommentSnippets()).toEqual(snippets.value)

    await removeSnippet(created!.id)
    expect(snippets.value).toEqual([])
    expect(await loadCommentSnippets()).toEqual([])

    await saveCommentSnippets([{ id: 'snip-1', name: 'LGTM', body: 'Looks great!' }])
    _resetCommentSnippetsForTests()
    await ensureLoaded()
    expect(snippets.value).toEqual([{ id: 'snip-1', name: 'LGTM', body: 'Looks great!' }])
  })
})
