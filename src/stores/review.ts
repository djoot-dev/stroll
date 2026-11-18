import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { MOCK_PR } from '@/data/mockPR'
import {
  addReviewThread,
  createPendingReview,
  fetchPullRequest,
  parsePRUrl,
  replyToReviewThread,
  setReviewThreadResolved,
  submitReview,
} from '@/services/github'
import { buildReadingOrder } from '@/services/readingOrder'
import {
  loadDraftComments,
  loadTourDirection,
  saveDraftComments,
  saveTourDirection,
} from '@/services/storage'
import type {
  DiffSide,
  DraftComment,
  PullRequestData,
  ReviewEvent,
  TourDirection,
  TourStep,
} from '@/types/pr'
import { useAuthStore } from './auth'

export type AppScreen = 'splash' | 'inbox' | 'review' | 'submitted'

export interface SubmittedReviewSummary {
  prRef: string
  prTitle: string
  event: ReviewEvent
  commentCount: number
}

export const useReviewStore = defineStore('review', () => {
  const screen = ref<AppScreen>('splash')
  const pr = ref<PullRequestData | null>(null)
  const tourDirection = ref<TourDirection>('bottom-up')
  const currentStepIndex = ref(0)
  const reviewedPaths = ref<Set<string>>(new Set())
  const draftComments = ref<DraftComment[]>([])
  const lastSubmitted = ref<SubmittedReviewSummary | null>(null)

  const isLoadingPR = ref(false)
  const prError = ref<string | null>(null)
  const isSubmittingReview = ref(false)
  const submitError = ref<string | null>(null)
  const submitSuccessMessage = ref<string | null>(null)

  const sidebarOpen = ref(true)
  const showLoaderModal = ref(false)
  const showFinishModal = ref(false)

  const prKey = computed(() =>
    pr.value ? `${pr.value.owner}/${pr.value.repo}#${pr.value.number}` : '',
  )

  const tourSteps = computed<TourStep[]>(() => {
    if (!pr.value) return []
    return buildReadingOrder(pr.value.files, tourDirection.value)
  })

  const currentStep = computed<TourStep | null>(
    () => tourSteps.value[currentStepIndex.value] ?? null,
  )

  const reviewedCount = computed(() => {
    const validPaths = new Set(tourSteps.value.map((s) => s.file.path))
    let count = 0
    for (const p of reviewedPaths.value) {
      if (validPaths.has(p)) count += 1
    }
    return count
  })

  const progressPercent = computed(() => {
    if (tourSteps.value.length === 0) return 0
    return Math.round(((currentStepIndex.value + 1) / tourSteps.value.length) * 100)
  })

  async function init(): Promise<void> {
    tourDirection.value = await loadTourDirection()
  }

  async function activatePR(data: PullRequestData): Promise<void> {
    pr.value = data
    currentStepIndex.value = 0
    reviewedPaths.value = new Set()
    submitError.value = null
    submitSuccessMessage.value = null
    const key = `${data.owner}/${data.repo}#${data.number}`
    draftComments.value = await loadDraftComments(key)
    screen.value = 'review'
  }

  function backToInbox(): void {
    showFinishModal.value = false
    prError.value = null
    screen.value = 'inbox'
  }

  async function loadMockPR(): Promise<void> {
    await activatePR(structuredClone(MOCK_PR))
  }

  async function loadPRByUrl(url: string): Promise<boolean> {
    const parsed = parsePRUrl(url)
    if (!parsed) {
      prError.value = 'Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123'
      return false
    }
    return loadPRByRepo(parsed.owner, parsed.repo, parsed.number)
  }

  async function loadPRByRepo(owner: string, repo: string, number: number): Promise<boolean> {
    const auth = useAuthStore()
    if (!auth.pat) {
      prError.value = 'Please configure a GitHub Personal Access Token in Settings first.'
      auth.showSettingsModal = true
      return false
    }

    isLoadingPR.value = true
    prError.value = null
    try {
      const data = await fetchPullRequest(auth.pat, owner, repo, number)
      await activatePR(data)
      showLoaderModal.value = false
      return true
    } catch (err) {
      prError.value = err instanceof Error ? err.message : 'Failed to load Pull Request'
      return false
    } finally {
      isLoadingPR.value = false
    }
  }

  async function setTourDirection(direction: TourDirection): Promise<void> {
    const activePath = currentStep.value?.file.path
    tourDirection.value = direction
    await saveTourDirection(direction)

    if (activePath) {
      const newIdx = tourSteps.value.findIndex((s) => s.file.path === activePath)
      if (newIdx >= 0) currentStepIndex.value = newIdx
    }
  }

  function goToStep(index: number): void {
    if (index < 0 || index >= tourSteps.value.length) return
    currentStepIndex.value = index
  }

  function goToFile(path: string): void {
    const idx = tourSteps.value.findIndex((s) => s.file.path === path)
    if (idx >= 0) currentStepIndex.value = idx
  }

  function nextStep(): void {
    if (currentStepIndex.value < tourSteps.value.length - 1) {
      currentStepIndex.value += 1
    }
  }

  function prevStep(): void {
    if (currentStepIndex.value > 0) {
      currentStepIndex.value -= 1
    }
  }

  function toggleReviewed(path?: string): void {
    const target = path ?? currentStep.value?.file.path
    if (!target) return
    const next = new Set(reviewedPaths.value)
    if (next.has(target)) {
      next.delete(target)
    } else {
      next.add(target)
    }
    reviewedPaths.value = next
  }

  function isStepReviewed(path: string): boolean {
    return reviewedPaths.value.has(path)
  }

  async function addDraftComment(
    path: string,
    line: number,
    side: DiffSide,
    body: string,
    startLine?: number,
    startSide?: DiffSide,
  ): Promise<void> {
    if (!pr.value || !body.trim()) return
    const isMultiline = startLine !== undefined && startLine !== line
    const draft: DraftComment = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      prKey: prKey.value,
      path,
      line,
      side,
      ...(isMultiline ? { startLine, startSide: startSide ?? side } : {}),
      body: body.trim(),
      createdAt: new Date().toISOString(),
    }
    draftComments.value = [...draftComments.value, draft]
    await saveDraftComments(prKey.value, draftComments.value)
  }

  async function deleteDraftComment(id: string): Promise<void> {
    if (!pr.value) return
    draftComments.value = draftComments.value.filter((d) => d.id !== id)
    await saveDraftComments(prKey.value, draftComments.value)
  }

  async function submitCompleteReview(event: ReviewEvent, summary: string): Promise<boolean> {
    if (!pr.value) return false
    const auth = useAuthStore()

    isSubmittingReview.value = true
    submitError.value = null
    submitSuccessMessage.value = null

    try {
      // Demo / mock PR mode: simulate review submission locally
      if (pr.value.isMock) {
        const syncedThreads = draftComments.value.map((d) => ({
          id: `mock_thread_${d.id}`,
          path: d.path,
          line: d.line,
          side: d.side,
          startLine: d.startLine,
          startSide: d.startSide,
          isResolved: false,
          isOutdated: false,
          comments: [
            {
              id: `mock_c_${d.id}`,
              author: auth.viewer ?? {
                login: 'you (demo)',
                avatarUrl: 'https://avatars.githubusercontent.com/u/0?v=4',
              },
              body: d.body,
              createdAt: d.createdAt,
              isPending: false,
            },
          ],
        }))
        pr.value = {
          ...pr.value,
          threads: [...pr.value.threads, ...syncedThreads],
        }
        draftComments.value = []
        await saveDraftComments(prKey.value, [])
        lastSubmitted.value = {
          prRef: prKey.value,
          prTitle: pr.value.title,
          event,
          commentCount: syncedThreads.length,
        }
        submitSuccessMessage.value = `Demo review submitted (${event}) with ${syncedThreads.length} inline comment(s).`
        showFinishModal.value = false
        screen.value = 'submitted'
        return true
      }

      if (!auth.pat) {
        throw new Error('GitHub PAT is required to submit a review.')
      }

      let reviewId = pr.value.pendingReviewId
      if (!reviewId) {
        reviewId = await createPendingReview(auth.pat, pr.value.id)
        pr.value.pendingReviewId = reviewId
      }

      // Push all unsynced local draft comments into the pending GitHub review
      for (const draft of draftComments.value) {
        if (!draft.syncedThreadId) {
          const threadId = await addReviewThread(
            auth.pat,
            pr.value.id,
            reviewId,
            draft.path,
            draft.line,
            draft.side,
            draft.body,
            draft.startLine,
            draft.startSide,
          )
          draft.syncedThreadId = threadId
        }
      }

      await submitReview(auth.pat, pr.value.id, reviewId, event, summary.trim())

      const count = draftComments.value.length
      draftComments.value = []
      await saveDraftComments(prKey.value, [])
      pr.value.pendingReviewId = null
      lastSubmitted.value = {
        prRef: prKey.value,
        prTitle: pr.value.title,
        event,
        commentCount: count,
      }
      submitSuccessMessage.value = `Review submitted (${event}) with ${count} inline comment(s).`
      showFinishModal.value = false
      screen.value = 'submitted'
      return true
    } catch (err) {
      submitError.value = err instanceof Error ? err.message : 'Failed to submit review'
      return false
    } finally {
      isSubmittingReview.value = false
    }
  }

  async function replyToThread(threadId: string, body: string): Promise<void> {
    if (!pr.value || !body.trim()) return
    const auth = useAuthStore()
    const target = pr.value.threads.find((t) => t.id === threadId)
    if (!target) return

    if (pr.value.isMock) {
      target.comments.push({
        id: `mock_reply_${Date.now()}`,
        author: auth.viewer ?? {
          login: 'you (demo)',
          avatarUrl: 'https://avatars.githubusercontent.com/u/0?v=4',
        },
        body: body.trim(),
        createdAt: new Date().toISOString(),
      })
      return
    }

    if (!auth.pat) {
      throw new Error('GitHub PAT is required to reply to a review thread.')
    }

    const comment = await replyToReviewThread(auth.pat, threadId, body.trim())
    target.comments.push(comment)
  }

  async function toggleThreadResolved(threadId: string): Promise<void> {
    if (!pr.value) return
    const auth = useAuthStore()
    const target = pr.value.threads.find((t) => t.id === threadId)
    if (!target) return

    const nextState = !target.isResolved
    if (pr.value.isMock) {
      target.isResolved = nextState
      return
    }

    if (!auth.pat) {
      throw new Error('GitHub PAT is required to resolve a review thread.')
    }

    target.isResolved = await setReviewThreadResolved(auth.pat, threadId, nextState)
  }

  return {
    screen,
    pr,
    lastSubmitted,
    tourDirection,
    currentStepIndex,
    reviewedPaths,
    draftComments,
    isLoadingPR,
    prError,
    isSubmittingReview,
    submitError,
    submitSuccessMessage,
    sidebarOpen,
    showLoaderModal,
    showFinishModal,
    prKey,
    tourSteps,
    currentStep,
    reviewedCount,
    progressPercent,
    init,
    loadMockPR,
    loadPRByUrl,
    loadPRByRepo,
    backToInbox,
    setTourDirection,
    goToStep,
    goToFile,
    nextStep,
    prevStep,
    toggleReviewed,
    isStepReviewed,
    addDraftComment,
    deleteDraftComment,
    replyToThread,
    toggleThreadResolved,
    submitCompleteReview,
  }
})
