import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchViewerAndRequestedPRs } from '@/services/github'
import { diffNewPRs } from '@/services/inbox'
import { getGhAuthToken, isTauriRuntime, sendDesktopNotification } from '@/services/native'
import { loadGitHubPat, saveGitHubPat } from '@/services/storage'
import { useSettingsStore } from './settings'
import type { GitHubUser, PRFilterMode, PRSummary } from '@/types/pr'

export const PR_FILTER_OPTIONS: ReadonlyArray<{
  value: PRFilterMode
  label: string
  heading: string
  emptyMessage: string
}> = [
  {
    value: 'review-requested',
    label: 'Review Requested',
    heading: 'Pending Your Review',
    emptyMessage: 'Inbox zero — no PRs awaiting your review.',
  },
  {
    value: 'authored',
    label: 'My PRs',
    heading: 'Your Open Pull Requests',
    emptyMessage: 'No open pull requests authored by you.',
  },
  {
    value: 'involves',
    label: 'All Involved',
    heading: 'All Involved Pull Requests',
    emptyMessage: 'No open pull requests involving you.',
  },
]

export const useAuthStore = defineStore('auth', () => {
  const pat = ref<string>('')
  const viewer = ref<GitHubUser | null>(null)
  const requestedPRs = ref<PRSummary[]>([])
  const prFilter = ref<PRFilterMode>('review-requested')
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  let knownReviewRequestedIds: Set<string> | null = null

  const isAuthenticated = computed(() => Boolean(pat.value && viewer.value))

  async function init(): Promise<void> {
    const settings = useSettingsStore()
    await settings.init()
    const savedPat = await loadGitHubPat()
    if (savedPat) {
      pat.value = savedPat
      await verifyAndLoadProfile(savedPat)
      return
    }
    if (isTauriRuntime()) {
      const { token } = await getGhAuthToken()
      if (token) {
        await verifyAndLoadProfile(token)
      }
    }
  }

  async function signInWithGh(): Promise<boolean> {
    isLoading.value = true
    error.value = null
    const { token, error: ghError } = await getGhAuthToken()
    if (!token) {
      isLoading.value = false
      error.value = ghError ?? 'Failed to authenticate with GitHub CLI'
      return false
    }
    return verifyAndLoadProfile(token)
  }

  async function verifyAndLoadProfile(
    token: string,
    options?: { notifyOnNew?: boolean },
  ): Promise<boolean> {
    isLoading.value = true
    error.value = null
    try {
      const activeFilter = prFilter.value
      const { viewer: user, requestedPRs: prs } = await fetchViewerAndRequestedPRs(
        token,
        activeFilter,
      )
      pat.value = token
      viewer.value = user
      requestedPRs.value = prs
      await saveGitHubPat(token)

      if (activeFilter === 'review-requested') {
        const settings = useSettingsStore()
        if (
          options?.notifyOnNew &&
          settings.inboxNotificationsEnabled &&
          knownReviewRequestedIds !== null
        ) {
          const newlyArrived = diffNewPRs(knownReviewRequestedIds, prs)
          for (const pr of newlyArrived) {
            await sendDesktopNotification(
              `Review requested: ${pr.owner}/${pr.repo}#${pr.number}`,
              pr.title,
            )
          }
        }
        knownReviewRequestedIds = new Set(prs.map((p) => p.id))
      }

      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to authenticate with GitHub'
      viewer.value = null
      requestedPRs.value = []
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function refreshRequestedPRs(options?: { notifyOnNew?: boolean }): Promise<void> {
    if (!pat.value) return
    await verifyAndLoadProfile(pat.value, options)
  }

  async function setPrFilter(mode: PRFilterMode): Promise<void> {
    if (prFilter.value === mode) return
    prFilter.value = mode
    if (pat.value) {
      await refreshRequestedPRs()
    }
  }

  async function clearPat(): Promise<void> {
    pat.value = ''
    viewer.value = null
    requestedPRs.value = []
    error.value = null
    knownReviewRequestedIds = null
    await saveGitHubPat('')
  }

  return {
    pat,
    viewer,
    requestedPRs,
    prFilter,
    isLoading,
    error,
    isAuthenticated,
    init,
    verifyAndLoadProfile,
    signInWithGh,
    refreshRequestedPRs,
    setPrFilter,
    clearPat,
  }
})
