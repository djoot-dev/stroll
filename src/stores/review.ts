import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { MOCK_COMMIT_BODIES, MOCK_FILE_COMMIT_OIDS, MOCK_PR } from '@/data/mockPR'
import {
  addPRComment,
  addPullRequestLabels,
  addFileReviewThread,
  addReviewThread,
  closePullRequest,
  createPendingReview,
  deleteIssueComment as apiDeleteIssueComment,
  deleteReviewComment as apiDeleteReviewComment,
  fetchCommitDiffFiles,
  fetchCompareDiffFiles,
  fetchFileCommitHistory,
  fetchPRHeadPulse,
  fetchPullRequest,
  mergePullRequest,
  parsePRUrl,
  removePullRequestLabel,
  removePullRequestReviewers,
  reopenPullRequest,
  replyToReviewThread,
  requestPullRequestReviewers,
  setFileViewedState,
  setPullRequestDraft,
  setReviewThreadResolved,
  submitReview,
  toggleReaction as apiToggleReaction,
  updateIssueComment as apiUpdateIssueComment,
  updateReviewComment as apiUpdateReviewComment,
} from '@/services/github'
import { buildReadingOrder } from '@/services/readingOrder'
import {
  computeFileFingerprint,
  loadDraftComments,
  loadRepoPaths,
  loadViewedFiles,
  saveDraftComments,
  saveRepoPaths,
  saveViewedFiles,
  type ViewedFilesMap,
} from '@/services/storage'
import type {
  DiffSide,
  DraftComment,
  PRFile,
  PRFileCommit,
  PRIssueComment,
  PRMergeMethod,
  PullRequestData,
  ReactionContent,
  ReactionGroup,
  ReviewEvent,
  TourDirection,
  TourStep,
} from '@/types/pr'
import { useAuthStore } from './auth'
import { useSettingsStore } from './settings'

export type AppScreen = 'splash' | 'inbox' | 'review' | 'submitted'

export type ReviewViewMode = 'overview' | 'step'

export interface SubmittedReviewSummary {
  prRef: string
  prTitle: string
  event: ReviewEvent
  commentCount: number
}

export const useReviewStore = defineStore('review', () => {
  const screen = ref<AppScreen>('splash')
  const activeView = ref<ReviewViewMode>('overview')
  const pr = ref<PullRequestData | null>(null)
  const tourDirection = ref<TourDirection>('bottom-up')
  const currentStepIndex = ref(0)
  const reviewedPaths = ref<Set<string>>(new Set())
  let fileFingerprints = new Map<string, string>()
  const draftComments = ref<DraftComment[]>([])
  const repoPaths = ref<Record<string, string>>({})
  const lastSubmitted = ref<SubmittedReviewSummary | null>(null)

  const isLoadingPR = ref(false)
  const loadingPRKey = ref<string | null>(null)
  const isRefreshingPR = ref(false)
  const prHasRemoteUpdates = ref(false)
  const remoteUpdateSummary = ref<string | null>(null)
  const prError = ref<string | null>(null)
  const refreshError = ref<string | null>(null)
  const isSubmittingReview = ref(false)
  const submitError = ref<string | null>(null)
  const submitSuccessMessage = ref<string | null>(null)

  const sidebarOpen = ref(true)
  const ignoreWhitespace = ref(false)
  const commitFilter = ref<string>('all')
  const filteredFiles = ref<PRFile[] | null>(null)
  const isLoadingCommitFilter = ref(false)
  const pinnedPaths = ref<Set<string>>(new Set())
  const hiddenPaths = ref<Set<string>>(new Set())
  const customOrderPaths = ref<string[]>([])
  const showLoaderModal = ref(false)
  const showFinishModal = ref(false)
  /** PR commits that touched each file path, loaded lazily per tour step. */
  const fileCommits = ref<Record<string, PRFileCommit[]>>({})
  const fileCommitsLoading = ref<Set<string>>(new Set())
  const fileCommitsError = ref<string | null>(null)
  let fileCommitsHeadOid: string | null = null

  const prKey = computed(() =>
    pr.value ? `${pr.value.owner}/${pr.value.repo}#${pr.value.number}` : '',
  )

  const currentRepoPath = computed<string | null>(() => {
    if (!pr.value) return null
    return repoPaths.value[`${pr.value.owner}/${pr.value.repo}`] ?? null
  })

  const lastReviewedCommitOid = computed<string | null>(() => {
    if (!pr.value || pr.value.commits.length < 2) return null
    const auth = useAuthStore()
    const viewerLogin = auth.viewer?.login
    if (!viewerLogin) return null
    const submittedReviews = pr.value.reviews
      .filter((r) => r.author.login === viewerLogin && r.state !== 'PENDING' && r.submittedAt)
      .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
    const latestReviewAt = submittedReviews[0]?.submittedAt
    if (!latestReviewAt) return null

    let lastCommitBeforeReview: string | null = null
    let hasNewerCommit = false
    for (const c of pr.value.commits) {
      if (c.committedDate <= latestReviewAt) {
        lastCommitBeforeReview = c.oid
      } else {
        hasNewerCommit = true
      }
    }
    return hasNewerCommit ? lastCommitBeforeReview : null
  })

  const tourSteps = computed<TourStep[]>(() => {
    if (!pr.value) return []
    const files = filteredFiles.value ?? pr.value.files
    let steps = buildReadingOrder(files, tourDirection.value).filter(
      (s) => !hiddenPaths.value.has(s.file.path),
    )

    if (customOrderPaths.value.length > 0) {
      const orderMap = new Map(customOrderPaths.value.map((p, i) => [p, i]))
      steps = [...steps].sort((a, b) => {
        const ia = orderMap.get(a.file.path) ?? Number.MAX_SAFE_INTEGER
        const ib = orderMap.get(b.file.path) ?? Number.MAX_SAFE_INTEGER
        return ia - ib
      })
    }

    if (pinnedPaths.value.size > 0) {
      const pinned = steps.filter((s) => pinnedPaths.value.has(s.file.path))
      const rest = steps.filter((s) => !pinnedPaths.value.has(s.file.path))
      steps = [...pinned, ...rest]
    }

    return steps.map((s, idx) => ({ ...s, stepIndex: idx }))
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
    const settings = useSettingsStore()
    await settings.init()
    tourDirection.value = settings.defaultTourDirection
    repoPaths.value = await loadRepoPaths()
  }

  async function linkRepoPath(ownerRepo: string, localPath: string): Promise<void> {
    const key = ownerRepo.trim()
    const val = localPath.trim()
    if (!key || !val) return
    repoPaths.value = { ...repoPaths.value, [key]: val }
    await saveRepoPaths(repoPaths.value)
  }

  async function unlinkRepoPath(ownerRepo: string): Promise<void> {
    const next = { ...repoPaths.value }
    delete next[ownerRepo]
    repoPaths.value = next
    await saveRepoPaths(repoPaths.value)
  }

  async function activatePR(data: PullRequestData): Promise<void> {
    const settings = useSettingsStore()
    pr.value = data
    activeView.value = 'overview'
    currentStepIndex.value = 0
    commitFilter.value = 'all'
    filteredFiles.value = null
    pinnedPaths.value = new Set()
    hiddenPaths.value = new Set()
    customOrderPaths.value = []
    reviewedPaths.value = new Set()
    fileFingerprints = new Map(
      data.files.map((file) => [file.path, computeFileFingerprint(file)]),
    )
    sidebarOpen.value = settings.sidebarDefaultOpen
    prHasRemoteUpdates.value = false
    remoteUpdateSummary.value = null
    refreshError.value = null
    submitError.value = null
    submitSuccessMessage.value = null
    const key = `${data.owner}/${data.repo}#${data.number}`
    const [savedDrafts, savedViewed] = await Promise.all([
      loadDraftComments(key),
      loadViewedFiles(key),
    ])
    draftComments.value = savedDrafts

    const restoredPaths = new Set<string>()
    const validViewed: ViewedFilesMap = {}
    for (const file of data.files) {
      const fingerprint = fileFingerprints.get(file.path) ?? computeFileFingerprint(file)
      const isViewed =
        file.viewerViewedState !== undefined
          ? file.viewerViewedState === 'VIEWED'
          : savedViewed[file.path] === fingerprint
      if (isViewed) {
        restoredPaths.add(file.path)
        validViewed[file.path] = fingerprint
      }
    }
    reviewedPaths.value = restoredPaths

    if (Object.keys(validViewed).length !== Object.keys(savedViewed).length) {
      await saveViewedFiles(key, validViewed)
    }

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
    const settings = useSettingsStore()
    const parsed = parsePRUrl(url, settings.githubHost)
    if (!parsed) {
      prError.value = `Invalid GitHub PR URL. Expected format: https://${settings.githubHost}/owner/repo/pull/123`
      return false
    }
    return loadPRByRepo(parsed.owner, parsed.repo, parsed.number)
  }

  async function loadPRByRepo(owner: string, repo: string, number: number): Promise<boolean> {
    if (isLoadingPR.value) return false
    const auth = useAuthStore()
    const settings = useSettingsStore()
    if (!auth.pat) {
      prError.value = 'Please configure a GitHub Personal Access Token in Settings first.'
      settings.openSettings('github')
      return false
    }

    isLoadingPR.value = true
    loadingPRKey.value = `${owner}/${repo}#${number}`
    prError.value = null
    try {
      const localRepoPath = repoPaths.value[`${owner}/${repo}`] ?? null
      const data = await fetchPullRequest(auth.pat, owner, repo, number, localRepoPath)
      await activatePR(data)
      showLoaderModal.value = false
      return true
    } catch (err) {
      prError.value = err instanceof Error ? err.message : 'Failed to load Pull Request'
      return false
    } finally {
      isLoadingPR.value = false
      loadingPRKey.value = null
    }
  }

  async function setTourDirection(direction: TourDirection): Promise<void> {
    const settings = useSettingsStore()
    const activePath = currentStep.value?.file.path
    tourDirection.value = direction
    await settings.setDefaultTourDirection(direction)

    if (activePath) {
      const newIdx = tourSteps.value.findIndex((s) => s.file.path === activePath)
      if (newIdx >= 0) currentStepIndex.value = newIdx
    }
  }

  async function refreshCurrentPR(): Promise<boolean> {
    if (!pr.value) return false
    if (pr.value.isMock) {
      refreshError.value = null
      return true
    }

    const auth = useAuthStore()
    if (!auth.pat) {
      refreshError.value = 'GitHub PAT is required to refresh Pull Request.'
      return false
    }

    if (isRefreshingPR.value) return false

    const activePath = currentStep.value?.file.path ?? null
    const prevStepIndex = currentStepIndex.value
    const prevView = activeView.value
    const prevFingerprints = new Map(fileFingerprints)
    const prevReviewed = new Set(reviewedPaths.value)
    const { owner, repo, number } = pr.value
    const localRepoPath = currentRepoPath.value

    isRefreshingPR.value = true
    refreshError.value = null
    try {
      const data = await fetchPullRequest(auth.pat, owner, repo, number, localRepoPath)
      const nextFingerprints = new Map(
        data.files.map((file) => [file.path, computeFileFingerprint(file)]),
      )

      const restoredPaths = new Set<string>()
      const validViewed: ViewedFilesMap = {}
      for (const file of data.files) {
        const nextFp = nextFingerprints.get(file.path) ?? computeFileFingerprint(file)
        const isViewed =
          file.viewerViewedState !== undefined
            ? file.viewerViewedState === 'VIEWED'
            : prevReviewed.has(file.path) && prevFingerprints.get(file.path) === nextFp
        if (isViewed) {
          restoredPaths.add(file.path)
          validViewed[file.path] = nextFp
        }
      }

      pr.value = data
      prHasRemoteUpdates.value = false
      remoteUpdateSummary.value = null
      fileFingerprints = nextFingerprints
      reviewedPaths.value = restoredPaths

      const key = `${data.owner}/${data.repo}#${data.number}`
      await saveViewedFiles(key, validViewed)

      if (activePath) {
        const mappedIdx = tourSteps.value.findIndex((s) => s.file.path === activePath)
        if (mappedIdx >= 0) {
          currentStepIndex.value = mappedIdx
        } else {
          currentStepIndex.value = Math.min(prevStepIndex, Math.max(0, tourSteps.value.length - 1))
        }
      } else {
        currentStepIndex.value = Math.min(prevStepIndex, Math.max(0, tourSteps.value.length - 1))
      }

      activeView.value = prevView
      return true
    } catch (err) {
      refreshError.value = err instanceof Error ? err.message : 'Failed to refresh Pull Request'
      return false
    } finally {
      isRefreshingPR.value = false
    }
  }

  function dismissRemoteUpdates(): void {
    prHasRemoteUpdates.value = false
    remoteUpdateSummary.value = null
  }

  async function checkForRemotePRUpdates(): Promise<void> {
    if (screen.value !== 'review' || !pr.value || pr.value.isMock || isRefreshingPR.value) {
      return
    }
    const auth = useAuthStore()
    if (!auth.pat) return
    try {
      const pulse = await fetchPRHeadPulse(
        auth.pat,
        pr.value.owner,
        pr.value.repo,
        pr.value.number,
      )
      if (!pulse) return
      if (pulse.headRefOid !== pr.value.headRefOid) {
        prHasRemoteUpdates.value = true
        remoteUpdateSummary.value = 'New commits have been pushed to this Pull Request.'
      } else if (
        pulse.commentCount > pr.value.issueComments.length ||
        pulse.threadCount > pr.value.threads.length ||
        pulse.updatedAt > pr.value.updatedAt
      ) {
        prHasRemoteUpdates.value = true
        remoteUpdateSummary.value = 'New comments or activity arrived on GitHub.'
      }
    } catch {
      // Background poll failures are non-fatal
    }
  }

  function openOverview(): void {
    activeView.value = 'overview'
  }

  function toggleOverview(): void {
    if (activeView.value === 'overview') {
      if (tourSteps.value.length > 0) {
        activeView.value = 'step'
      }
    } else {
      activeView.value = 'overview'
    }
  }

  function startTour(): void {
    if (tourSteps.value.length > 0) {
      activeView.value = 'step'
    }
  }

  function goToStep(index: number): void {
    if (index < 0 || index >= tourSteps.value.length) return
    currentStepIndex.value = index
    activeView.value = 'step'
  }

  function goToFile(path: string): void {
    const idx = tourSteps.value.findIndex((s) => s.file.path === path)
    if (idx >= 0) {
      currentStepIndex.value = idx
      activeView.value = 'step'
    }
  }

  function nextStep(): void {
    if (activeView.value === 'overview') {
      if (tourSteps.value.length > 0) {
        activeView.value = 'step'
      }
      return
    }
    if (currentStepIndex.value < tourSteps.value.length - 1) {
      currentStepIndex.value += 1
    }
  }

  function prevStep(): void {
    if (activeView.value === 'overview') return
    if (currentStepIndex.value > 0) {
      currentStepIndex.value -= 1
    }
  }

  async function toggleReviewed(path?: string): Promise<void> {
    const target = path ?? currentStep.value?.file.path
    if (!target) return
    const next = new Set(reviewedPaths.value)
    const markingReviewed = !next.has(target)
    if (markingReviewed) {
      next.add(target)
    } else {
      next.delete(target)
    }
    reviewedPaths.value = next

    const settings = useSettingsStore()
    if (markingReviewed && settings.autoAdvanceOnReview && target === currentStep.value?.file.path) {
      const steps = tourSteps.value
      const nextUnreviewed = steps.findIndex(
        (s, idx) => idx > currentStepIndex.value && !next.has(s.file.path),
      )
      if (nextUnreviewed >= 0) {
        currentStepIndex.value = nextUnreviewed
      } else {
        const firstUnreviewed = steps.findIndex((s) => !next.has(s.file.path))
        if (firstUnreviewed >= 0) {
          currentStepIndex.value = firstUnreviewed
        } else if (currentStepIndex.value < steps.length - 1) {
          currentStepIndex.value += 1
        }
      }
    }

    const buildViewedMap = (paths: Set<string>): ViewedFilesMap => {
      const viewedMap: ViewedFilesMap = {}
      if (!pr.value) return viewedMap
      for (const file of pr.value.files) {
        if (paths.has(file.path)) {
          viewedMap[file.path] = fileFingerprints.get(file.path) ?? computeFileFingerprint(file)
        }
      }
      return viewedMap
    }

    if (pr.value && prKey.value) {
      await saveViewedFiles(prKey.value, buildViewedMap(next))
    }

    const auth = useAuthStore()
    if (pr.value && !pr.value.isMock && auth.pat) {
      try {
        await setFileViewedState(auth.pat, pr.value.id, target, markingReviewed)
      } catch (err) {
        const reverted = new Set(reviewedPaths.value)
        if (markingReviewed) {
          reverted.delete(target)
        } else {
          reverted.add(target)
        }
        reviewedPaths.value = reverted
        if (pr.value && prKey.value) {
          await saveViewedFiles(prKey.value, buildViewedMap(reverted))
        }
        refreshError.value =
          err instanceof Error ? err.message : 'Failed to sync viewed state with GitHub'
      }
    }
  }

  function isStepReviewed(path: string): boolean {
    return reviewedPaths.value.has(path)
  }

  function toggleIgnoreWhitespace(): void {
    ignoreWhitespace.value = !ignoreWhitespace.value
  }

  function togglePinStep(path: string): void {
    const activePath = currentStep.value?.file.path
    const next = new Set(pinnedPaths.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    pinnedPaths.value = next
    if (activePath) {
      const idx = tourSteps.value.findIndex((s) => s.file.path === activePath)
      if (idx >= 0) currentStepIndex.value = idx
    }
  }

  function toggleHideStep(path: string): void {
    const activePath = currentStep.value?.file.path
    const next = new Set(hiddenPaths.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    hiddenPaths.value = next
    if (tourSteps.value.length === 0) {
      activeView.value = 'overview'
      currentStepIndex.value = 0
      return
    }
    if (activePath === path) {
      currentStepIndex.value = Math.min(currentStepIndex.value, tourSteps.value.length - 1)
    } else if (activePath) {
      const idx = tourSteps.value.findIndex((s) => s.file.path === activePath)
      if (idx >= 0) currentStepIndex.value = idx
    }
  }

  function moveStep(path: string, delta: -1 | 1): void {
    const activePath = currentStep.value?.file.path
    const currentOrder = tourSteps.value.map((s) => s.file.path)
    const idx = currentOrder.indexOf(path)
    const targetIdx = idx + delta
    if (idx < 0 || targetIdx < 0 || targetIdx >= currentOrder.length) return
    const next = [...currentOrder]
    ;[next[idx], next[targetIdx]] = [next[targetIdx], next[idx]]
    customOrderPaths.value = next
    if (activePath) {
      const newIdx = tourSteps.value.findIndex((s) => s.file.path === activePath)
      if (newIdx >= 0) currentStepIndex.value = newIdx
    }
  }

  function resetTourCustomization(): void {
    const activePath = currentStep.value?.file.path
    pinnedPaths.value = new Set()
    hiddenPaths.value = new Set()
    customOrderPaths.value = []
    if (activePath) {
      const idx = tourSteps.value.findIndex((s) => s.file.path === activePath)
      if (idx >= 0) currentStepIndex.value = idx
    }
  }

  /** Files after the current step whose commit history is loaded along with it. */
  const FILE_COMMITS_PREFETCH = 8

  function resetFileCommitsIfStale(): void {
    const headOid = pr.value?.headRefOid ?? null
    if (headOid === fileCommitsHeadOid) return
    fileCommitsHeadOid = headOid
    fileCommits.value = {}
    fileCommitsLoading.value = new Set()
    fileCommitsError.value = null
  }

  /**
   * Ensures the PR commits touching the file at `index` (and a few files after
   * it in tour order) are loaded. Results are cached per PR head commit.
   */
  async function ensureFileCommitsForStep(index: number = currentStepIndex.value): Promise<void> {
    if (!pr.value) return
    resetFileCommitsIfStale()
    const files = tourSteps.value
      .slice(Math.max(0, index), Math.max(0, index) + 1 + FILE_COMMITS_PREFETCH)
      .map((s) => s.file)
      .filter((f) => !(f.path in fileCommits.value) && !fileCommitsLoading.value.has(f.path))
    if (files.length === 0) return

    if (pr.value.isMock) {
      const next = { ...fileCommits.value }
      for (const file of files) {
        const oids = MOCK_FILE_COMMIT_OIDS[file.path] ?? []
        next[file.path] = oids.flatMap((oid) => {
          const c = pr.value?.commits.find((pc) => pc.oid === oid)
          return c ? [{ ...c, messageBody: MOCK_COMMIT_BODIES[oid] ?? '', isMerge: false }] : []
        })
      }
      fileCommits.value = next
      return
    }

    const auth = useAuthStore()
    if (!auth.pat) return

    const { owner, repo, headRefOid } = pr.value
    const prCommitOids = new Set(pr.value.commits.map((c) => c.oid))
    const paths = files.map((f) => f.path)
    fileCommitsLoading.value = new Set([...fileCommitsLoading.value, ...paths])
    try {
      const result = await fetchFileCommitHistory(
        auth.pat,
        owner,
        repo,
        headRefOid,
        files.map((f) => ({ path: f.path, previousPath: f.previousPath })),
        prCommitOids,
      )
      if (fileCommitsHeadOid !== headRefOid) return
      const next = { ...fileCommits.value }
      for (const path of paths) next[path] = result.get(path) ?? []
      fileCommits.value = next
      fileCommitsError.value = null
    } catch (err) {
      if (fileCommitsHeadOid !== headRefOid) return
      fileCommitsError.value =
        err instanceof Error ? err.message : 'Failed to load file commit history'
    } finally {
      if (fileCommitsHeadOid === headRefOid) {
        const loading = new Set(fileCommitsLoading.value)
        for (const path of paths) loading.delete(path)
        fileCommitsLoading.value = loading
      }
    }
  }

  async function setCommitFilter(mode: string): Promise<void> {
    if (!pr.value) return
    commitFilter.value = mode
    if (mode === 'all') {
      filteredFiles.value = null
      currentStepIndex.value = 0
      return
    }
    if (pr.value.isMock) {
      const idx = pr.value.commits.findIndex((c) => c.oid === mode)
      if (idx >= 0) {
        const start = idx % pr.value.files.length
        filteredFiles.value = pr.value.files.slice(start, start + 2)
      } else {
        filteredFiles.value = pr.value.files.slice(-2)
      }
      currentStepIndex.value = 0
      return
    }

    const auth = useAuthStore()
    if (!auth.pat) {
      refreshError.value = 'GitHub PAT is required to filter by commit.'
      commitFilter.value = 'all'
      filteredFiles.value = null
      return
    }

    isLoadingCommitFilter.value = true
    refreshError.value = null
    try {
      const { owner, repo, headRefOid } = pr.value
      if (mode === 'since-last-review') {
        const baseOid = lastReviewedCommitOid.value
        if (!baseOid) {
          filteredFiles.value = null
          commitFilter.value = 'all'
          return
        }
        filteredFiles.value = await fetchCompareDiffFiles(auth.pat, owner, repo, baseOid, headRefOid)
      } else {
        filteredFiles.value = await fetchCommitDiffFiles(auth.pat, owner, repo, mode)
      }
      currentStepIndex.value = 0
    } catch (err) {
      refreshError.value = err instanceof Error ? err.message : 'Failed to load commit diff'
      commitFilter.value = 'all'
      filteredFiles.value = null
    } finally {
      isLoadingCommitFilter.value = false
    }
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

  /** Queues a pending comment on the file as a whole rather than a line. */
  async function addFileDraftComment(path: string, body: string): Promise<void> {
    if (!pr.value || !body.trim()) return
    const draft: DraftComment = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      prKey: prKey.value,
      path,
      subjectType: 'FILE',
      line: 0,
      side: 'RIGHT',
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

  async function updateDraftComment(id: string, body: string): Promise<void> {
    if (!pr.value || !body.trim()) return
    const trimmed = body.trim()
    draftComments.value = draftComments.value.map((d) =>
      d.id === id ? { ...d, body: trimmed } : d,
    )
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
          subjectType: d.subjectType ?? 'LINE',
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
          const threadId =
            draft.subjectType === 'FILE'
              ? await addFileReviewThread(auth.pat, pr.value.id, reviewId, draft.path, draft.body)
              : await addReviewThread(
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

  async function postPRComment(body: string): Promise<PRIssueComment | null> {
    if (!pr.value || !body.trim()) return null
    const auth = useAuthStore()
    const trimmed = body.trim()

    if (pr.value.isMock) {
      const comment: PRIssueComment = {
        id: `mock_pr_comment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        author: auth.viewer ?? {
          login: 'you (demo)',
          avatarUrl: 'https://avatars.githubusercontent.com/u/0?v=4',
        },
        body: trimmed,
        createdAt: new Date().toISOString(),
      }
      pr.value = {
        ...pr.value,
        issueComments: [...pr.value.issueComments, comment],
      }
      return comment
    }

    if (!auth.pat) {
      throw new Error('GitHub PAT is required to comment on a Pull Request.')
    }

    const comment = await addPRComment(auth.pat, pr.value.id, trimmed)
    pr.value = {
      ...pr.value,
      issueComments: [...pr.value.issueComments, comment],
    }
    return comment
  }

  async function editReviewComment(
    threadId: string,
    commentId: string,
    body: string,
  ): Promise<void> {
    if (!pr.value || !body.trim()) return
    const trimmed = body.trim()
    const thread = pr.value.threads.find((t) => t.id === threadId)
    const comment = thread?.comments.find((c) => c.id === commentId)
    if (!comment) return

    if (pr.value.isMock) {
      comment.body = trimmed
      return
    }

    const auth = useAuthStore()
    if (!auth.pat) {
      throw new Error('GitHub PAT is required to edit a review comment.')
    }
    comment.body = await apiUpdateReviewComment(auth.pat, commentId, trimmed)
  }

  async function deleteReviewComment(threadId: string, commentId: string): Promise<void> {
    if (!pr.value) return
    const thread = pr.value.threads.find((t) => t.id === threadId)
    if (!thread) return

    if (!pr.value.isMock) {
      const auth = useAuthStore()
      if (!auth.pat) {
        throw new Error('GitHub PAT is required to delete a review comment.')
      }
      await apiDeleteReviewComment(auth.pat, commentId)
    }

    thread.comments = thread.comments.filter((c) => c.id !== commentId)
    if (thread.comments.length === 0) {
      pr.value = {
        ...pr.value,
        threads: pr.value.threads.filter((t) => t.id !== threadId),
      }
    }
  }

  async function editIssueComment(commentId: string, body: string): Promise<void> {
    if (!pr.value || !body.trim()) return
    const trimmed = body.trim()
    const comment = pr.value.issueComments.find((c) => c.id === commentId)
    if (!comment) return

    if (pr.value.isMock) {
      comment.body = trimmed
      return
    }

    const auth = useAuthStore()
    if (!auth.pat) {
      throw new Error('GitHub PAT is required to edit a comment.')
    }
    comment.body = await apiUpdateIssueComment(auth.pat, commentId, trimmed)
  }

  async function deleteIssueComment(commentId: string): Promise<void> {
    if (!pr.value) return
    if (!pr.value.isMock) {
      const auth = useAuthStore()
      if (!auth.pat) {
        throw new Error('GitHub PAT is required to delete a comment.')
      }
      await apiDeleteIssueComment(auth.pat, commentId)
    }
    pr.value = {
      ...pr.value,
      issueComments: pr.value.issueComments.filter((c) => c.id !== commentId),
    }
  }

  function findReactionTarget(
    subjectId: string,
  ): { reactions?: ReactionGroup[] } | null {
    if (!pr.value) return null
    for (const thread of pr.value.threads) {
      const c = thread.comments.find((item) => item.id === subjectId)
      if (c) return c
    }
    const ic = pr.value.issueComments.find((item) => item.id === subjectId)
    if (ic) return ic
    const rev = pr.value.reviews.find((item) => item.id === subjectId)
    if (rev) return rev
    return null
  }

  async function toggleCommentReaction(
    subjectId: string,
    content: ReactionContent,
  ): Promise<void> {
    if (!pr.value) return
    const target = findReactionTarget(subjectId)
    if (!target) return

    const prev = target.reactions ? target.reactions.map((r) => ({ ...r })) : []
    const existing = prev.find((r) => r.content === content)
    const adding = !(existing?.viewerHasReacted ?? false)

    const next: ReactionGroup[] = existing
      ? prev
          .map((r) =>
            r.content === content
              ? {
                  ...r,
                  count: Math.max(0, r.count + (adding ? 1 : -1)),
                  viewerHasReacted: adding,
                }
              : r,
          )
          .filter((r) => r.count > 0)
      : [...prev, { content, count: 1, viewerHasReacted: true }]

    target.reactions = next

    if (pr.value.isMock) return

    const auth = useAuthStore()
    if (!auth.pat) {
      target.reactions = prev
      throw new Error('GitHub PAT is required to react to a comment.')
    }

    try {
      await apiToggleReaction(auth.pat, subjectId, content, adding)
    } catch (err) {
      target.reactions = prev
      throw err
    }
  }

  async function mergePR(method: PRMergeMethod, commitHeadline?: string): Promise<void> {
    if (!pr.value) return
    if (pr.value.isMock) {
      pr.value = { ...pr.value, state: 'MERGED' }
      return
    }
    const auth = useAuthStore()
    if (!auth.pat) throw new Error('GitHub PAT is required to merge a Pull Request.')
    const nextState = await mergePullRequest(auth.pat, pr.value.id, method, commitHeadline)
    pr.value = { ...pr.value, state: nextState }
  }

  async function closePR(): Promise<void> {
    if (!pr.value) return
    if (pr.value.isMock) {
      pr.value = { ...pr.value, state: 'CLOSED' }
      return
    }
    const auth = useAuthStore()
    if (!auth.pat) throw new Error('GitHub PAT is required to close a Pull Request.')
    const nextState = await closePullRequest(auth.pat, pr.value.id)
    pr.value = { ...pr.value, state: nextState }
  }

  async function reopenPR(): Promise<void> {
    if (!pr.value) return
    if (pr.value.isMock) {
      pr.value = { ...pr.value, state: 'OPEN' }
      return
    }
    const auth = useAuthStore()
    if (!auth.pat) throw new Error('GitHub PAT is required to reopen a Pull Request.')
    const nextState = await reopenPullRequest(auth.pat, pr.value.id)
    pr.value = { ...pr.value, state: nextState }
  }

  async function setPRDraft(isDraft: boolean): Promise<void> {
    if (!pr.value) return
    if (pr.value.isMock) {
      pr.value = { ...pr.value, isDraft }
      return
    }
    const auth = useAuthStore()
    if (!auth.pat) throw new Error('GitHub PAT is required to update draft status.')
    const nextDraft = await setPullRequestDraft(auth.pat, pr.value.id, isDraft)
    pr.value = { ...pr.value, isDraft: nextDraft }
  }

  async function addReviewer(login: string): Promise<void> {
    const clean = login.trim().replace(/^@/, '')
    if (!pr.value || !clean) return
    if (pr.value.isMock) {
      if (!pr.value.requestedReviewers.some((r) => r.login === clean)) {
        pr.value = {
          ...pr.value,
          requestedReviewers: [
            ...pr.value.requestedReviewers,
            { type: 'user', login: clean, avatarUrl: '' },
          ],
        }
      }
      return
    }
    const auth = useAuthStore()
    if (!auth.pat) throw new Error('GitHub PAT is required to request reviewers.')
    const { owner, repo, number } = pr.value
    const reviewers = await requestPullRequestReviewers(auth.pat, owner, repo, number, [clean])
    const teams = pr.value.requestedReviewers.filter((r) => r.type === 'team')
    pr.value = { ...pr.value, requestedReviewers: [...reviewers, ...teams] }
  }

  async function removeReviewer(login: string): Promise<void> {
    if (!pr.value) return
    if (!pr.value.isMock) {
      const auth = useAuthStore()
      if (!auth.pat) throw new Error('GitHub PAT is required to remove reviewers.')
      const { owner, repo, number } = pr.value
      await removePullRequestReviewers(auth.pat, owner, repo, number, [login])
    }
    pr.value = {
      ...pr.value,
      requestedReviewers: pr.value.requestedReviewers.filter((r) => r.login !== login),
    }
  }

  async function addLabels(names: string[]): Promise<void> {
    const cleaned = names.map((n) => n.trim()).filter(Boolean)
    if (!pr.value || cleaned.length === 0) return
    if (pr.value.isMock) {
      const existing = new Set(pr.value.labels.map((l) => l.name))
      const added = cleaned
        .filter((n) => !existing.has(n))
        .map((name) => ({ name, color: '8b949e' }))
      pr.value = { ...pr.value, labels: [...pr.value.labels, ...added] }
      return
    }
    const auth = useAuthStore()
    if (!auth.pat) throw new Error('GitHub PAT is required to add labels.')
    const { owner, repo, number } = pr.value
    const labels = await addPullRequestLabels(auth.pat, owner, repo, number, cleaned)
    pr.value = { ...pr.value, labels }
  }

  async function removeLabel(name: string): Promise<void> {
    if (!pr.value) return
    if (!pr.value.isMock) {
      const auth = useAuthStore()
      if (!auth.pat) throw new Error('GitHub PAT is required to remove labels.')
      const { owner, repo, number } = pr.value
      await removePullRequestLabel(auth.pat, owner, repo, number, name)
    }
    pr.value = {
      ...pr.value,
      labels: pr.value.labels.filter((l) => l.name !== name),
    }
  }

  return {
    screen,
    activeView,
    pr,
    lastSubmitted,
    tourDirection,
    currentStepIndex,
    reviewedPaths,
    draftComments,
    repoPaths,
    currentRepoPath,
    isLoadingPR,
    loadingPRKey,
    isRefreshingPR,
    prHasRemoteUpdates,
    remoteUpdateSummary,
    prError,
    refreshError,
    isSubmittingReview,
    submitError,
    submitSuccessMessage,
    sidebarOpen,
    ignoreWhitespace,
    commitFilter,
    isLoadingCommitFilter,
    lastReviewedCommitOid,
    pinnedPaths,
    hiddenPaths,
    customOrderPaths,
    showLoaderModal,
    showFinishModal,
    prKey,
    tourSteps,
    currentStep,
    reviewedCount,
    progressPercent,
    init,
    linkRepoPath,
    unlinkRepoPath,
    loadMockPR,
    loadPRByUrl,
    loadPRByRepo,
    refreshCurrentPR,
    checkForRemotePRUpdates,
    dismissRemoteUpdates,
    backToInbox,
    setTourDirection,
    openOverview,
    toggleOverview,
    startTour,
    goToStep,
    goToFile,
    nextStep,
    prevStep,
    toggleReviewed,
    isStepReviewed,
    toggleIgnoreWhitespace,
    setCommitFilter,
    fileCommits,
    fileCommitsLoading,
    fileCommitsError,
    ensureFileCommitsForStep,
    togglePinStep,
    toggleHideStep,
    moveStep,
    resetTourCustomization,
    addDraftComment,
    addFileDraftComment,
    updateDraftComment,
    deleteDraftComment,
    replyToThread,
    toggleThreadResolved,
    postPRComment,
    editReviewComment,
    deleteReviewComment,
    editIssueComment,
    deleteIssueComment,
    toggleCommentReaction,
    mergePR,
    closePR,
    reopenPR,
    setPRDraft,
    addReviewer,
    removeReviewer,
    addLabels,
    removeLabel,
    submitCompleteReview,
  }
})
