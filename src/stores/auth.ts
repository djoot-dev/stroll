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
  const hasMorePRs = ref(false)
  const prEndCursor = ref<string | null>(null)
  const isLoadingMore = ref(false)
  const prFilter = ref<PRFilterMode>('review-requested')
  const isLoading = ref(false)
  /**
   * True while a user-initiated inbox reload (filter switch or manual refresh) is in flight,
   * so the UI can show a loading state in place of the list. Background refreshes stay silent.
   */
  const isReloadingList = ref(false)
  const error = ref<string | null>(null)
  let knownReviewRequestedIds: Set<string> | null = null
  let persistedPat: string | null = null

  const isAuthenticated = computed(() => Boolean(pat.value && viewer.value))

  async function init(): Promise<void> {
    const settings = useSettingsStore()
    await settings.init()
    const savedPat = await loadGitHubPat()
    if (savedPat) {
      pat.value = savedPat
      persistedPat = savedPat
      await verifyAndLoadProfile(savedPat, { persist: false })
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
    options?: { notifyOnNew?: boolean; persist?: boolean },
  ): Promise<boolean> {
    isLoading.value = true
    error.value = null
    try {
      const activeFilter = prFilter.value
      const {
        viewer: user,
        requestedPRs: prs,
        hasNextPage,
        endCursor,
      } = await fetchViewerAndRequestedPRs(token, activeFilter)
      pat.value = token
      viewer.value = user
      requestedPRs.value = prs
      hasMorePRs.value = hasNextPage
      prEndCursor.value = endCursor
      const trimmedToken = token.trim()
      if (options?.persist !== false && trimmedToken !== persistedPat) {
        await saveGitHubPat(trimmedToken)
        persistedPat = trimmedToken
      }

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
      hasMorePRs.value = false
      prEndCursor.value = null
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function loadMorePRs(): Promise<void> {
    if (!pat.value || !hasMorePRs.value || !prEndCursor.value || isLoadingMore.value) return
    isLoadingMore.value = true
    error.value = null
    try {
      const {
        requestedPRs: nextPrs,
        hasNextPage,
        endCursor,
      } = await fetchViewerAndRequestedPRs(pat.value, prFilter.value, prEndCursor.value)
      const seen = new Set(requestedPRs.value.map((p) => p.id))
      const merged = [...requestedPRs.value]
      for (const item of nextPrs) {
        if (!seen.has(item.id)) {
          merged.push(item)
        }
      }
      requestedPRs.value = merged
      hasMorePRs.value = hasNextPage
      prEndCursor.value = endCursor
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load more pull requests'
    } finally {
      isLoadingMore.value = false
    }
  }

  async function refreshRequestedPRs(options?: {
    notifyOnNew?: boolean
    showLoading?: boolean
  }): Promise<void> {
    if (!pat.value) return
    const { showLoading = false, ...rest } = options ?? {}
    if (showLoading) isReloadingList.value = true
    try {
      await verifyAndLoadProfile(pat.value, { ...rest, persist: false })
    } finally {
      if (showLoading) isReloadingList.value = false
    }
  }

  async function setPrFilter(mode: PRFilterMode): Promise<void> {
    if (prFilter.value === mode) return
    prFilter.value = mode
    await refreshRequestedPRs({ showLoading: true })
  }

  async function clearPat(): Promise<void> {
    pat.value = ''
    persistedPat = null
    viewer.value = null
    requestedPRs.value = []
    hasMorePRs.value = false
    prEndCursor.value = null
    error.value = null
    knownReviewRequestedIds = null
    await saveGitHubPat('')
  }

  return {
    pat,
    viewer,
    requestedPRs,
    hasMorePRs,
    isLoadingMore,
    prFilter,
    isLoading,
    isReloadingList,
    error,
    isAuthenticated,
    init,
    verifyAndLoadProfile,
    signInWithGh,
    refreshRequestedPRs,
    loadMorePRs,
    setPrFilter,
    clearPat,
  }
})
