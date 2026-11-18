import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchViewerAndRequestedPRs } from '@/services/github'
import { getGhAuthToken, isTauriRuntime } from '@/services/native'
import { loadGitHubPat, saveGitHubPat } from '@/services/storage'
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

  const isAuthenticated = computed(() => Boolean(pat.value && viewer.value))

  async function init(): Promise<void> {
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

  async function verifyAndLoadProfile(token: string): Promise<boolean> {
    isLoading.value = true
    error.value = null
    try {
      const { viewer: user, requestedPRs: prs } = await fetchViewerAndRequestedPRs(
        token,
        prFilter.value,
      )
      pat.value = token
      viewer.value = user
      requestedPRs.value = prs
      await saveGitHubPat(token)
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

  async function refreshRequestedPRs(): Promise<void> {
    if (!pat.value) return
    await verifyAndLoadProfile(pat.value)
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
