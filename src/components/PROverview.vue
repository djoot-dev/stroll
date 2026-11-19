<script setup lang="ts">
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  MessageSquare,
  Send,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { openExternalUrl } from '@/services/native'
import { useReviewStore } from '@/stores/review'
import type { PRReviewState, PRStatusCheck } from '@/types/pr'
import MarkdownContent from './MarkdownContent.vue'

const review = useReviewStore()
const pr = computed(() => review.pr)

const checksExpanded = ref(true)
const commitsExpanded = ref(true)
const commentDraft = ref('')
const isPostingComment = ref(false)
const commentError = ref<string | null>(null)

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

const hasDescription = computed(() => Boolean(pr.value?.body?.trim()))

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
  kind: 'comment' | 'review'
  author: { login: string; avatarUrl: string }
  body: string
  createdAt: string
  reviewState?: PRReviewState
}

const conversationItems = computed<ConversationItem[]>(() => {
  if (!pr.value) return []
  const items: ConversationItem[] = []

  for (const c of pr.value.issueComments) {
    items.push({
      id: `comment:${c.id}`,
      kind: 'comment',
      author: c.author,
      body: c.body,
      createdAt: c.createdAt,
    })
  }

  for (const r of pr.value.reviews) {
    if (r.state === 'PENDING') continue
    if (!r.body.trim()) continue
    items.push({
      id: `review:${r.id}`,
      kind: 'review',
      author: r.author,
      body: r.body,
      createdAt: r.submittedAt ?? pr.value.updatedAt,
      reviewState: r.state,
    })
  }

  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
})

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
  review.reviewedCount > 0 || review.currentStepIndex > 0
    ? 'Continue Guided Tour'
    : 'Start Guided Tour',
)
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
    <section class="stroll-card rounded-2xl border border-border bg-canvas-subtle p-5">
      <div class="flex flex-wrap items-start justify-between gap-4">
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

          <!-- Labels -->
          <div v-if="pr.labels.length > 0" class="flex flex-wrap items-center gap-1.5 pt-1">
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
              {{ label.name }}
            </span>
          </div>
        </div>

        <!-- Primary CTA: Start Guided Tour -->
        <div class="flex shrink-0 flex-col items-end gap-2">
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
        </div>
      </div>
    </section>

    <!-- PR Description -->
    <section class="stroll-card rounded-2xl border border-border bg-canvas-subtle p-5">
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">
        Description
      </h2>
      <MarkdownContent
        v-if="hasDescription && pr"
        :content="pr.body"
        class="text-[13px] leading-relaxed text-ink-secondary"
      />
      <p v-else class="text-xs italic text-ink-faint">
        No description provided.
      </p>
    </section>

    <!-- CI Checks & Reviewers Grid -->
    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <!-- CI / Checks Card (Collapsible) -->
      <section class="stroll-card overflow-hidden rounded-2xl border border-border bg-canvas-subtle">
        <button
          class="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-canvas-elevated/40"
          @click="checksExpanded = !checksExpanded"
        >
          <div class="flex min-w-0 items-center gap-2.5">
            <XCircle
              v-if="checksSummary.failed > 0 || checksSummary.state === 'FAILURE' || checksSummary.state === 'ERROR'"
              class="h-4 w-4 shrink-0 text-crimson"
            />
            <CheckCircle2
              v-else-if="checksSummary.total > 0 && checksSummary.pending === 0"
              class="h-4 w-4 shrink-0 text-pine"
            />
            <CircleDashed
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

          <ChevronDown v-if="checksExpanded" class="h-4 w-4 shrink-0 text-ink-muted" />
          <ChevronRight v-else class="h-4 w-4 shrink-0 text-ink-muted" />
        </button>

        <div v-if="checksExpanded" class="border-t border-border-muted">
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
        </div>
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

            <span
              class="shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium"
              :class="reviewStatusMeta(reviewer.status).class"
            >
              {{ reviewStatusMeta(reviewer.status).label }}
            </span>
          </li>
        </ul>
      </section>
    </div>

    <!-- Commits List -->
    <section class="stroll-card overflow-hidden rounded-2xl border border-border bg-canvas-subtle">
      <button
        class="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-canvas-elevated/40"
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

      <div v-if="commitsExpanded" class="border-t border-border-muted">
        <div v-if="pr.commits.length === 0" class="px-5 py-4 text-xs text-ink-faint">
          No commits loaded.
        </div>
        <ul v-else class="divide-y divide-border-muted">
          <li
            v-for="commit in pr.commits"
            :key="commit.oid"
            class="flex items-center justify-between gap-3 px-5 py-2.5 text-xs"
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
      <div class="flex items-center justify-between border-b border-border-muted px-5 py-3.5">
        <div class="flex items-center gap-2">
          <MessageSquare class="h-4 w-4 text-ink-muted" />
          <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Conversation
          </h2>
          <span class="rounded-full bg-canvas-elevated px-2 py-0.5 font-mono text-[10.5px] text-ink-secondary">
            {{ conversationItems.length }}
          </span>
        </div>
      </div>

      <div v-if="conversationItems.length === 0" class="px-5 py-5 text-xs text-ink-faint">
        No general comments or review summaries yet.
      </div>

      <div v-else class="divide-y divide-border-muted">
        <article
          v-for="item in conversationItems"
          :key="item.id"
          class="space-y-2 px-5 py-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex items-center gap-2">
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
            </div>
            <span class="text-[11px] text-ink-faint">
              {{ formatRelativeTime(item.createdAt) }}
            </span>
          </div>

          <MarkdownContent
            :content="item.body"
            class="text-xs leading-relaxed text-ink-secondary"
          />
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
