import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  checkoutKey,
  describeLocalCheckout,
  shortOid,
  type CheckoutTarget,
  type LocalCheckoutState,
} from '@/services/localCheckout'
import {
  gitCheckoutPR,
  gitLocalStatus,
  isTauriRuntime,
  type GitCheckoutPRResult,
  type LocalRepoStatus,
} from '@/services/native'
import { useReviewStore } from './review'

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

export function describeCheckoutResult(result: GitCheckoutPRResult): string {
  const at = `${result.branch} @ ${shortOid(result.headOid)}`
  if (result.localAhead) return `Checked out ${at} (local branch has commits not in the PR)`
  if (result.fastForwarded) return `Updated and checked out ${at}`
  return `Checked out ${at}`
}

/**
 * Checking out a PR's head branch in its linked local checkout.
 * Only available in the desktop app, and only for repositories linked in Settings.
 */
export const useCheckoutStore = defineStore('checkout', () => {
  const review = useReviewStore()

  /** Last known status per `owner/repo`. */
  const statusByRepo = ref<Record<string, LocalRepoStatus>>({})
  const statusErrorByRepo = ref<Record<string, string>>({})
  /** `owner/repo#n` of the checkout in progress, if any. */
  const busyKey = ref<string | null>(null)
  const errorByPR = ref<Record<string, string>>({})
  const messageByPR = ref<Record<string, string>>({})

  function isAvailable(): boolean {
    return isTauriRuntime()
  }

  function repoPathFor(owner: string, repo: string): string | null {
    return review.repoPaths[`${owner}/${repo}`] ?? null
  }

  function isLinked(owner: string, repo: string): boolean {
    return repoPathFor(owner, repo) !== null
  }

  function stateFor(target: CheckoutTarget): LocalCheckoutState | null {
    const status = statusByRepo.value[`${target.owner}/${target.repo}`]
    return status ? describeLocalCheckout(status, target) : null
  }

  function statusFor(owner: string, repo: string): LocalRepoStatus | null {
    return statusByRepo.value[`${owner}/${repo}`] ?? null
  }

  async function refreshStatus(owner: string, repo: string): Promise<void> {
    const ownerRepo = `${owner}/${repo}`
    const path = repoPathFor(owner, repo)
    if (!path || !isAvailable()) return
    try {
      const status = await gitLocalStatus(path)
      if (status) {
        statusByRepo.value = { ...statusByRepo.value, [ownerRepo]: status }
      }
      const { [ownerRepo]: _cleared, ...rest } = statusErrorByRepo.value
      statusErrorByRepo.value = rest
    } catch (err) {
      const { [ownerRepo]: _stale, ...rest } = statusByRepo.value
      statusByRepo.value = rest
      statusErrorByRepo.value = {
        ...statusErrorByRepo.value,
        [ownerRepo]: errorMessage(err, 'Failed to read local checkout status'),
      }
    }
  }

  /** Refreshes each linked repository once, however many PRs it has. */
  async function refreshStatuses(targets: ReadonlyArray<Pick<CheckoutTarget, 'owner' | 'repo'>>): Promise<void> {
    const unique = new Map<string, { owner: string; repo: string }>()
    for (const t of targets) {
      if (isLinked(t.owner, t.repo)) unique.set(`${t.owner}/${t.repo}`, t)
    }
    await Promise.all([...unique.values()].map((t) => refreshStatus(t.owner, t.repo)))
  }

  async function checkout(target: CheckoutTarget): Promise<GitCheckoutPRResult | null> {
    const key = checkoutKey(target)
    const path = repoPathFor(target.owner, target.repo)
    if (!path || busyKey.value) return null

    busyKey.value = key
    const { [key]: _oldError, ...errors } = errorByPR.value
    errorByPR.value = errors
    const { [key]: _oldMessage, ...messages } = messageByPR.value
    messageByPR.value = messages

    try {
      const result = await gitCheckoutPR({
        repoPath: path,
        expectedOwnerRepo: `${target.owner}/${target.repo}`,
        number: target.number,
        headRefName: target.headRefName,
        isCrossRepository: target.isCrossRepository,
      })
      messageByPR.value = { ...messageByPR.value, [key]: describeCheckoutResult(result) }
      return result
    } catch (err) {
      errorByPR.value = {
        ...errorByPR.value,
        [key]: errorMessage(err, 'Failed to check out the PR branch'),
      }
      return null
    } finally {
      busyKey.value = null
      await refreshStatus(target.owner, target.repo)
    }
  }

  function dismiss(target: Pick<CheckoutTarget, 'owner' | 'repo' | 'number'>): void {
    const key = checkoutKey(target)
    const { [key]: _e, ...errors } = errorByPR.value
    errorByPR.value = errors
    const { [key]: _m, ...messages } = messageByPR.value
    messageByPR.value = messages
  }

  return {
    statusByRepo,
    statusErrorByRepo,
    busyKey,
    errorByPR,
    messageByPR,
    isAvailable,
    isLinked,
    repoPathFor,
    statusFor,
    stateFor,
    refreshStatus,
    refreshStatuses,
    checkout,
    dismiss,
  }
})
