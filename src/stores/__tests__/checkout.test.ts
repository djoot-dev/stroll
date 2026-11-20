import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { describeLocalCheckout, localBranchForPR, type CheckoutTarget } from '@/services/localCheckout'
import type { GitCheckoutPRRequest, GitCheckoutPRResult, LocalRepoStatus } from '@/services/native'
import { describeCheckoutResult, useCheckoutStore } from '../checkout'
import { useReviewStore } from '../review'

const gitLocalStatusMock = vi.fn<(repoPath: string) => Promise<LocalRepoStatus | null>>()
const gitCheckoutPRMock = vi.fn<(req: GitCheckoutPRRequest) => Promise<GitCheckoutPRResult>>()

vi.mock('@/services/native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/native')>()
  return {
    ...actual,
    isTauriRuntime: () => true,
    gitLocalStatus: (repoPath: string) => gitLocalStatusMock(repoPath),
    gitCheckoutPR: (req: GitCheckoutPRRequest) => gitCheckoutPRMock(req),
  }
})

const TARGET: CheckoutTarget = {
  owner: 'acme',
  repo: 'widgets',
  number: 42,
  headRefName: 'feat/x',
  isCrossRepository: false,
  headRefOid: 'aaaaaaa1111',
}

describe('localCheckout service', () => {
  it('uses pr/<n> for fork PRs', () => {
    expect(localBranchForPR(TARGET)).toBe('feat/x')
    expect(localBranchForPR({ ...TARGET, isCrossRepository: true })).toBe('pr/42')
  })

  it('describes where the checkout is relative to the PR', () => {
    const base: LocalRepoStatus = { branch: 'feat/x', headOid: 'aaaaaaa1111', dirtyFiles: [] }
    expect(describeLocalCheckout(base, TARGET)).toEqual({ kind: 'on-pr', branch: 'feat/x' })
    expect(describeLocalCheckout({ ...base, headOid: 'bbbb' }, TARGET)).toEqual({
      kind: 'on-pr-stale',
      branch: 'feat/x',
    })
    expect(describeLocalCheckout({ ...base, branch: 'main' }, TARGET)).toEqual({
      kind: 'elsewhere',
      branch: 'main',
    })
    expect(describeLocalCheckout({ ...base, branch: null }, TARGET)).toEqual({
      kind: 'elsewhere',
      branch: null,
    })
    // Unknown PR head → being on the branch is good enough.
    expect(describeLocalCheckout({ ...base, headOid: 'bbbb' }, { ...TARGET, headRefOid: null }).kind).toBe('on-pr')
  })

  it('summarises checkout results', () => {
    const res = { branch: 'feat/x', headOid: 'abcdef123', created: true, fastForwarded: false, localAhead: false }
    expect(describeCheckoutResult(res)).toBe('Checked out feat/x @ abcdef1')
    expect(describeCheckoutResult({ ...res, fastForwarded: true })).toMatch(/^Updated/)
    expect(describeCheckoutResult({ ...res, localAhead: true })).toMatch(/commits not in the PR/)
  })
})

describe('checkout store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    gitLocalStatusMock.mockReset()
    gitCheckoutPRMock.mockReset()
    useReviewStore().repoPaths = { 'acme/widgets': '/src/widgets' }
  })

  it('is gated on a linked checkout', async () => {
    const store = useCheckoutStore()
    expect(store.isLinked('acme', 'widgets')).toBe(true)
    expect(store.isLinked('acme', 'other')).toBe(false)

    expect(await store.checkout({ ...TARGET, repo: 'other' })).toBeNull()
    expect(gitCheckoutPRMock).not.toHaveBeenCalled()
  })

  it('refreshes each linked repo once', async () => {
    gitLocalStatusMock.mockResolvedValue({ branch: 'main', headOid: 'x', dirtyFiles: [] })
    const store = useCheckoutStore()
    await store.refreshStatuses([
      { owner: 'acme', repo: 'widgets' },
      { owner: 'acme', repo: 'widgets' },
      { owner: 'acme', repo: 'unlinked' },
    ])
    expect(gitLocalStatusMock).toHaveBeenCalledTimes(1)
    expect(gitLocalStatusMock).toHaveBeenCalledWith('/src/widgets')
    expect(store.stateFor(TARGET)).toEqual({ kind: 'elsewhere', branch: 'main' })
  })

  it('checks out and records the outcome', async () => {
    gitCheckoutPRMock.mockResolvedValue({
      branch: 'feat/x',
      headOid: 'aaaaaaa1111',
      created: true,
      fastForwarded: false,
      localAhead: false,
    })
    gitLocalStatusMock.mockResolvedValue({ branch: 'feat/x', headOid: 'aaaaaaa1111', dirtyFiles: [] })

    const store = useCheckoutStore()
    const result = await store.checkout(TARGET)

    expect(result?.branch).toBe('feat/x')
    expect(gitCheckoutPRMock).toHaveBeenCalledWith({
      repoPath: '/src/widgets',
      expectedOwnerRepo: 'acme/widgets',
      number: 42,
      headRefName: 'feat/x',
      isCrossRepository: false,
    })
    expect(store.messageByPR['acme/widgets#42']).toBe('Checked out feat/x @ aaaaaaa')
    expect(store.stateFor(TARGET)?.kind).toBe('on-pr')
    expect(store.busyKey).toBeNull()
  })

  it('surfaces git errors such as uncommitted changes', async () => {
    gitCheckoutPRMock.mockRejectedValue(new Error('The linked checkout has uncommitted changes.'))
    gitLocalStatusMock.mockResolvedValue({ branch: 'main', headOid: 'x', dirtyFiles: ['a.ts'] })

    const store = useCheckoutStore()
    expect(await store.checkout(TARGET)).toBeNull()
    expect(store.errorByPR['acme/widgets#42']).toMatch(/uncommitted changes/)

    store.dismiss(TARGET)
    expect(store.errorByPR['acme/widgets#42']).toBeUndefined()
  })
})
