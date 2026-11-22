import { ref } from 'vue'
import { loadCommentSnippets, saveCommentSnippets, type CommentSnippet } from './storage'

export interface ConventionalPrefix {
  id: 'nit' | 'suggestion' | 'question' | 'praise'
  label: `${'nit' | 'suggestion' | 'question' | 'praise'}:`
  description: string
}

export const CONVENTIONAL_PREFIXES: readonly ConventionalPrefix[] = [
  {
    id: 'nit',
    label: 'nit:',
    description: 'Minor, non-blocking polish or style note',
  },
  {
    id: 'suggestion',
    label: 'suggestion:',
    description: 'Propose a specific change or alternative',
  },
  {
    id: 'question',
    label: 'question:',
    description: 'Ask for clarification or context',
  },
  {
    id: 'praise',
    label: 'praise:',
    description: 'Highlight something well done',
  },
] as const

const PREFIX_PATTERN = /^\s*(nit|suggestion|question|praise):(?:\s+|$)/i

/**
 * Returns the conventional prefix label at the start of `body`, or `null` if none is present.
 */
export function detectActivePrefix(body: string): ConventionalPrefix['label'] | null {
  const match = body.match(PREFIX_PATTERN)
  if (!match) return null
  const id = match[1].toLowerCase() as ConventionalPrefix['id']
  return `${id}:`
}

/**
 * Applies, replaces, or toggles off a conventional comment prefix at the start of `body`.
 */
export function applyConventionalPrefix(
  body: string,
  prefixLabel: ConventionalPrefix['label'],
): string {
  const match = body.match(PREFIX_PATTERN)
  if (match) {
    const rest = body.slice(match[0].length)
    const currentLabel = `${match[1].toLowerCase()}:`
    if (currentLabel === prefixLabel) {
      return rest
    }
    return rest ? `${prefixLabel} ${rest}` : `${prefixLabel} `
  }

  const trimmedStart = body.trimStart()
  return trimmedStart ? `${prefixLabel} ${trimmedStart}` : `${prefixLabel} `
}

/**
 * Inserts `snippetBody` at the given selection range (or end of `body` if omitted),
 * returning the updated text and the new caret offset.
 */
export function insertSnippetAtCursor(
  body: string,
  snippetBody: string,
  selectionStart?: number,
  selectionEnd?: number,
): { text: string; cursor: number } {
  const start =
    typeof selectionStart === 'number' && selectionStart >= 0 && selectionStart <= body.length
      ? selectionStart
      : body.length
  const end =
    typeof selectionEnd === 'number' && selectionEnd >= start && selectionEnd <= body.length
      ? selectionEnd
      : start

  const before = body.slice(0, start)
  const after = body.slice(end)
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
  const inserted = needsLeadingSpace ? ` ${snippetBody}` : snippetBody

  const text = `${before}${inserted}${after}`
  const cursor = before.length + inserted.length
  return { text, cursor }
}

/**
 * Derives a compact default chip name from a comment body.
 */
export function deriveSnippetName(body: string): string {
  const firstLine =
    body
      .split('\n')
      .map((line) => line.replace(/[#*`]/g, '').trim())
      .find((line) => line.length > 0) ?? ''

  if (!firstLine) return 'Custom snippet'
  return firstLine.length > 26 ? `${firstLine.slice(0, 23)}…` : firstLine
}

const snippets = ref<CommentSnippet[]>([])
let loaded = false
let loadPromise: Promise<void> | null = null

/**
 * Reactive store composable for user-defined comment snippets persisted via `storage.ts`.
 */
export function useCommentSnippets() {
  async function ensureLoaded(): Promise<void> {
    if (loaded) return
    if (!loadPromise) {
      loadPromise = loadCommentSnippets()
        .then((items) => {
          snippets.value = items
          loaded = true
        })
        .finally(() => {
          loadPromise = null
        })
    }
    await loadPromise
  }

  async function addSnippet(name: string, body: string): Promise<CommentSnippet | null> {
    const trimmedBody = body.trim()
    if (!trimmedBody) return null
    await ensureLoaded()
    const trimmedName = name.trim() || deriveSnippetName(trimmedBody)
    const entry: CommentSnippet = {
      id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedName,
      body: trimmedBody,
    }
    const next = [...snippets.value, entry]
    snippets.value = next
    await saveCommentSnippets(next)
    return entry
  }

  async function removeSnippet(id: string): Promise<void> {
    await ensureLoaded()
    const next = snippets.value.filter((s) => s.id !== id)
    snippets.value = next
    await saveCommentSnippets(next)
  }

  return {
    snippets,
    ensureLoaded,
    addSnippet,
    removeSnippet,
  }
}

/** Resets module-level snippet cache (for unit tests only). */
export function _resetCommentSnippetsForTests(): void {
  snippets.value = []
  loaded = false
  loadPromise = null
}
