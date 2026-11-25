import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadGitHubPat = vi.fn<() => Promise<string>>()
const mockSaveGitHubPat = vi.fn<(pat: string) => Promise<void>>()
const mockFetchViewerAndRequestedPRs = vi.fn()

vi.mock('@/services/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/storage')>()
  return {
    ...actual,
    loadGitHubPat: () => mockLoadGitHubPat(),
    saveGitHubPat: (pat: string) => mockSaveGitHubPat(pat),
  }
})

vi.mock('@/services/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/github')>()
  return {
    ...actual,
    fetchViewerAndRequestedPRs: (...args: unknown[]) => mockFetchViewerAndRequestedPRs(...args),
  }
})

import { useAuthStore } from '../auth'

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

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
    mockLoadGitHubPat.mockReset()
    mockSaveGitHubPat.mockReset().mockResolvedValue(undefined)
    mockFetchViewerAndRequestedPRs.mockReset().mockResolvedValue({
      viewer: { login: 'octocat', avatarUrl: 'https://example.com/a.png', name: 'Octo' },
      requestedPRs: [],
      hasNextPage: false,
      endCursor: null,
    })
  })

  it('does not re-save PAT on init or refresh when already loaded from storage', async () => {
    mockLoadGitHubPat.mockResolvedValue('ghp_saved_token')
    const auth = useAuthStore()

    await auth.init()
    expect(auth.isAuthenticated).toBe(true)
    expect(mockLoadGitHubPat).toHaveBeenCalledTimes(1)
    expect(mockSaveGitHubPat).not.toHaveBeenCalled()

    await auth.refreshRequestedPRs()
    await auth.setPrFilter('authored')
    expect(mockSaveGitHubPat).not.toHaveBeenCalled()
  })

  it('flags isReloadingList for filter switches and visible refreshes only', async () => {
    mockLoadGitHubPat.mockResolvedValue('ghp_saved_token')
    const auth = useAuthStore()
    await auth.init()
    expect(auth.isReloadingList).toBe(false)

    let resolveFetch: (value: unknown) => void = () => {}
    mockFetchViewerAndRequestedPRs.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const pending = auth.setPrFilter('authored')
    expect(auth.isReloadingList).toBe(true)

    resolveFetch({
      viewer: { login: 'octocat', avatarUrl: 'https://example.com/a.png', name: 'Octo' },
      requestedPRs: [],
      hasNextPage: false,
      endCursor: null,
    })
    await pending
    expect(auth.isReloadingList).toBe(false)

    // A manual (visible) refresh uses the same loading state.
    const visible = auth.refreshRequestedPRs({ showLoading: true })
    expect(auth.isReloadingList).toBe(true)
    await visible
    expect(auth.isReloadingList).toBe(false)

    // A background refresh (e.g. auto-refresh) must stay silent.
    const background = auth.refreshRequestedPRs({ notifyOnNew: true })
    expect(auth.isReloadingList).toBe(false)
    await background
  })

  it('persists new PAT once and skips redundant saves for the same token', async () => {
    const auth = useAuthStore()

    await auth.verifyAndLoadProfile('ghp_new_token')
    expect(mockSaveGitHubPat).toHaveBeenCalledTimes(1)
    expect(mockSaveGitHubPat).toHaveBeenCalledWith('ghp_new_token')

    await auth.verifyAndLoadProfile('ghp_new_token')
    expect(mockSaveGitHubPat).toHaveBeenCalledTimes(1)

    await auth.clearPat()
    expect(mockSaveGitHubPat).toHaveBeenCalledTimes(2)
    expect(mockSaveGitHubPat).toHaveBeenLastCalledWith('')

    await auth.verifyAndLoadProfile('ghp_new_token')
    expect(mockSaveGitHubPat).toHaveBeenCalledTimes(3)
    expect(mockSaveGitHubPat).toHaveBeenLastCalledWith('ghp_new_token')
  })

  it('reports live initStatus while validating a saved GitHub session', async () => {
    mockLoadGitHubPat.mockResolvedValue('ghp_saved_token')
    let resolveFetch: (value: unknown) => void = () => {}
    mockFetchViewerAndRequestedPRs.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const auth = useAuthStore()
    const pending = auth.init()

    await vi.waitFor(() => {
      expect(auth.initStatus).toBe('Validating GitHub session & loading PR inbox…')
    })

    resolveFetch({
      viewer: { login: 'octocat', avatarUrl: 'https://example.com/a.png', name: 'Octo' },
      requestedPRs: [],
      hasNextPage: false,
      endCursor: null,
    })
    await pending
    expect(auth.isAuthenticated).toBe(true)
  })

  it('preserves PR inbox and session when refresh fails due to being offline, and recovers when online', async () => {
    const initialPR = {
      id: 'pr-1',
      owner: 'acme',
      repo: 'stroll',
      number: 12,
      title: 'Keep inbox visible offline',
      url: 'https://github.com/acme/stroll/pull/12',
      author: { login: 'octocat', avatarUrl: '' },
      updatedAt: '2026-11-24T12:00:00Z',
      additions: 5,
      deletions: 2,
      changedFiles: 1,
      isDraft: false,
      reviewDecision: null,
      ciState: 'SUCCESS' as const,
      totalCommentsCount: 0,
      baseRefName: 'main',
      headRefName: 'fix/offline',
      isCrossRepository: false,
    }
    mockLoadGitHubPat.mockResolvedValue('ghp_saved_token')
    mockFetchViewerAndRequestedPRs.mockResolvedValueOnce({
      viewer: { login: 'octocat', avatarUrl: 'https://example.com/a.png', name: 'Octo' },
      requestedPRs: [initialPR],
      hasNextPage: true,
      endCursor: 'cursor-1',
    })

    const auth = useAuthStore()
    await auth.init()
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.requestedPRs).toHaveLength(1)

    // Lose internet connection on next refresh
    mockFetchViewerAndRequestedPRs.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const ok = await auth.refreshRequestedPRs()

    expect(ok).toBe(false)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.viewer?.login).toBe('octocat')
    expect(auth.requestedPRs).toEqual([initialPR])
    expect(auth.hasMorePRs).toBe(true)
    expect(auth.isOffline).toBe(true)
    expect(auth.error).toBe('No internet connection — unable to reach GitHub.')

    // Switching filter while offline keeps current PRs and reverts filter
    mockFetchViewerAndRequestedPRs.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await auth.setPrFilter('authored')
    expect(auth.prFilter).toBe('review-requested')
    expect(auth.requestedPRs).toEqual([initialPR])

    // Recover when connection returns
    mockFetchViewerAndRequestedPRs.mockResolvedValueOnce({
      viewer: { login: 'octocat', avatarUrl: 'https://example.com/a.png', name: 'Octo' },
      requestedPRs: [initialPR],
      hasNextPage: false,
      endCursor: null,
    })
    const recovered = await auth.refreshRequestedPRs()
    expect(recovered).toBe(true)
    expect(auth.isOffline).toBe(false)
    expect(auth.error).toBeNull()
  })

  it('clears session and inbox when GitHub rejects credentials with 401', async () => {
    mockLoadGitHubPat.mockResolvedValue('ghp_saved_token')
    mockFetchViewerAndRequestedPRs.mockResolvedValueOnce({
      viewer: { login: 'octocat', avatarUrl: 'https://example.com/a.png', name: 'Octo' },
      requestedPRs: [
        {
          id: 'pr-1',
          owner: 'acme',
          repo: 'stroll',
          number: 12,
          title: 'Test PR',
          url: 'https://github.com/acme/stroll/pull/12',
          author: { login: 'octocat', avatarUrl: '' },
          updatedAt: '2026-11-24T12:00:00Z',
          additions: 5,
          deletions: 2,
          changedFiles: 1,
          isDraft: false,
          reviewDecision: null,
          ciState: null,
          totalCommentsCount: 0,
          baseRefName: 'main',
          headRefName: 'fix/auth',
          isCrossRepository: false,
        },
      ],
      hasNextPage: false,
      endCursor: null,
    })

    const auth = useAuthStore()
    await auth.init()
    expect(auth.isAuthenticated).toBe(true)

    mockFetchViewerAndRequestedPRs.mockRejectedValueOnce(
      new Error('GitHub GraphQL error (401): {"message":"Bad credentials"}'),
    )
    const ok = await auth.refreshRequestedPRs()
    expect(ok).toBe(false)
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.viewer).toBeNull()
    expect(auth.requestedPRs).toEqual([])
    expect(auth.isOffline).toBe(false)
  })
})
