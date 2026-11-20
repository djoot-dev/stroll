import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import { computeFileFingerprint, loadViewedFiles } from '@/services/storage'
import type { PRHeadPulse } from '@/services/github'
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

const setFileViewedStateMock = vi.fn<
  (pat: string, pullRequestId: string, path: string, viewed: boolean) => Promise<'VIEWED' | 'UNVIEWED'>
>(async (_pat, _prId, _path, viewed) => (viewed ? 'VIEWED' : 'UNVIEWED'))

const createPendingReviewMock = vi.fn(async () => 'review_1')
const submitReviewMock = vi.fn(async () => undefined)
const addReviewThreadMock = vi.fn(async () => 'thread_line')
const addFileReviewThreadMock = vi.fn(async () => 'thread_file')
const fetchPRHeadPulseMock = vi.fn<() => Promise<PRHeadPulse | null>>()

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
    setFileViewedState: (
      pat: string,
      pullRequestId: string,
      path: string,
      viewed: boolean,
    ) => setFileViewedStateMock(pat, pullRequestId, path, viewed),
    createPendingReview: (...args: unknown[]) => createPendingReviewMock(...(args as [])),
    submitReview: (...args: unknown[]) => submitReviewMock(...(args as [])),
    addReviewThread: (...args: unknown[]) => addReviewThreadMock(...(args as [])),
    addFileReviewThread: (...args: unknown[]) => addFileReviewThreadMock(...(args as [])),
    fetchPRHeadPulse: () => fetchPRHeadPulseMock(),
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

  it('hydrates viewed state from GitHub viewerViewedState and syncs/reverts toggles', async () => {
    const pr = makePR({ owner: 'acme', repo: 'stroll', number: 12 })
    pr.files[0].viewerViewedState = 'VIEWED'
    pr.files[1].viewerViewedState = 'UNVIEWED'
    fetchPullRequestMock.mockResolvedValueOnce(pr)
    setFileViewedStateMock.mockClear()

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const store = useReviewStore()
    await store.loadPRByRepo('acme', 'stroll', 12)

    expect(store.isStepReviewed(pr.files[0].path)).toBe(true)
    expect(store.isStepReviewed(pr.files[1].path)).toBe(false)

    await store.toggleReviewed(pr.files[1].path)
    expect(setFileViewedStateMock).toHaveBeenCalledWith(
      'ghp_test_token',
      pr.id,
      pr.files[1].path,
      true,
    )
    expect(store.isStepReviewed(pr.files[1].path)).toBe(true)

    setFileViewedStateMock.mockRejectedValueOnce(new Error('Network failed'))
    await store.toggleReviewed(pr.files[1].path)
    expect(store.isStepReviewed(pr.files[1].path)).toBe(true)
    expect(store.refreshError).toContain('Network failed')
  })
})

describe('useReviewStore refreshCurrentPR and PR overview comments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
    fetchPullRequestMock.mockReset()
  })

  it('refreshes the active PR while preserving current file, drafts, and valid viewed state', async () => {
    const initialPR = makePR({
      owner: 'acme',
      repo: 'stroll',
      number: 99,
    })
    fetchPullRequestMock.mockResolvedValueOnce(initialPR)

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const store = useReviewStore()
    await store.loadPRByRepo('acme', 'stroll', 99)

    // Navigate to the 3rd step in the tour so we can verify step-path preservation
    const targetStep = store.tourSteps[2]
    store.goToStep(2)
    expect(store.activeView).toBe('step')
    expect(store.currentStep?.file.path).toBe(targetStep.file.path)

    // Mark two files as viewed: one will remain unchanged, one will change on refresh
    const unchangedPath = store.tourSteps[0].file.path
    const changedPath = store.tourSteps[1].file.path
    await store.toggleReviewed(unchangedPath)
    await store.toggleReviewed(changedPath)

    // Add a local draft comment
    await store.addDraftComment(targetStep.file.path, 10, 'RIGHT', 'Check edge case here')
    expect(store.draftComments).toHaveLength(1)

    // Build refreshed PR where a new config file is added (shifting indices!),
    // changedPath has an updated patch, and a new issue comment arrived
    const updatedFiles = initialPR.files.map((f) => {
      const cloned = structuredClone(f)
      if (cloned.path === changedPath) {
        cloned.patch = `${cloned.patch}\n+// refreshed change`
        cloned.headContent = `${cloned.headContent ?? ''}\n// refreshed change`
      }
      return cloned
    })
    updatedFiles.push({
      path: 'package.json',
      status: 'modified',
      additions: 1,
      deletions: 0,
      language: 'json',
      baseContent: '{}',
      headContent: '{"name":"updated"}',
      patch: '@@ -1 +1 @@\n-{}\n+{"name":"updated"}',
    })

    const refreshedPR = makePR({
      owner: 'acme',
      repo: 'stroll',
      number: 99,
      files: updatedFiles,
      issueComments: [
        ...initialPR.issueComments,
        {
          id: 'ic_new',
          author: { login: 'reviewer', avatarUrl: '' },
          body: 'Pushed a follow-up commit.',
          createdAt: '2026-11-19T10:00:00Z',
        },
      ],
    })
    fetchPullRequestMock.mockResolvedValueOnce(refreshedPR)

    const ok = await store.refreshCurrentPR()
    expect(ok).toBe(true)
    expect(store.isRefreshingPR).toBe(false)

    // Active file path and view mode preserved even though a new config file shifted step indices
    expect(store.activeView).toBe('step')
    expect(store.currentStep?.file.path).toBe(targetStep.file.path)

    // Local draft comments preserved
    expect(store.draftComments).toHaveLength(1)
    expect(store.draftComments[0].body).toBe('Check edge case here')

    // Valid viewed fingerprint preserved, changed file unmarked
    expect(store.isStepReviewed(unchangedPath)).toBe(true)
    expect(store.isStepReviewed(changedPath)).toBe(false)
    expect(store.reviewedCount).toBe(1)

    // Refreshed PR metadata/comments applied
    expect(store.pr?.issueComments.some((c) => c.id === 'ic_new')).toBe(true)
  })

  it('handles refreshCurrentPR gracefully in Demo PR mode', async () => {
    const store = useReviewStore()
    await store.loadMockPR()
    store.goToStep(1)
    await store.addDraftComment(store.tourSteps[1].file.path, 5, 'RIGHT', 'Demo draft')

    const ok = await store.refreshCurrentPR()
    expect(ok).toBe(true)
    expect(fetchPullRequestMock).not.toHaveBeenCalled()
    expect(store.currentStepIndex).toBe(1)
    expect(store.draftComments).toHaveLength(1)
  })

  it('posts a general PR comment locally in Demo PR mode', async () => {
    const store = useReviewStore()
    await store.loadMockPR()

    const initialCount = store.pr?.issueComments.length ?? 0

    // Blank comments are ignored
    expect(await store.postPRComment('   ')).toBeNull()
    expect(store.pr?.issueComments.length).toBe(initialCount)

    const created = await store.postPRComment('Looks great overall, checking the tests next!')
    expect(created).not.toBeNull()
    expect(created?.body).toBe('Looks great overall, checking the tests next!')
    expect(created?.author.login).toBe('you (demo)')
    expect(store.pr?.issueComments.length).toBe(initialCount + 1)
    expect(store.pr?.issueComments[initialCount].body).toBe(
      'Looks great overall, checking the tests next!',
    )
  })

  it('toggles between Overview and Step view without losing currentStepIndex', async () => {
    const store = useReviewStore()
    await store.loadMockPR()

    expect(store.activeView).toBe('overview')
    store.goToStep(3)
    expect(store.activeView).toBe('step')
    expect(store.currentStepIndex).toBe(3)

    store.toggleOverview()
    expect(store.activeView).toBe('overview')
    expect(store.currentStepIndex).toBe(3)

    store.toggleOverview()
    expect(store.activeView).toBe('step')
    expect(store.currentStepIndex).toBe(3)
  })

  it('tracks isLoadingPR and loadingPRKey while opening a PR and prevents concurrent loads', async () => {
    let resolveFetch!: (value: PullRequestData) => void
    fetchPullRequestMock.mockImplementationOnce(
      () =>
        new Promise<PullRequestData>((resolve) => {
          resolveFetch = resolve
        }),
    )

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const store = useReviewStore()
    const pending = store.loadPRByRepo('acme', 'stroll', 77)

    expect(store.isLoadingPR).toBe(true)
    expect(store.loadingPRKey).toBe('acme/stroll#77')

    // Concurrent load is ignored while one is already in progress
    const concurrentResult = await store.loadPRByRepo('acme', 'other', 88)
    expect(concurrentResult).toBe(false)
    expect(fetchPullRequestMock).toHaveBeenCalledTimes(1)
    expect(store.loadingPRKey).toBe('acme/stroll#77')

    resolveFetch(makePR({ owner: 'acme', repo: 'stroll', number: 77 }))
    const ok = await pending

    expect(ok).toBe(true)
    expect(store.isLoadingPR).toBe(false)
    expect(store.loadingPRKey).toBeNull()
  })

  it('clears isLoadingPR and loadingPRKey when loading a PR fails', async () => {
    fetchPullRequestMock.mockRejectedValueOnce(new Error('Network timeout'))

    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const store = useReviewStore()
    const ok = await store.loadPRByRepo('acme', 'stroll', 999)

    expect(ok).toBe(false)
    expect(store.isLoadingPR).toBe(false)
    expect(store.loadingPRKey).toBeNull()
    expect(store.prError).toBe('Network timeout')
  })
})

describe('useReviewStore per-file commits', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
    fetchPullRequestMock.mockReset()
  })

  it('resolves commits with full messages for the current and upcoming files in Demo PR mode', async () => {
    const store = useReviewStore()
    await store.loadMockPR()
    await store.ensureFileCommitsForStep(0)

    for (const step of store.tourSteps) {
      expect(store.fileCommits[step.file.path]).toBeDefined()
    }
    const typesCommits = store.fileCommits['src/types/webhook.ts']
    expect(typesCommits.map((c) => c.oid)).toEqual(['e4f5a6b', 'c111111'])
    expect(typesCommits[0].messageHeadline).toContain('EndpointRateLimiter')
    expect(typesCommits[0].messageBody).toContain('exponential backoff')
    expect(typesCommits[0].isMerge).toBe(false)
  })
})

describe('useReviewStore file-level comments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
    fetchPullRequestMock.mockReset()
    createPendingReviewMock.mockClear()
    submitReviewMock.mockClear()
    addReviewThreadMock.mockClear()
    addFileReviewThreadMock.mockClear()
  })

  it('queues a file-level draft and turns it into a FILE thread in Demo PR mode', async () => {
    const store = useReviewStore()
    await store.loadMockPR()
    const path = store.tourSteps[0].file.path

    await store.addFileDraftComment(path, '   ')
    expect(store.draftComments).toHaveLength(0)

    await store.addFileDraftComment(path, '  Consider splitting this file.  ')
    expect(store.draftComments).toHaveLength(1)
    expect(store.draftComments[0]).toMatchObject({
      path,
      subjectType: 'FILE',
      line: 0,
      body: 'Consider splitting this file.',
    })

    const ok = await store.submitCompleteReview('COMMENT', '')
    expect(ok).toBe(true)
    const created = store.pr?.threads.find(
      (t) => t.path === path && t.subjectType === 'FILE',
    )
    expect(created?.comments[0].body).toBe('Consider splitting this file.')
  })

  it('submits file-level drafts via addFileReviewThread and line drafts via addReviewThread', async () => {
    fetchPullRequestMock.mockResolvedValueOnce(
      makePR({ owner: 'acme', repo: 'stroll', number: 7, pendingReviewId: null }),
    )
    const auth = useAuthStore()
    auth.pat = 'ghp_test_token'

    const store = useReviewStore()
    await store.loadPRByRepo('acme', 'stroll', 7)
    const path = store.tourSteps[0].file.path

    await store.addFileDraftComment(path, 'File-wide note')
    await store.addDraftComment(path, 3, 'RIGHT', 'Line note')

    const ok = await store.submitCompleteReview('COMMENT', 'summary')
    expect(ok).toBe(true)
    expect(addFileReviewThreadMock).toHaveBeenCalledTimes(1)
    expect(addFileReviewThreadMock).toHaveBeenCalledWith(
      'ghp_test_token',
      store.pr?.id,
      'review_1',
      path,
      'File-wide note',
    )
    expect(addReviewThreadMock).toHaveBeenCalledTimes(1)
    expect(store.draftComments).toHaveLength(0)
  })
})

describe('useReviewStore remote update banner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
    fetchPullRequestMock.mockReset()
    fetchPRHeadPulseMock.mockReset()
  })

  async function loadLivePR() {
    const pr = makePR({ owner: 'acme', repo: 'stroll', number: 5 })
    fetchPullRequestMock.mockResolvedValueOnce(pr)
    useAuthStore().pat = 'ghp_test_token'
    const store = useReviewStore()
    await store.loadPRByRepo('acme', 'stroll', 5)
    return { store, pr }
  }

  function pulseFor(pr: PullRequestData, overrides: Partial<PRHeadPulse> = {}): PRHeadPulse {
    return {
      headRefOid: pr.headRefOid,
      updatedAt: pr.updatedAt,
      // Remote totals exceed the loaded (filtered/capped) lists, e.g. outdated threads
      commentCount: pr.issueComments.length + 60,
      threadCount: pr.threads.length + 3,
      ...overrides,
    }
  }

  it('does not show the banner when remote totals exceed loaded lists but nothing changed', async () => {
    const { store, pr } = await loadLivePR()
    fetchPRHeadPulseMock.mockResolvedValue(pulseFor(pr))

    await store.checkForRemotePRUpdates()
    await store.checkForRemotePRUpdates()

    expect(store.prHasRemoteUpdates).toBe(false)
  })

  it('shows the banner for new commits', async () => {
    const { store, pr } = await loadLivePR()
    fetchPRHeadPulseMock.mockResolvedValue(pulseFor(pr, { headRefOid: 'newsha' }))

    await store.checkForRemotePRUpdates()

    expect(store.prHasRemoteUpdates).toBe(true)
    expect(store.remoteUpdateSummary).toMatch(/New commits/)
  })

  it('shows the banner when a comment arrives after the first poll', async () => {
    const { store, pr } = await loadLivePR()
    const base = pulseFor(pr)
    fetchPRHeadPulseMock.mockResolvedValueOnce(base)
    await store.checkForRemotePRUpdates()
    expect(store.prHasRemoteUpdates).toBe(false)

    fetchPRHeadPulseMock.mockResolvedValueOnce({ ...base, commentCount: base.commentCount + 1 })
    await store.checkForRemotePRUpdates()

    expect(store.prHasRemoteUpdates).toBe(true)
    expect(store.remoteUpdateSummary).toMatch(/comments or activity/)
  })

  it('keeps the banner dismissed until something new happens', async () => {
    const { store, pr } = await loadLivePR()
    const later = new Date(Date.parse(pr.updatedAt) + 60_000).toISOString()
    const changed = pulseFor(pr, { updatedAt: later })
    fetchPRHeadPulseMock.mockResolvedValue(changed)

    await store.checkForRemotePRUpdates()
    expect(store.prHasRemoteUpdates).toBe(true)

    store.dismissRemoteUpdates()
    await store.checkForRemotePRUpdates()
    expect(store.prHasRemoteUpdates).toBe(false)

    fetchPRHeadPulseMock.mockResolvedValue({ ...changed, threadCount: changed.threadCount + 1 })
    await store.checkForRemotePRUpdates()
    expect(store.prHasRemoteUpdates).toBe(true)
  })
})
