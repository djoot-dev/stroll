<script setup lang="ts">
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpNarrowWide,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCode,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
  XCircle,
} from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import {
  parseChecklistProgress,
  renderSafeMarkdown,
  toggleChecklistItem,
} from '@/services/markdown'
import { openExternalUrl } from '@/services/native'
import type { CheckoutTarget } from '@/services/localCheckout'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import type {
  PRMergeMethod,
  PRReviewState,
  PRStatusCheck,
  ReactionGroup,
  ReviewComment,
  ReviewSubjectType,
} from '@/types/pr'
import LocalCheckoutPanel from './LocalCheckoutPanel.vue'
import MarkdownContent from './MarkdownContent.vue'
import ReactionBar from './ReactionBar.vue'
import ReviewerPicker from './ReviewerPicker.vue'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()
const pr = computed(() => review.pr)

const checkoutTarget = computed<CheckoutTarget | null>(() => {
  const p = review.pr
  if (!p || p.isMock || p.state !== 'OPEN') return null
  return {
    owner: p.owner,
    repo: p.repo,
    number: p.number,
    headRefName: p.headRefName,
    isCrossRepository: p.isCrossRepository,
    headRefOid: p.headRefOid,
  }
})

const commitsExpanded = ref(true)

const historyNewestFirst = computed(() => settings.historyOrder === 'newest')
const historyOrderLabel = computed(() =>
  historyNewestFirst.value ? 'Newest first' : 'Oldest first',
)

/** PR commits arrive oldest-first (GitHub PR order); flip for newest-first. */
const orderedCommits = computed(() => {
  const commits = pr.value?.commits ?? []
  return historyNewestFirst.value ? [...commits].reverse() : commits
})
const commentDraft = ref('')
const isPostingComment = ref(false)
const commentError = ref<string | null>(null)
const editingCommentId = ref<string | null>(null)
const editCommentBody = ref('')
const isSavingCommentEdit = ref(false)
const deletingCommentId = ref<string | null>(null)
const confirmDeleteCommentId = ref<string | null>(null)
const confirmLifecycleAction = ref<'merge' | 'close' | null>(null)
const mergeMenuOpen = ref(false)
const mergeMethod = ref<PRMergeMethod>('SQUASH')
const isUpdatingLifecycle = ref(false)
const lifecycleError = ref<string | null>(null)
const isAddingLabel = ref(false)
const newLabelInput = ref('')
const isAddingReviewer = ref(false)

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diffMs = Date.now() - ts
  if (diffMs < 60_000) return 'just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

const stateBadge = computed(() => {
  if (!pr.value) return { label: 'Open', class: 'border-pine-border bg-pine-soft text-pine-text', icon: GitPullRequest }
  if (pr.value.state === 'MERGED') {
    return { label: 'Merged', class: 'border-plum-border bg-plum-soft text-plum-text', icon: GitMerge }
  }
  if (pr.value.state === 'CLOSED') {
    return { label: 'Closed', class: 'border-crimson-border bg-crimson-soft text-crimson-text', icon: GitPullRequestClosed }
  }
  if (pr.value.isDraft) {
    return { label: 'Draft', class: 'border-border bg-canvas-elevated text-ink-muted', icon: GitPullRequestDraft }
  }
  return { label: 'Open', class: 'border-pine-border bg-pine-soft text-pine-text', icon: GitPullRequest }
})

const reviewDecisionBadge = computed(() => {
  const decision = pr.value?.reviewDecision
  if (decision === 'APPROVED') {
    return { label: 'Approved', class: 'border-pine-border bg-pine-soft text-pine-text', icon: ShieldCheck }
  }
  if (decision === 'CHANGES_REQUESTED') {
    return { label: 'Changes requested', class: 'border-crimson-border bg-crimson-soft text-crimson-text', icon: ShieldAlert }
  }
  if (decision === 'REVIEW_REQUIRED') {
    return { label: 'Review required', class: 'border-ochre-border bg-ochre-soft text-ochre-text', icon: Clock }
  }
  return null
})

const mergeableBadge = computed(() => {
  const state = pr.value?.mergeable
  if (state === 'MERGEABLE') {
    return { label: 'Mergeable', class: 'border-pine-border bg-pine-soft text-pine-text' }
  }
  if (state === 'CONFLICTING') {
    return { label: 'Merge conflicts', class: 'border-crimson-border bg-crimson-soft text-crimson-text' }
  }
  return { label: 'Merge status pending', class: 'border-border bg-canvas-elevated text-ink-muted' }
})

const diffTotals = computed(() => {
  const files = pr.value?.files ?? []
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
  }
  return { additions, deletions, fileCount: files.length }
})

const hasDescription = computed(() =>
  Boolean(pr.value?.body && renderSafeMarkdown(pr.value.body)),
)

function isCheckPassed(check: PRStatusCheck): boolean {
  const c = (check.conclusion ?? check.status).toUpperCase()
  return c === 'SUCCESS' || c === 'NEUTRAL' || c === 'SKIPPED'
}

function isCheckFailed(check: PRStatusCheck): boolean {
  const c = (check.conclusion ?? check.status).toUpperCase()
  return (
    c === 'FAILURE' ||
    c === 'ERROR' ||
    c === 'TIMED_OUT' ||
    c === 'ACTION_REQUIRED' ||
    c === 'CANCELLED'
  )
}

function checkStatusLabel(check: PRStatusCheck): string {
  const raw = check.conclusion ?? check.status
  return raw.toLowerCase().replace(/_/g, ' ')
}

const checksSummary = computed(() => {
  const rollup = pr.value?.statusCheckRollup
  const checks = rollup?.checks ?? []
  const total = checks.length
  const passed = checks.filter(isCheckPassed).length
  const failed = checks.filter(isCheckFailed).length
  const pending = Math.max(0, total - passed - failed)

  let headline = 'No CI checks reported'
  if (total > 0) {
    if (failed > 0) {
      headline = `${failed} of ${total} check${total === 1 ? '' : 's'} failed`
    } else if (pending > 0) {
      headline = `${passed}/${total} checks passed · ${pending} in progress`
    } else {
      headline = `All ${total} check${total === 1 ? '' : 's'} passed`
    }
  } else if (rollup?.state) {
    headline = `Checks: ${rollup.state.toLowerCase()}`
  }

  return {
    state: rollup?.state ?? null,
    checks,
    total,
    passed,
    failed,
    pending,
    headline,
  }
})

interface ReviewerSummary {
  key: string
  login: string
  displayName: string
  avatarUrl: string
  isTeam: boolean
  status: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'REQUESTED'
}

const reviewerSummaries = computed<ReviewerSummary[]>(() => {
  if (!pr.value) return []

  const byLogin = new Map<string, ReviewerSummary>()

  // Process submitted reviews chronologically so the latest state per reviewer wins
  const submitted = [...pr.value.reviews]
    .filter((r) => r.state !== 'PENDING')
    .sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))

  for (const r of submitted) {
    const existing = byLogin.get(r.author.login)
    // Preserve an earlier APPROVED/CHANGES_REQUESTED if a later review is just COMMENTED
    const nextStatus =
      r.state === 'COMMENTED' &&
      existing &&
      (existing.status === 'APPROVED' || existing.status === 'CHANGES_REQUESTED')
        ? existing.status
        : (r.state as ReviewerSummary['status'])

    byLogin.set(r.author.login, {
      key: `user:${r.author.login}`,
      login: r.author.login,
      displayName: `@${r.author.login}`,
      avatarUrl: r.author.avatarUrl,
      isTeam: false,
      status: nextStatus,
    })
  }

  for (const req of pr.value.requestedReviewers) {
    if (req.type === 'user') {
      // Requested reviewer overrides prior state to show pending re-review
      byLogin.set(req.login, {
        key: `user:${req.login}`,
        login: req.login,
        displayName: `@${req.login}`,
        avatarUrl: req.avatarUrl,
        isTeam: false,
        status: 'REQUESTED',
      })
    } else {
      byLogin.set(`team:${req.login}`, {
        key: `team:${req.login}`,
        login: req.login,
        displayName: req.name || req.login,
        avatarUrl: req.avatarUrl,
        isTeam: true,
        status: 'REQUESTED',
      })
    }
  }

  return Array.from(byLogin.values())
})

function reviewStatusMeta(status: ReviewerSummary['status'] | PRReviewState): {
  label: string
  class: string
} {
  switch (status) {
    case 'APPROVED':
      return { label: 'Approved', class: 'border-pine-border bg-pine-soft text-pine-text' }
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', class: 'border-crimson-border bg-crimson-soft text-crimson-text' }
    case 'COMMENTED':
      return { label: 'Commented', class: 'border-border bg-canvas-elevated text-ink-secondary' }
    case 'DISMISSED':
      return { label: 'Dismissed', class: 'border-border bg-canvas-elevated text-ink-faint' }
    default:
      return { label: 'Review requested', class: 'border-ochre-border bg-ochre-soft text-ochre-text' }
  }
}

interface ConversationItem {
  id: string
  rawId: string
  kind: 'comment' | 'review' | 'thread'
  author: { login: string; avatarUrl: string }
  body: string
  createdAt: string
  reviewState?: PRReviewState
  reactions?: ReactionGroup[]
  threadPath?: string
  threadLine?: number
  threadSubjectType?: ReviewSubjectType
  isResolved?: boolean
  isOutdated?: boolean
  openingCommentId?: string
  replies?: ReviewComment[]
}

const showUnresolvedOnly = ref(false)
const togglingThreadId = ref<string | null>(null)

const conversationItems = computed<ConversationItem[]>(() => {
  if (!pr.value) return []
  const items: ConversationItem[] = []

  for (const c of pr.value.issueComments) {
    items.push({
      id: `comment:${c.id}`,
      rawId: c.id,
      kind: 'comment',
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
      reactions: c.reactions,
    })
  }

  for (const r of pr.value.reviews) {
    if (r.state === 'PENDING') continue
    if (!r.body.trim()) continue
    items.push({
      id: `review:${r.id}`,
      rawId: r.id,
      kind: 'review',
      author: r.author,
      body: r.body,
      createdAt: r.submittedAt ?? pr.value.updatedAt,
      reviewState: r.state,
      reactions: r.reactions,
    })
  }

  for (const t of pr.value.threads) {
    const first = t.comments[0]
    if (!first) continue
    items.push({
      id: `thread:${t.id}`,
      rawId: t.id,
      kind: 'thread',
      author: first.author,
      body: first.body,
      createdAt: first.createdAt,
      reactions: first.reactions,
      threadPath: t.path,
      threadLine: t.line,
      threadSubjectType: t.subjectType,
      isResolved: t.isResolved,
      isOutdated: t.isOutdated,
      openingCommentId: first.id,
      replies: t.comments.slice(1),
    })
  }

  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return historyNewestFirst.value ? items.reverse() : items
})

const unresolvedThreadCount = computed(
  () => (pr.value?.threads ?? []).filter((t) => !t.isResolved && t.comments.length > 0).length,
)

const filteredConversationItems = computed(() => {
  if (pr.value?.state === 'OPEN' && showUnresolvedOnly.value) {
    return conversationItems.value.filter(
      (item) => item.kind === 'thread' && !item.isResolved,
    )
  }
  return conversationItems.value
})

async function handleToggleThreadResolved(threadId: string) {
  if (togglingThreadId.value) return
  togglingThreadId.value = threadId
  commentError.value = null
  try {
    await review.toggleThreadResolved(threadId)
  } catch (err) {
    commentError.value = err instanceof Error ? err.message : 'Failed to update thread state'
  } finally {
    togglingThreadId.value = null
  }
}

function canModifyIssueComment(item: ConversationItem): boolean {
  if (item.kind !== 'comment') return false
  if (pr.value?.isMock) return true
  return Boolean(auth.viewer?.login && auth.viewer.login === item.author.login)
}

function startEditIssueComment(item: ConversationItem) {
  editingCommentId.value = item.rawId
  editCommentBody.value = item.body
  commentError.value = null
}

async function handleSaveIssueCommentEdit(commentId: string) {
  if (!editCommentBody.value.trim() || isSavingCommentEdit.value) return
  isSavingCommentEdit.value = true
  commentError.value = null
  try {
    await review.editIssueComment(commentId, editCommentBody.value)
    editingCommentId.value = null
    editCommentBody.value = ''
  } catch (err) {
    commentError.value = err instanceof Error ? err.message : 'Failed to update comment'
  } finally {
    isSavingCommentEdit.value = false
  }
}

async function handleDeleteIssueComment(commentId: string) {
  if (deletingCommentId.value) return
  deletingCommentId.value = commentId
  commentError.value = null
  try {
    await review.deleteIssueComment(commentId)
  } catch (err) {
    commentError.value = err instanceof Error ? err.message : 'Failed to delete comment'
  } finally {
    deletingCommentId.value = null
  }
}

const isEditingDescription = ref(false)
const descriptionDraft = ref('')
const isSavingDescription = ref(false)
const isTogglingChecklist = ref(false)
const descriptionError = ref<string | null>(null)
const reviewerActionKey = ref<string | null>(null)
const reviewerError = ref<string | null>(null)

const checklistProgress = computed(() =>
  pr.value?.body ? parseChecklistProgress(pr.value.body) : { total: 0, completed: 0 },
)

const canToggleChecklist = computed(() => {
  if (!pr.value) return false
  if (pr.value.isMock) return true
  return Boolean(auth.viewer?.login && auth.viewer.login === pr.value.author.login)
})

watch(
  () => (pr.value ? `${pr.value.owner}/${pr.value.repo}#${pr.value.number}` : null),
  () => {
    isEditingDescription.value = false
    descriptionDraft.value = ''
    descriptionError.value = null
    showUnresolvedOnly.value = false
    reviewerError.value = null
  },
)

async function handleToggleChecklistItem(index: number) {
  if (
    !pr.value ||
    !canToggleChecklist.value ||
    isTogglingChecklist.value ||
    isSavingDescription.value
  ) {
    return
  }
  const nextBody = toggleChecklistItem(pr.value.body, index)
  if (nextBody === pr.value.body) return
  isTogglingChecklist.value = true
  descriptionError.value = null
  try {
    await review.editPRDescription(nextBody)
  } catch (err) {
    descriptionError.value = err instanceof Error ? err.message : 'Failed to update checklist'
  } finally {
    isTogglingChecklist.value = false
  }
}

function startEditDescription() {
  if (!pr.value) return
  descriptionDraft.value = pr.value.body ?? ''
  descriptionError.value = null
  isEditingDescription.value = true
}

function cancelEditDescription() {
  if (isSavingDescription.value) return
  isEditingDescription.value = false
  descriptionDraft.value = ''
  descriptionError.value = null
}

async function handleSaveDescription() {
  if (!pr.value || isSavingDescription.value) return
  isSavingDescription.value = true
  descriptionError.value = null
  try {
    await review.editPRDescription(descriptionDraft.value)
    isEditingDescription.value = false
    descriptionDraft.value = ''
  } catch (err) {
    descriptionError.value = err instanceof Error ? err.message : 'Failed to update description'
  } finally {
    isSavingDescription.value = false
  }
}

function labelBadgeStyle(hexColor: string): Record<string, string> {
  const clean = hexColor.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return {}
  return {
    borderColor: `#${clean}55`,
    backgroundColor: `#${clean}1f`,
  }
}

function labelDotStyle(hexColor: string): Record<string, string> {
  const clean = hexColor.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return {}
  return {
    backgroundColor: `#${clean}`,
  }
}

async function handlePostComment() {
  if (!commentDraft.value.trim() || isPostingComment.value) return
  isPostingComment.value = true
  commentError.value = null
  try {
    await review.postPRComment(commentDraft.value)
    commentDraft.value = ''
  } catch (err) {
    commentError.value = err instanceof Error ? err.message : 'Failed to post comment'
  } finally {
    isPostingComment.value = false
  }
}

const tourCtaLabel = computed(() =>
  review.reviewedCount > 0 || review.tourStarted
    ? 'Continue Guided Tour'
    : 'Start Guided Tour',
)

async function handleMerge(method: PRMergeMethod) {
  if (isUpdatingLifecycle.value) return
  isUpdatingLifecycle.value = true
  lifecycleError.value = null
  mergeMenuOpen.value = false
  try {
    await review.mergePR(method)
  } catch (err) {
    lifecycleError.value = err instanceof Error ? err.message : 'Failed to merge Pull Request'
  } finally {
    isUpdatingLifecycle.value = false
  }
}

async function handleToggleClose() {
  if (!pr.value || isUpdatingLifecycle.value) return
  isUpdatingLifecycle.value = true
  lifecycleError.value = null
  try {
    if (pr.value.state === 'OPEN') {
      await review.closePR()
    } else if (pr.value.state === 'CLOSED') {
      await review.reopenPR()
    }
  } catch (err) {
    lifecycleError.value = err instanceof Error ? err.message : 'Failed to update PR state'
  } finally {
    isUpdatingLifecycle.value = false
  }
}

async function handleToggleDraft() {
  if (!pr.value || isUpdatingLifecycle.value) return
  isUpdatingLifecycle.value = true
  lifecycleError.value = null
  try {
    await review.setPRDraft(!pr.value.isDraft)
  } catch (err) {
    lifecycleError.value = err instanceof Error ? err.message : 'Failed to update draft state'
  } finally {
    isUpdatingLifecycle.value = false
  }
}

async function handleAddLabels() {
  const names = newLabelInput.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (names.length === 0) return
  lifecycleError.value = null
  try {
    await review.addLabels(names)
    newLabelInput.value = ''
    isAddingLabel.value = false
  } catch (err) {
    lifecycleError.value = err instanceof Error ? err.message : 'Failed to add labels'
  }
}

async function handleRemoveLabel(name: string) {
  lifecycleError.value = null
  try {
    await review.removeLabel(name)
  } catch (err) {
    lifecycleError.value = err instanceof Error ? err.message : 'Failed to remove label'
  }
}

async function handleAddReviewer(login: string) {
  if (!login.trim()) return
  reviewerError.value = null
  try {
    await review.addReviewer(login)
    isAddingReviewer.value = false
  } catch (err) {
    reviewerError.value = err instanceof Error ? err.message : 'Failed to request reviewer'
  }
}

async function handleRemoveReviewer(reviewer: ReviewerSummary) {
  if (reviewerActionKey.value) return
  reviewerActionKey.value = reviewer.key
  reviewerError.value = null
  try {
    await review.removeReviewer(reviewer.login, reviewer.isTeam)
  } catch (err) {
    reviewerError.value = err instanceof Error ? err.message : 'Failed to remove reviewer'
  } finally {
    reviewerActionKey.value = null
  }
}

async function handleRerequestReviewer(reviewer: ReviewerSummary) {
  if (reviewerActionKey.value || reviewer.isTeam) return
  reviewerActionKey.value = reviewer.key
  reviewerError.value = null
  try {
    await review.addReviewer(reviewer.login)
  } catch (err) {
    reviewerError.value = err instanceof Error ? err.message : 'Failed to re-request review'
  } finally {
    reviewerActionKey.value = null
  }
}
</script>

<template>
  <div v-if="pr" class="mx-auto max-w-5xl space-y-5 px-5 py-6 pb-14">
    <!-- Refresh Error Banner -->
    <div
      v-if="review.refreshError"
      class="flex items-center gap-2 rounded-xl border border-crimson-border bg-crimson-soft px-4 py-2.5 text-xs text-crimson-text"
    >
      <AlertCircle class="h-4 w-4 shrink-0" />
      <span>{{ review.refreshError }}</span>
    </div>

    <!-- Header & Status Strip -->
    <section class="stroll-card @container rounded-2xl border border-border bg-canvas-subtle p-5">
      <div class="flex flex-col gap-4 @[680px]:flex-row @[680px]:items-start @[680px]:justify-between">
        <div class="min-w-0 flex-1 space-y-2.5">
          <!-- Status Badges Row -->
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
              :class="stateBadge.class"
            >
              <component :is="stateBadge.icon" class="h-3.5 w-3.5" />
              {{ stateBadge.label }}
            </span>

            <span class="font-mono text-xs text-ink-muted">
              {{ pr.owner }}/{{ pr.repo }}#{{ pr.number }}
            </span>

            <span
              v-if="reviewDecisionBadge"
              class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              :class="reviewDecisionBadge.class"
            >
              <component :is="reviewDecisionBadge.icon" class="h-3 w-3" />
              {{ reviewDecisionBadge.label }}
            </span>

            <span
              class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              :class="mergeableBadge.class"
            >
              <AlertTriangle v-if="pr.mergeable === 'CONFLICTING'" class="h-3 w-3" />
              {{ mergeableBadge.label }}
            </span>
          </div>

          <!-- PR Title -->
          <h1 class="text-xl font-bold tracking-tight text-ink">
            {{ pr.title }}
          </h1>

          <!-- Author, Timestamps, Branch Pill & Diff Stats -->
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-muted">
            <span class="inline-flex items-center gap-1.5 font-medium text-ink-secondary">
              <img
                v-if="pr.author.avatarUrl"
                :src="pr.author.avatarUrl"
                :alt="pr.author.login"
                class="h-4 w-4 rounded-full border border-border object-cover"
              />
              @{{ pr.author.login }}
            </span>

            <span v-if="pr.createdAt">opened {{ formatRelativeTime(pr.createdAt) }}</span>
            <span v-if="pr.updatedAt" class="text-ink-faint">·</span>
            <span v-if="pr.updatedAt">updated {{ formatRelativeTime(pr.updatedAt) }}</span>

            <span
              class="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink-secondary"
            >
              <GitBranch class="h-3 w-3 text-ink-faint" />
              <span>{{ pr.headRefName }}</span>
              <span class="text-ink-faint">→</span>
              <span>{{ pr.baseRefName }}</span>
            </span>

            <span class="font-mono text-[11px]">
              <span class="text-pine-text">+{{ diffTotals.additions }}</span>
              <span class="mx-1 text-ink-faint">/</span>
              <span class="text-crimson-text">-{{ diffTotals.deletions }}</span>
              <span class="ml-1.5 text-ink-muted">
                · {{ diffTotals.fileCount }} file{{ diffTotals.fileCount === 1 ? '' : 's' }}
              </span>
            </span>
          </div>

          <LocalCheckoutPanel v-if="checkoutTarget" :target="checkoutTarget" />

          <!-- Labels -->
          <div class="flex flex-wrap items-center gap-1.5 pt-1">
            <span
              v-for="label in pr.labels"
              :key="label.name"
              class="inline-flex items-center gap-1.5 rounded-full border border-border bg-canvas px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary"
              :style="labelBadgeStyle(label.color)"
            >
              <span
                class="h-2 w-2 rounded-full"
                :style="labelDotStyle(label.color)"
              />
              <span>{{ label.name }}</span>
              <button
                type="button"
                title="Remove label"
                class="ml-0.5 rounded-full p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-ink"
                @click="handleRemoveLabel(label.name)"
              >
                <X class="h-2.5 w-2.5" />
              </button>
            </span>

            <form
              v-if="isAddingLabel"
              class="inline-flex items-center gap-1"
              @submit.prevent="handleAddLabels"
            >
              <input
                v-model="newLabelInput"
                type="text"
                placeholder="label1, label2…"
                class="w-32 rounded-full border border-terra-border bg-canvas-inset px-2.5 py-0.5 text-[11px] text-ink focus:outline-none"
                @keydown.esc.prevent="isAddingLabel = false"
              />
              <button
                type="submit"
                class="rounded-full bg-terra px-2 py-0.5 text-[10.5px] font-semibold text-white hover:bg-terra-hover"
              >
                Add
              </button>
            </form>
            <button
              v-else
              type="button"
              class="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10.5px] text-ink-muted transition-colors hover:border-terra-border hover:text-terra-text"
              @click="isAddingLabel = true"
            >
              <Plus class="h-2.5 w-2.5" />
              <span>Label</span>
            </button>
          </div>
        </div>

        <!-- Primary CTA & Lifecycle Actions -->
        <div class="flex shrink-0 flex-col items-start gap-2 @[680px]:items-end">
          <button
            class="inline-flex items-center gap-2 rounded-xl bg-terra px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98] disabled:opacity-40"
            :disabled="review.tourSteps.length === 0"
            @click="review.startTour()"
          >
            <span>{{ tourCtaLabel }}</span>
            <ArrowRight class="h-4 w-4" />
          </button>
          <span class="text-[11px] text-ink-faint">
            {{ review.reviewedCount }} of {{ review.tourSteps.length }} steps reviewed
          </span>

          <div class="relative flex flex-wrap items-center justify-end gap-1.5 pt-1">
            <template v-if="pr.state === 'OPEN'">
              <div
                v-if="confirmLifecycleAction"
                class="flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]"
                :class="
                  confirmLifecycleAction === 'close'
                    ? 'border-crimson-border bg-crimson-soft text-crimson-text'
                    : 'border-pine-border bg-pine-soft text-pine-text'
                "
              >
                <span class="font-medium">
                  {{
                    confirmLifecycleAction === 'close'
                      ? 'Close this PR?'
                      : `Confirm ${mergeMethod.toLowerCase()} merge?`
                  }}
                </span>
                <button
                  type="button"
                  class="rounded px-2 py-0.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  :class="confirmLifecycleAction === 'close' ? 'bg-crimson' : 'bg-pine'"
                  :disabled="isUpdatingLifecycle"
                  @click="
                    const action = confirmLifecycleAction;
                    confirmLifecycleAction = null;
                    action === 'close' ? handleToggleClose() : handleMerge(mergeMethod)
                  "
                >
                  Confirm
                </button>
                <button
                  type="button"
                  class="rounded border border-border bg-canvas px-2 py-0.5 text-ink-secondary hover:bg-canvas-elevated"
                  @click="confirmLifecycleAction = null"
                >
                  Cancel
                </button>
              </div>

              <template v-else>
                <div class="relative inline-flex">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-l-lg border border-pine-border bg-pine-soft px-2.5 py-1 text-[11px] font-semibold text-pine-text transition-colors hover:bg-pine/20 disabled:opacity-40"
                    :disabled="isUpdatingLifecycle || pr.isDraft || pr.mergeable === 'CONFLICTING'"
                    :aria-busy="isUpdatingLifecycle"
                    :title="pr.isDraft ? 'Mark ready for review before merging' : pr.mergeable === 'CONFLICTING' ? 'Resolve merge conflicts before merging' : `Merge using ${mergeMethod}`"
                    @click="confirmLifecycleAction = 'merge'; mergeMenuOpen = false"
                  >
                    <Loader2 v-if="isUpdatingLifecycle" class="h-3 w-3 animate-spin" />
                    <GitMerge v-else class="h-3 w-3" />
                    <span>{{ mergeMethod === 'SQUASH' ? 'Squash & merge' : mergeMethod === 'REBASE' ? 'Rebase & merge' : 'Merge PR' }}</span>
                  </button>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    :aria-expanded="mergeMenuOpen"
                    aria-label="Choose merge method"
                    class="inline-flex items-center rounded-r-lg border border-l-0 border-pine-border bg-pine-soft px-1.5 py-1 text-pine-text transition-colors hover:bg-pine/20 disabled:opacity-40"
                    :disabled="isUpdatingLifecycle"
                    :aria-busy="isUpdatingLifecycle"
                    @click="mergeMenuOpen = !mergeMenuOpen"
                  >
                    <ChevronDown class="h-3 w-3" />
                  </button>

                  <div
                    v-if="mergeMenuOpen"
                    role="menu"
                    class="animate-pop-in absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-border bg-canvas-subtle p-1 shadow-lg"
                  >
                    <button
                      v-for="opt in [
                        { value: 'SQUASH' as PRMergeMethod, label: 'Squash and merge' },
                        { value: 'MERGE' as PRMergeMethod, label: 'Create a merge commit' },
                        { value: 'REBASE' as PRMergeMethod, label: 'Rebase and merge' },
                      ]"
                      :key="opt.value"
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-canvas-elevated"
                      :class="mergeMethod === opt.value ? 'font-semibold text-terra-text' : 'text-ink-secondary'"
                      @click="mergeMethod = opt.value; mergeMenuOpen = false"
                    >
                      <span>{{ opt.label }}</span>
                      <CheckCircle2 v-if="mergeMethod === opt.value" class="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  class="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-40"
                  :disabled="isUpdatingLifecycle"
                  :aria-busy="isUpdatingLifecycle"
                  @click="handleToggleDraft"
                >
                  {{ pr.isDraft ? 'Ready for review' : 'Convert to draft' }}
                </button>

                <button
                  type="button"
                  class="rounded-lg border border-crimson-border/60 bg-canvas px-2.5 py-1 text-[11px] text-crimson-text transition-colors hover:bg-crimson-soft disabled:opacity-40"
                  :disabled="isUpdatingLifecycle"
                  :aria-busy="isUpdatingLifecycle"
                  @click="confirmLifecycleAction = 'close'; mergeMenuOpen = false"
                >
                  Close PR
                </button>
              </template>
            </template>

            <button
              v-else-if="pr.state === 'CLOSED'"
              type="button"
              class="rounded-lg border border-pine-border bg-pine-soft px-2.5 py-1 text-[11px] font-semibold text-pine-text transition-colors hover:bg-pine/20 disabled:opacity-40"
              :disabled="isUpdatingLifecycle"
              :aria-busy="isUpdatingLifecycle"
              @click="handleToggleClose"
            >
              Reopen PR
            </button>
          </div>

          <p v-if="lifecycleError" class="max-w-xs text-right text-[11px] text-crimson-text">
            {{ lifecycleError }}
          </p>
        </div>
      </div>
    </section>

    <!-- PR Description -->
    <section class="stroll-card rounded-2xl border border-border bg-canvas-subtle p-5">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2.5">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Description
          </h2>
          <span
            v-if="checklistProgress.total > 0"
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
            :class="
              checklistProgress.completed === checklistProgress.total
                ? 'border-pine-border bg-pine-soft text-pine-text'
                : 'border-border bg-canvas-elevated text-ink-secondary'
            "
            :title="
              canToggleChecklist
                ? 'Click checkboxes below to update checklist progress'
                : 'Checklist progress'
            "
          >
            <ListChecks class="h-3 w-3" />
            <span>
              {{ checklistProgress.completed }}/{{ checklistProgress.total }} checklist
              item{{ checklistProgress.total === 1 ? '' : 's' }}
            </span>
          </span>
        </div>
        <button
          v-if="pr && !isEditingDescription"
          type="button"
          title="Edit description"
          class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-ink"
          @click="startEditDescription"
        >
          <Pencil class="h-3 w-3" />
        </button>
      </div>
      <div v-if="isEditingDescription" class="space-y-2">
        <textarea
          v-model="descriptionDraft"
          rows="10"
          placeholder="Describe this Pull Request…"
          class="w-full resize-y rounded-xl border border-border bg-canvas-inset px-3 py-2 font-mono text-xs leading-relaxed text-ink focus:border-terra-border focus:outline-none"
          @keydown.meta.enter.prevent="handleSaveDescription"
          @keydown.ctrl.enter.prevent="handleSaveDescription"
          @keydown.esc.prevent="cancelEditDescription"
        />
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-ink-faint">
            {{ pr?.isMock ? 'Demo mode: description will be updated locally.' : 'Markdown supported · ⌘↵ to save · Esc to cancel' }}
          </span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary hover:bg-canvas-elevated disabled:opacity-40"
              :disabled="isSavingDescription"
              @click="cancelEditDescription"
            >
              Cancel
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg bg-terra px-3 py-1 text-[11px] font-semibold text-white hover:bg-terra-hover disabled:opacity-40"
              :disabled="isSavingDescription"
              :aria-busy="isSavingDescription"
              @click="handleSaveDescription"
            >
              <Loader2 v-if="isSavingDescription" class="h-3 w-3 animate-spin" />
              <span>Save</span>
            </button>
          </div>
        </div>
        <p v-if="descriptionError" class="text-[11px] text-crimson-text">
          {{ descriptionError }}
        </p>
      </div>
      <template v-else-if="hasDescription && pr">
        <MarkdownContent
          :content="pr.body"
          :interactive-checklist="canToggleChecklist && !isTogglingChecklist"
          class="text-[13px] leading-relaxed text-ink-secondary"
          @toggle-task="handleToggleChecklistItem"
        />
        <p v-if="descriptionError" class="mt-2 text-[11px] text-crimson-text">
          {{ descriptionError }}
        </p>
      </template>
      <p v-else class="text-xs italic text-ink-faint">
        No description provided.
      </p>
    </section>

    <!-- CI Checks & Reviewers Grid -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- CI / Checks Card -->
      <section class="stroll-card overflow-hidden rounded-2xl border border-border bg-canvas-subtle">
        <div class="flex items-center justify-between gap-3 border-b border-border-muted px-5 py-3.5">
          <div class="flex min-w-0 items-center gap-2.5">
            <XCircle
              v-if="checksSummary.failed > 0 || checksSummary.state === 'FAILURE' || checksSummary.state === 'ERROR'"
              class="h-4 w-4 shrink-0 text-crimson"
            />
            <CheckCircle2
              v-else-if="checksSummary.total > 0 && checksSummary.pending === 0"
              class="h-4 w-4 shrink-0 text-pine"
            />
            <Loader2
              v-else-if="checksSummary.total > 0"
              class="h-4 w-4 shrink-0 animate-spin text-ochre-text"
            />
            <Clock v-else class="h-4 w-4 shrink-0 text-ink-faint" />

            <div class="min-w-0">
              <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Checks
              </h2>
              <p class="truncate text-xs font-medium text-ink">
                {{ checksSummary.headline }}
              </p>
            </div>
          </div>
        </div>

        <div v-if="checksSummary.checks.length === 0" class="px-5 py-4 text-xs text-ink-faint">
          No status checks found on the latest commit.
        </div>
        <ul v-else class="divide-y divide-border-muted">
          <li
            v-for="check in checksSummary.checks"
            :key="check.id"
            class="flex items-center justify-between gap-3 px-5 py-2.5 text-xs"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <CheckCircle2
                v-if="isCheckPassed(check)"
                class="h-3.5 w-3.5 shrink-0 text-pine"
              />
              <XCircle
                v-else-if="isCheckFailed(check)"
                class="h-3.5 w-3.5 shrink-0 text-crimson"
              />
              <Loader2
                v-else
                class="h-3.5 w-3.5 shrink-0 animate-spin text-ochre-text"
              />

              <div class="min-w-0">
                <div class="truncate font-medium text-ink">{{ check.name }}</div>
                <div class="truncate text-[11px] text-ink-faint">
                  {{ check.description || checkStatusLabel(check) }}
                </div>
              </div>
            </div>

            <button
              v-if="check.url"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
              title="Open check details in browser"
              @click="openExternalUrl(check.url)"
            >
              <span>Details</span>
              <ExternalLink class="h-3 w-3" />
            </button>
          </li>
        </ul>
      </section>

      <!-- Reviewers & Activity Card -->
      <section class="stroll-card overflow-hidden rounded-2xl border border-border bg-canvas-subtle">
        <div class="flex items-center justify-between border-b border-border-muted px-5 py-3.5">
          <div class="flex items-center gap-2">
            <Users class="h-4 w-4 text-ink-muted" />
            <div>
              <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Reviewers
              </h2>
              <p class="text-xs font-medium text-ink">
                {{ reviewerSummaries.length }} participant{{ reviewerSummaries.length === 1 ? '' : 's' }}
              </p>
            </div>
          </div>

          <ReviewerPicker
            v-if="isAddingReviewer"
            :search="review.searchReviewerCandidates"
            @submit="handleAddReviewer"
            @cancel="isAddingReviewer = false"
          />
          <button
            v-else
            type="button"
            class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
            @click="isAddingReviewer = true"
          >
            <Plus class="h-3 w-3" />
            <span>Request</span>
          </button>
        </div>

        <div v-if="reviewerSummaries.length === 0" class="px-5 py-4 text-xs text-ink-faint">
          No reviewers requested or submitted yet.
        </div>

        <ul v-else class="divide-y divide-border-muted">
          <li
            v-for="reviewer in reviewerSummaries"
            :key="reviewer.key"
            class="flex items-center justify-between gap-3 px-5 py-2.5 text-xs"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <img
                v-if="reviewer.avatarUrl"
                :src="reviewer.avatarUrl"
                :alt="reviewer.login"
                class="h-5 w-5 shrink-0 rounded-full border border-border object-cover"
              />
              <span
                v-else
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-canvas-elevated text-[10px] font-semibold text-ink-muted"
              >
                <Users v-if="reviewer.isTeam" class="h-3 w-3" />
                <template v-else>{{ reviewer.login.slice(0, 1).toUpperCase() }}</template>
              </span>
              <span class="truncate font-medium text-ink">{{ reviewer.displayName }}</span>
            </div>

            <div class="flex items-center gap-1.5">
              <span
                class="shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium"
                :class="reviewStatusMeta(reviewer.status).class"
              >
                {{ reviewStatusMeta(reviewer.status).label }}
              </span>
              <button
                v-if="reviewer.status === 'REQUESTED'"
                type="button"
                title="Remove reviewer request"
                :disabled="reviewerActionKey === reviewer.key"
                :aria-busy="reviewerActionKey === reviewer.key"
                class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-ink disabled:opacity-40"
                @click="handleRemoveReviewer(reviewer)"
              >
                <Loader2
                  v-if="reviewerActionKey === reviewer.key"
                  class="h-3 w-3 animate-spin"
                />
                <X v-else class="h-3 w-3" />
              </button>
              <button
                v-else-if="
                  !reviewer.isTeam &&
                  reviewer.login !== pr.author.login &&
                  pr.state === 'OPEN'
                "
                type="button"
                title="Re-request review"
                :disabled="reviewerActionKey === reviewer.key"
                :aria-busy="reviewerActionKey === reviewer.key"
                class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-terra-text disabled:opacity-40"
                @click="handleRerequestReviewer(reviewer)"
              >
                <Loader2
                  v-if="reviewerActionKey === reviewer.key"
                  class="h-3 w-3 animate-spin"
                />
                <RotateCw v-else class="h-3 w-3" />
              </button>
            </div>
          </li>
        </ul>

        <p
          v-if="reviewerError"
          class="border-t border-border-muted px-5 py-2.5 text-[11px] text-crimson-text"
        >
          {{ reviewerError }}
        </p>
      </section>
    </div>

    <!-- Commits List -->
    <section class="stroll-card overflow-hidden rounded-2xl border border-border bg-canvas-subtle">
      <div class="flex items-center gap-2 pr-5 transition-colors hover:bg-canvas-elevated/40">
        <button
          class="flex min-w-0 flex-1 items-center justify-between gap-3 py-3.5 pl-5 text-left"
          :aria-expanded="commitsExpanded"
          @click="commitsExpanded = !commitsExpanded"
        >
          <div class="flex items-center gap-2">
            <GitCommitHorizontal class="h-4 w-4 text-ink-muted" />
            <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Commits
            </h2>
            <span class="rounded-full bg-canvas-elevated px-2 py-0.5 font-mono text-[10.5px] text-ink-secondary">
              {{ pr.commits.length }}
            </span>
          </div>

          <ChevronDown v-if="commitsExpanded" class="h-4 w-4 text-ink-muted" />
          <ChevronRight v-else class="h-4 w-4 text-ink-muted" />
        </button>
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
          :title="`Showing ${historyOrderLabel.toLowerCase()} — click to flip`"
          :aria-label="`History order: ${historyOrderLabel}. Click to flip.`"
          @click="settings.toggleHistoryOrder()"
        >
          <ArrowDownWideNarrow v-if="historyNewestFirst" class="h-3 w-3" />
          <ArrowUpNarrowWide v-else class="h-3 w-3" />
          <span>{{ historyOrderLabel }}</span>
        </button>
      </div>

      <div v-if="commitsExpanded" class="border-t border-border-muted">
        <div v-if="pr.commits.length === 0" class="px-5 py-4 text-xs text-ink-faint">
          No commits loaded.
        </div>
        <ul v-else class="divide-y divide-border-muted">
          <li
            v-for="commit in orderedCommits"
            :key="commit.oid"
            role="button"
            tabindex="0"
            class="flex cursor-pointer items-center justify-between gap-3 px-5 py-2.5 text-xs transition-colors hover:bg-canvas-elevated/40 focus:outline-none focus-visible:bg-canvas-elevated/60"
            title="Filter tour to this commit and open diff"
            @click="review.setCommitFilter(commit.oid).then(() => review.startTour())"
            @keydown.enter.prevent="review.setCommitFilter(commit.oid).then(() => review.startTour())"
            @keydown.space.prevent="review.setCommitFilter(commit.oid).then(() => review.startTour())"
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <code class="shrink-0 rounded bg-canvas-elevated px-1.5 py-0.5 font-mono text-[11px] text-terra-text">
                {{ commit.shortOid }}
              </code>
              <span class="truncate font-medium text-ink">
                {{ commit.messageHeadline }}
              </span>
            </div>

            <div class="flex shrink-0 items-center gap-2 text-[11px] text-ink-faint">
              <span class="hidden sm:inline">{{ commit.authorName }}</span>
              <span>{{ formatRelativeTime(commit.committedDate) }}</span>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- Conversation Feed -->
    <section class="stroll-card overflow-hidden rounded-2xl border border-border bg-canvas-subtle">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border-muted px-5 py-3.5">
        <div class="flex items-center gap-2">
          <MessageSquare class="h-4 w-4 text-ink-muted" />
          <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Conversation
          </h2>
          <span class="rounded-full bg-canvas-elevated px-2 py-0.5 font-mono text-[10.5px] text-ink-secondary">
            {{ filteredConversationItems.length }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="pr.state === 'OPEN'"
            type="button"
            :aria-pressed="showUnresolvedOnly"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors"
            :class="
              showUnresolvedOnly
                ? 'border-terra-border bg-terra-soft font-medium text-terra-text'
                : 'border-border bg-canvas text-ink-secondary hover:border-terra-border hover:text-terra-text'
            "
            @click="showUnresolvedOnly = !showUnresolvedOnly"
          >
            <span>Show unresolved only</span>
            <span
              v-if="unresolvedThreadCount > 0"
              class="rounded-full px-1.5 py-0.2 font-mono text-[10px]"
              :class="
                showUnresolvedOnly
                  ? 'bg-terra/15 text-terra-text'
                  : 'bg-canvas-elevated text-ink-muted'
              "
            >
              {{ unresolvedThreadCount }}
            </span>
          </button>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
            :title="`Showing ${historyOrderLabel.toLowerCase()} — click to flip`"
            :aria-label="`History order: ${historyOrderLabel}. Click to flip.`"
            @click="settings.toggleHistoryOrder()"
          >
            <ArrowDownWideNarrow v-if="historyNewestFirst" class="h-3 w-3" />
            <ArrowUpNarrowWide v-else class="h-3 w-3" />
            <span>{{ historyOrderLabel }}</span>
          </button>
        </div>
      </div>

      <div v-if="filteredConversationItems.length === 0" class="px-5 py-5 text-xs text-ink-faint">
        {{
          pr.state === 'OPEN' && showUnresolvedOnly
            ? 'No unresolved review threads.'
            : 'No general comments or review summaries yet.'
        }}
      </div>

      <div v-else class="divide-y divide-border-muted">
        <article
          v-for="item in filteredConversationItems"
          :key="item.id"
          class="space-y-2 px-5 py-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex flex-wrap items-center gap-2">
              <img
                v-if="item.author.avatarUrl"
                :src="item.author.avatarUrl"
                :alt="item.author.login"
                class="h-5 w-5 rounded-full border border-border object-cover"
              />
              <span class="font-semibold text-ink">@{{ item.author.login }}</span>
              <span
                v-if="item.kind === 'review' && item.reviewState"
                class="rounded-full border px-2 py-0.2 text-[10px] font-medium"
                :class="reviewStatusMeta(item.reviewState).class"
              >
                {{ reviewStatusMeta(item.reviewState).label }}
              </span>
              <template v-if="item.kind === 'thread' && item.threadPath">
                <button
                  type="button"
                  title="Jump to thread in tour"
                  class="inline-flex items-center gap-1 rounded-md border border-border bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
                  @click="
                    item.threadSubjectType !== 'FILE' && item.threadLine
                      ? review.goToFileLine(item.threadPath, item.threadLine)
                      : review.goToFile(item.threadPath)
                  "
                >
                  <FileCode class="h-3 w-3 text-ink-faint" />
                  <span>
                    {{ item.threadPath }}{{ item.threadSubjectType === 'FILE' ? ' · file' : `:${item.threadLine}` }}
                  </span>
                </button>
                <span
                  class="rounded-full border px-2 py-0.2 text-[10px] font-medium"
                  :class="
                    item.isResolved
                      ? 'border-pine-border bg-pine-soft text-pine-text'
                      : 'border-ochre-border bg-ochre-soft text-ochre-text'
                  "
                >
                  {{ item.isResolved ? 'Resolved' : 'Unresolved' }}
                </span>
                <span
                  v-if="item.isOutdated"
                  class="rounded-full border border-border bg-canvas-elevated px-2 py-0.2 text-[10px] text-ink-faint"
                >
                  Outdated
                </span>
              </template>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-ink-faint">
                {{ formatRelativeTime(item.createdAt) }}
              </span>
              <button
                v-if="item.kind === 'thread'"
                type="button"
                :disabled="togglingThreadId === item.rawId"
                :aria-busy="togglingThreadId === item.rawId"
                class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text disabled:opacity-40"
                @click="handleToggleThreadResolved(item.rawId)"
              >
                <Loader2
                  v-if="togglingThreadId === item.rawId"
                  class="h-2.5 w-2.5 animate-spin"
                />
                <RotateCcw v-else-if="item.isResolved" class="h-2.5 w-2.5" />
                <CheckCircle2 v-else class="h-2.5 w-2.5" />
                <span>{{ item.isResolved ? 'Unresolve' : 'Resolve' }}</span>
              </button>
              <template v-if="canModifyIssueComment(item)">
                <button
                  type="button"
                  title="Edit comment"
                  class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-ink"
                  @click="startEditIssueComment(item)"
                >
                  <Pencil class="h-3 w-3" />
                </button>
                <template v-if="confirmDeleteCommentId === item.rawId">
                  <span class="text-[10.5px] text-crimson-text">Delete?</span>
                  <button
                    type="button"
                    class="rounded bg-crimson px-1.5 py-0.5 text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
                    :disabled="deletingCommentId === item.rawId"
                    @click="
                      confirmDeleteCommentId = null;
                      handleDeleteIssueComment(item.rawId)
                    "
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    class="rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-ink-secondary hover:bg-canvas-elevated"
                    @click="confirmDeleteCommentId = null"
                  >
                    Cancel
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  title="Delete comment"
                  aria-label="Delete comment"
                  class="rounded p-0.5 text-ink-faint transition-colors hover:bg-crimson-soft hover:text-crimson-text disabled:opacity-40"
                  :disabled="deletingCommentId === item.rawId"
                  :aria-busy="deletingCommentId === item.rawId"
                  @click="confirmDeleteCommentId = item.rawId"
                >
                  <Loader2 v-if="deletingCommentId === item.rawId" class="h-3 w-3 animate-spin" />
                  <Trash2 v-else class="h-3 w-3" />
                </button>
              </template>
            </div>
          </div>

          <div v-if="editingCommentId === item.rawId" class="space-y-2 pt-1">
            <textarea
              v-model="editCommentBody"
              rows="3"
              class="w-full resize-y rounded-xl border border-border bg-canvas-inset px-3 py-2 text-xs text-ink focus:border-terra-border focus:outline-none"
              @keydown.meta.enter.prevent="handleSaveIssueCommentEdit(item.rawId)"
              @keydown.ctrl.enter.prevent="handleSaveIssueCommentEdit(item.rawId)"
              @keydown.esc.prevent="editingCommentId = null"
            />
            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary hover:bg-canvas-elevated"
                @click="editingCommentId = null"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-lg bg-terra px-3 py-1 text-[11px] font-semibold text-white hover:bg-terra-hover disabled:opacity-40"
                :disabled="isSavingCommentEdit || !editCommentBody.trim()"
                :aria-busy="isSavingCommentEdit"
                @click="handleSaveIssueCommentEdit(item.rawId)"
              >
                <Loader2 v-if="isSavingCommentEdit" class="h-3 w-3 animate-spin" />
                <span>Save</span>
              </button>
            </div>
          </div>
          <template v-else>
            <MarkdownContent
              :content="item.body"
              class="text-xs leading-relaxed text-ink-secondary"
            />
            <ReactionBar
              :subject-id="item.openingCommentId ?? item.rawId"
              :reactions="item.reactions"
            />
            <div
              v-if="item.replies && item.replies.length > 0"
              class="mt-2 space-y-2 border-l-2 border-border-muted pl-3"
            >
              <div
                v-for="reply in item.replies"
                :key="reply.id"
                class="space-y-1 text-xs"
              >
                <div class="flex items-center gap-2">
                  <img
                    v-if="reply.author.avatarUrl"
                    :src="reply.author.avatarUrl"
                    :alt="reply.author.login"
                    class="h-4 w-4 rounded-full border border-border object-cover"
                  />
                  <span class="font-semibold text-ink">@{{ reply.author.login }}</span>
                  <span class="text-[10.5px] text-ink-faint">
                    {{ formatRelativeTime(reply.createdAt) }}
                  </span>
                </div>
                <MarkdownContent
                  :content="reply.body"
                  class="text-xs leading-relaxed text-ink-secondary"
                />
              </div>
            </div>
          </template>
        </article>
      </div>

      <!-- Reply Composer -->
      <div class="border-t border-border-muted bg-canvas/50 p-4">
        <textarea
          v-model="commentDraft"
          rows="3"
          placeholder="Leave a general comment on this pull request…"
          class="w-full resize-y rounded-xl border border-border bg-canvas-subtle px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-terra-border focus:outline-none"
          @keydown.meta.enter.prevent="handlePostComment"
          @keydown.ctrl.enter.prevent="handlePostComment"
        />

        <div class="mt-2.5 flex items-center justify-between gap-3">
          <p v-if="commentError" class="text-[11px] text-crimson-text">
            {{ commentError }}
          </p>
          <span v-else class="text-[11px] text-ink-faint">
            {{ pr.isMock ? 'Demo mode: comment will be added locally.' : 'Markdown supported · ⌘↵ to post' }}
          </span>

          <button
            class="inline-flex items-center gap-1.5 rounded-xl bg-pine px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-pine-hover active:scale-[0.98] disabled:opacity-40"
            :disabled="!commentDraft.trim() || isPostingComment"
            :aria-busy="isPostingComment"
            @click="handlePostComment"
          >
            <Loader2 v-if="isPostingComment" class="h-3.5 w-3.5 animate-spin" />
            <Send v-else class="h-3.5 w-3.5" />
            <span>Comment</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Bottom CTA -->
    <div class="flex items-center justify-end border-t border-border-muted pt-4">
      <button
        class="inline-flex items-center gap-2 rounded-xl bg-terra px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98] disabled:opacity-40"
        :disabled="review.tourSteps.length === 0"
        @click="review.startTour()"
      >
        <span>{{ tourCtaLabel }}</span>
        <ArrowRight class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
