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

  it('flags isSwitchingFilter only while a filter change is re-fetching', async () => {
    mockLoadGitHubPat.mockResolvedValue('ghp_saved_token')
    const auth = useAuthStore()
    await auth.init()
    expect(auth.isSwitchingFilter).toBe(false)

    let resolveFetch: (value: unknown) => void = () => {}
    mockFetchViewerAndRequestedPRs.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const pending = auth.setPrFilter('authored')
    expect(auth.isSwitchingFilter).toBe(true)

    resolveFetch({
      viewer: { login: 'octocat', avatarUrl: 'https://example.com/a.png', name: 'Octo' },
      requestedPRs: [],
      hasNextPage: false,
      endCursor: null,
    })
    await pending
    expect(auth.isSwitchingFilter).toBe(false)

    // A plain refresh (e.g. auto-refresh) must not trigger the switching state.
    const refresh = auth.refreshRequestedPRs()
    expect(auth.isSwitchingFilter).toBe(false)
    await refresh
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
})
