import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import { computeFileFingerprint, loadViewedFiles } from '@/services/storage'
import type { PullRequestData } from '@/types/pr'
import { useAuthStore } from '../auth'
import { useReviewStore } from '../review'

const fetchPullRequestMock = vi.fn<
  (
    pat: string,
    owner: string,
    repo: string,
    number: number,
    localRepoPath?: string | null,
  ) => Promise<PullRequestData>
>()

vi.mock('@/services/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/github')>()
  return {
    ...actual,
    fetchPullRequest: (
      pat: string,
      owner: string,
      repo: string,
      number: number,
      localRepoPath?: string | null,
    ) => fetchPullRequestMock(pat, owner, repo, number, localRepoPath),
  }
})

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

function makePR(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    ...structuredClone(MOCK_PR),
    isMock: false,
    ...overrides,
  }
}

describe('useReviewStore viewed files persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
    fetchPullRequestMock.mockReset()
  })

  it('persists viewed files when leaving a PR and restores them on return', async () => {
    const store = useReviewStore()
    await store.loadMockPR()

    const firstPath = store.tourSteps[0].file.path
    const secondPath = store.tourSteps[1].file.path

    await store.toggleReviewed(firstPath)
    await store.toggleReviewed(secondPath)
    expect(store.isStepReviewed(firstPath)).toBe(true)
    expect(store.isStepReviewed(secondPath)).toBe(true)
    expect(store.reviewedCount).toBe(2)

    store.backToInbox()

    // Reload in a fresh store instance (simulating leaving & returning or restarting the app)
    setActivePinia(createPinia())
    const reloaded = useReviewStore()
    await reloaded.loadMockPR()

    expect(reloaded.isStepReviewed(firstPath)).toBe(true)
    expect(reloaded.isStepReviewed(secondPath)).toBe(true)
    expect(reloaded.reviewedCount).toBe(2)
  })

  it('persists unmarking a file and removes empty PR entries from storage', async () => {
    const store = useReviewStore()
    await store.loadMockPR()

    const path = store.tourSteps[0].file.path
    await store.toggleReviewed(path)
    expect(Object.keys(await loadViewedFiles(store.prKey))).toEqual([path])

    await store.toggleReviewed(path)
    expect(store.isStepReviewed(path)).toBe(false)
    expect(await loadViewedFiles(store.prKey)).toEqual({})
  })

  it('unmarks files that changed when returning to a PR while keeping unchanged files viewed', async () => {
    const initialPR = makePR({
      owner: 'acme',
      repo: 'stroll',
      number: 42,
    })
    fetchPullRequestMock.mockResolvedValueOnce(initialPR)

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const store = useReviewStore()
    await store.loadPRByRepo('acme', 'stroll', 42)

    const unchangedPath = initialPR.files[0].path
    const modifiedPatchPath = initialPR.files[1].path
    const modifiedShaPath = initialPR.files[2].path
    const removedPath = initialPR.files[3].path

    await store.toggleReviewed(unchangedPath)
    await store.toggleReviewed(modifiedPatchPath)
    await store.toggleReviewed(modifiedShaPath)
    await store.toggleReviewed(removedPath)
    expect(store.reviewedCount).toBe(4)

    store.backToInbox()

    // Simulate new commits pushed to the PR:
    // - file 0 is unchanged
    // - file 1 has an updated patch/headContent
    // - file 2 has a different blob sha (e.g. binary change)
    // - file 3 was reverted/removed from the PR
    const updatedPR = makePR({
      owner: 'acme',
      repo: 'stroll',
      number: 42,
      files: [
        structuredClone(initialPR.files[0]),
        {
          ...structuredClone(initialPR.files[1]),
          patch: `${initialPR.files[1].patch}\n+// new line`,
          headContent: `${initialPR.files[1].headContent ?? ''}\n// new line`,
        },
        {
          ...structuredClone(initialPR.files[2]),
          sha: 'new_blob_sha_999',
        },
        ...initialPR.files.slice(4).map((f) => structuredClone(f)),
      ],
    })
    fetchPullRequestMock.mockResolvedValueOnce(updatedPR)

    await store.loadPRByRepo('acme', 'stroll', 42)

    expect(store.isStepReviewed(unchangedPath)).toBe(true)
    expect(store.isStepReviewed(modifiedPatchPath)).toBe(false)
    expect(store.isStepReviewed(modifiedShaPath)).toBe(false)
    expect(store.isStepReviewed(removedPath)).toBe(false)
    expect(store.reviewedCount).toBe(1)

    // Verify stale entries were pruned from storage
    const saved = await loadViewedFiles('acme/stroll#42')
    expect(saved).toEqual({
      [unchangedPath]: computeFileFingerprint(updatedPR.files[0]),
    })
  })

  it('scopes viewed state per PR so other PRs are unaffected', async () => {
    const prA = makePR({ owner: 'acme', repo: 'stroll', number: 1 })
    const prB = makePR({ owner: 'acme', repo: 'stroll', number: 2 })
    fetchPullRequestMock.mockResolvedValueOnce(prA).mockResolvedValueOnce(prB)

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const store = useReviewStore()
    await store.loadPRByRepo('acme', 'stroll', 1)
    const targetPath = prA.files[0].path
    await store.toggleReviewed(targetPath)
    expect(store.isStepReviewed(targetPath)).toBe(true)

    await store.loadPRByRepo('acme', 'stroll', 2)
    expect(store.isStepReviewed(targetPath)).toBe(false)
    expect(store.reviewedCount).toBe(0)
  })
})
