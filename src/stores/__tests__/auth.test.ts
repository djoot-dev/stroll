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
})
