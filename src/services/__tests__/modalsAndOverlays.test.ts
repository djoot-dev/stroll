import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExternalEditorUrl } from '@/services/native'
import {
  clearReviewCache,
  loadDraftComments,
  loadReviewSummaryDraft,
  loadReviewTemplates,
  loadViewedFiles,
  saveDraftComments,
  saveReviewSummaryDraft,
  saveReviewTemplates,
  saveViewedFiles,
} from '@/services/storage'

function createMemoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
  }
}

describe('buildExternalEditorUrl', () => {
  it('builds vscode, cursor, and zed URIs with encoded path and clamped line', () => {
    expect(
      buildExternalEditorUrl('vscode', '', '/Users/dev/repo/', '/src/my file.ts', 42),
    ).toBe('vscode://file/Users/dev/repo/src/my%20file.ts:42')

    expect(
      buildExternalEditorUrl('cursor', '', '/Users/dev/repo', 'src/app.ts', 0),
    ).toBe('cursor://file/Users/dev/repo/src/app.ts:1')

    expect(
      buildExternalEditorUrl('zed', '', '/Users/dev/repo', 'src/app.ts', 17.8),
    ).toBe('zed://file/Users/dev/repo/src/app.ts:17')
  })

  it('substitutes {file} and {line} for custom templates and returns null when empty', () => {
    expect(
      buildExternalEditorUrl(
        'custom',
        'idea://open?file={file}&line={line}',
        '/repo',
        'src/Main.java',
        88,
      ),
    ).toBe('idea://open?file=/repo/src/Main.java&line=88')

    expect(buildExternalEditorUrl('custom', '   ', '/repo', 'src/Main.java', 1)).toBeNull()
  })
})

describe('review summary draft, templates, and cache clearing', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  it('persists and clears review summary drafts per PR', async () => {
    await saveReviewSummaryDraft('acme/stroll#1', { body: 'Looks solid', event: 'APPROVE' })
    await saveReviewSummaryDraft('acme/stroll#2', { body: 'Needs work', event: 'REQUEST_CHANGES' })

    expect(await loadReviewSummaryDraft('acme/stroll#1')).toEqual({
      body: 'Looks solid',
      event: 'APPROVE',
    })
    expect(await loadReviewSummaryDraft('acme/stroll#2')).toEqual({
      body: 'Needs work',
      event: 'REQUEST_CHANGES',
    })

    await saveReviewSummaryDraft('acme/stroll#1', null)
    expect(await loadReviewSummaryDraft('acme/stroll#1')).toBeNull()
    expect(await loadReviewSummaryDraft('acme/stroll#2')).toEqual({
      body: 'Needs work',
      event: 'REQUEST_CHANGES',
    })
  })

  it('persists custom review templates', async () => {
    expect(await loadReviewTemplates()).toEqual([])
    const templates = [{ id: 'tpl-1', name: 'Ship it', body: 'Ship it!' }]
    await saveReviewTemplates(templates)
    expect(await loadReviewTemplates()).toEqual(templates)
  })

  it('clears cached drafts, viewed files, and summary drafts without touching PAT or settings', async () => {
    localStorage.setItem('stroll_github_pat', JSON.stringify('ghp_secret'))
    await saveDraftComments('acme/stroll#1', [
      {
        id: 'd1',
        prKey: 'acme/stroll#1',
        path: 'src/a.ts',
        line: 5,
        side: 'RIGHT',
        body: 'nit',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ])
    await saveViewedFiles('acme/stroll#1', { 'src/a.ts': 'fp1' })
    await saveReviewSummaryDraft('acme/stroll#1', { body: 'Draft', event: 'COMMENT' })

    await clearReviewCache()

    expect(await loadDraftComments('acme/stroll#1')).toEqual([])
    expect(await loadViewedFiles('acme/stroll#1')).toEqual({})
    expect(await loadReviewSummaryDraft('acme/stroll#1')).toBeNull()
    expect(localStorage.getItem('stroll_github_pat')).toBe(JSON.stringify('ghp_secret'))
  })
})
