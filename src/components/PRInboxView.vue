<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpDown,
  CheckCheck,
  CheckCircle2,
  Clock,
  FileDiff,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  History,
  KeyRound,
  Loader2,
  MessageSquare,
  Moon,
  PenLine,
  Pin,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
  XCircle,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  extractInboxRepos,
  filterAndSortInboxPRs,
  formatLocalProgressBadge,
  prRefKey,
} from '@/services/inbox'
import { checkoutKey, localBranchForPR, type CheckoutTarget } from '@/services/localCheckout'
import { loadAllPRProgress } from '@/services/storage'
import { PR_FILTER_OPTIONS, useAuthStore } from '@/stores/auth'
import { useCheckoutStore } from '@/stores/checkout'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import type {
  CheckRollupState,
  PRInboxSortOption,
  PRLocalProgress,
  PRReviewDecision,
  PRSummary,
} from '@/types/pr'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()
const checkout = useCheckoutStore()

const activeFilterOption = computed(
  () => PR_FILTER_OPTIONS.find((opt) => opt.value === auth.prFilter) ?? PR_FILTER_OPTIONS[0],
)

const urlInput = ref('')
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const selectedRepo = ref('all')
const sortBy = ref<PRInboxSortOption>('updated-desc')
const lastRefreshedAt = ref<Date | null>(auth.isAuthenticated ? new Date() : null)
const selectedIndex = ref(-1)
const prProgress = ref<Record<string, PRLocalProgress>>({})
const cardRefs = new Map<number, HTMLElement>()
let pollTimer: number | null = null

const sortOptions: ReadonlyArray<{ value: PRInboxSortOption; label: string }> = [
  { value: 'updated-desc', label: 'Recently Updated' },
  { value: 'updated-asc', label: 'Oldest Updated' },
  { value: 'diff-asc', label: 'Smallest Diff' },
  { value: 'diff-desc', label: 'Largest Diff' },
]

const availableRepos = computed(() => extractInboxRepos(auth.requestedPRs))

const filteredPRs = computed(() =>
  filterAndSortInboxPRs(auth.requestedPRs, {
    query: searchQuery.value,
    repo: selectedRepo.value,
    sort: sortBy.value,
  }),
)

// Mirror the outgoing list's length (capped) so the skeleton doesn't make the page jump.
const skeletonRowCount = computed(() =>
  Math.min(Math.max(filteredPRs.value.length, 3), 5),
)

const hasActiveFilters = computed(
  () => searchQuery.value.trim().length > 0 || selectedRepo.value !== 'all',
)

watch(availableRepos, (repos) => {
  if (selectedRepo.value !== 'all' && !repos.includes(selectedRepo.value)) {
    selectedRepo.value = 'all'
  }
})

function clearInboxFilters() {
  searchQuery.value = ''
  selectedRepo.value = 'all'
}

const hasUnpinnedRecent = computed(() => review.recentPRs.some((item) => !item.pinned))

async function refreshLocalProgress() {
  prProgress.value = await loadAllPRProgress()
}

function localProgressFor(item: PRSummary) {
  return formatLocalProgressBadge(prProgress.value[prRefKey(item)], item.changedFiles)
}

function setCardRef(index: number, el: unknown) {
  if (el instanceof HTMLElement) {
    cardRefs.set(index, el)
  } else {
    cardRefs.delete(index)
  }
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

function focusSearchBar() {
  const input = searchInputRef.value
  if (!input) return
  input.focus()
  input.select()
}

function scrollSelectedIntoView() {
  void nextTick(() => {
    const el = cardRefs.get(selectedIndex.value)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function moveSelection(delta: 1 | -1) {
  const len = filteredPRs.value.length
  if (len === 0) {
    selectedIndex.value = -1
    return
  }
  if (selectedIndex.value < 0) {
    selectedIndex.value = delta > 0 ? 0 : len - 1
  } else {
    selectedIndex.value = Math.max(0, Math.min(len - 1, selectedIndex.value + delta))
  }
  scrollSelectedIntoView()
}

function handleInboxKeydown(e: KeyboardEvent) {
  if (review.screen !== 'inbox') return
  if (settings.isOpen || review.isLoadingPR || review.showLoaderModal || review.showFinishModal) {
    return
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    focusSearchBar()
    return
  }

  const inSearchInput =
    searchInputRef.value !== null && document.activeElement === searchInputRef.value

  if (inSearchInput) {
    if (e.key === 'Escape') {
      e.preventDefault()
      searchInputRef.value?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelection(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelection(-1)
      return
    }
    if (e.key === 'Enter' && selectedIndex.value >= 0) {
      const targetPR = filteredPRs.value[selectedIndex.value]
      if (targetPR) {
        e.preventDefault()
        openInboxItem(targetPR)
      }
    }
    return
  }

  if (isEditableElement(e.target) || e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === '/') {
    e.preventDefault()
    focusSearchBar()
    return
  }

  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
    e.preventDefault()
    moveSelection(1)
    return
  }

  if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
    e.preventDefault()
    moveSelection(-1)
    return
  }

  if (e.key === 'Enter' && selectedIndex.value >= 0) {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return
    const targetPR = filteredPRs.value[selectedIndex.value]
    if (targetPR) {
      e.preventDefault()
      openInboxItem(targetPR)
    }
  }
}

const autoRefreshLabel = computed(() => {
  const sec = settings.inboxAutoRefreshSeconds
  if (sec <= 0) return 'Auto-refresh off'
  if (sec >= 60 && sec % 60 === 0) return `Auto-refreshes every ${sec / 60}m`
  return `Auto-refreshes every ${sec}s`
})

function resetPollTimer() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
  const sec = settings.inboxAutoRefreshSeconds
  if (sec > 0) {
    pollTimer = window.setInterval(() => {
      if (auth.isAuthenticated && !auth.isLoading) {
        void handleRefresh(true)
      }
    }, sec * 1000)
  }
}

async function handleRefresh(isAutoRefresh = false) {
  if (!auth.isAuthenticated || auth.isLoading) return
  await auth.refreshRequestedPRs({ notifyOnNew: isAutoRefresh, showLoading: !isAutoRefresh })
  lastRefreshedAt.value = new Date()
}

function ciStatusMeta(state: CheckRollupState | null): {
  label: string
  dotClass: string
  kind: 'success' | 'failure' | 'pending'
} | null {
  switch (state) {
    case 'SUCCESS':
      return { label: 'CI checks passing', dotClass: 'text-pine-text', kind: 'success' }
    case 'FAILURE':
    case 'ERROR':
      return { label: 'CI checks failing', dotClass: 'text-crimson-text', kind: 'failure' }
    case 'PENDING':
    case 'EXPECTED':
      return { label: 'CI checks pending', dotClass: 'text-ochre-text', kind: 'pending' }
    default:
      return null
  }
}

function reviewDecisionMeta(decision: PRReviewDecision): {
  label: string
  badgeClass: string
} | null {
  switch (decision) {
    case 'APPROVED':
      return {
        label: 'Approved',
        badgeClass: 'border-pine-border bg-pine-soft text-pine-text',
      }
    case 'CHANGES_REQUESTED':
      return {
        label: 'Changes requested',
        badgeClass: 'border-crimson-border bg-crimson-soft text-crimson-text',
      }
    case 'REVIEW_REQUIRED':
      return {
        label: 'Review required',
        badgeClass: 'border-ochre-border bg-ochre-soft text-ochre-text',
      }
    default:
      return null
  }
}

function openInboxItem(item: PRSummary) {
  if (review.isLoadingPR) return
  void review.loadPRByRepo(item.owner, item.repo, item.number)
}

function checkoutTargetFor(item: PRSummary): CheckoutTarget {
  return {
    owner: item.owner,
    repo: item.repo,
    number: item.number,
    headRefName: item.headRefName,
    isCrossRepository: item.isCrossRepository,
  }
}

/** Gated on the desktop app and a linked local checkout of the PR's repository. */
function canCheckout(item: PRSummary): boolean {
  return checkout.isAvailable() && Boolean(item.headRefName) && checkout.isLinked(item.owner, item.repo)
}

function checkoutBlockedReason(item: PRSummary): string | null {
  const dirty = checkout.statusFor(item.owner, item.repo)?.dirtyFiles ?? []
  if (dirty.length === 0) return null
  return `Commit or stash uncommitted changes in ${checkout.repoPathFor(item.owner, item.repo)} first:\n${dirty.slice(0, 10).join('\n')}`
}

function refreshCheckoutStatuses() {
  if (checkout.isAvailable() && !checkout.busyKey) void checkout.refreshStatuses(auth.requestedPRs)
}

async function handleLoadUrl() {
  if (!urlInput.value.trim()) return
  await review.loadPRByUrl(urlInput.value)
}

function isItemLoading(owner: string, repo: string, number: number): boolean {
  return review.isLoadingPR && review.loadingPRKey === `${owner}/${repo}#${number}`
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.max(1, Math.floor(diffMs / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

onMounted(() => {
  if (auth.isAuthenticated && !lastRefreshedAt.value) {
    lastRefreshedAt.value = new Date()
  }
  resetPollTimer()
  void refreshLocalProgress()
  window.addEventListener('focus', refreshCheckoutStatuses)
  window.addEventListener('keydown', handleInboxKeydown)
})

watch([() => auth.requestedPRs, () => review.repoPaths], refreshCheckoutStatuses, { immediate: true })

watch(
  () => review.screen,
  (nextScreen) => {
    if (nextScreen === 'inbox') {
      void refreshLocalProgress()
    }
  },
)

watch(filteredPRs, (list) => {
  if (list.length === 0) {
    selectedIndex.value = -1
  } else if (selectedIndex.value >= list.length) {
    selectedIndex.value = list.length - 1
  }
})

watch(searchQuery, () => {
  if (searchInputRef.value && document.activeElement === searchInputRef.value) {
    selectedIndex.value = filteredPRs.value.length > 0 ? 0 : -1
  }
})

watch(
  () => settings.inboxAutoRefreshSeconds,
  () => {
    resetPollTimer()
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshCheckoutStatuses)
  window.removeEventListener('keydown', handleInboxKeydown)
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
    <!-- Top Header -->
    <header class="shrink-0 border-b border-border bg-canvas-subtle">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div class="flex items-center gap-2.5">
          <img
            src="/logo.svg"
            alt="Stroll"
            class="h-8 w-8 rounded-lg shadow-xs"
          />
          <div>
            <span class="text-sm font-bold tracking-tight text-ink">Stroll</span>
            <span class="ml-2 hidden text-xs text-ink-muted sm:inline">Review Inbox</span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="auth.isAuthenticated"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-50"
            :disabled="auth.isLoading"
            :aria-busy="auth.isLoading"
            title="Refresh pending PRs"
            @click="handleRefresh(false)"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': auth.isLoading }" />
            <span>Refresh</span>
          </button>

          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated"
            title="Link local repository checkouts for AST & git blame"
            @click="settings.openSettings('repositories')"
          >
            <FolderGit2 class="h-3.5 w-3.5 text-pine" />
            <span>Local Repos</span>
            <span
              v-if="Object.keys(review.repoPaths).length > 0"
              class="rounded-full bg-pine-soft px-1.5 py-0.5 font-mono text-[10px] font-medium text-pine-text"
            >
              {{ Object.keys(review.repoPaths).length }}
            </span>
          </button>

          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs transition-colors hover:bg-canvas-elevated"
            :class="auth.isAuthenticated ? 'text-pine-text' : 'text-ink-secondary'"
            @click="settings.openSettings('github')"
          >
            <KeyRound class="h-3.5 w-3.5" />
            <span>{{ auth.viewer ? `@${auth.viewer.login}` : 'Connect GitHub' }}</span>
          </button>

          <button
            class="rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            :title="settings.resolvedTheme === 'dark' ? 'Switch to Warm Light theme' : 'Switch to Deep Pine Dark theme'"
            @click="settings.toggleTheme()"
          >
            <Sun v-if="settings.resolvedTheme === 'dark'" class="h-4 w-4 text-terra" />
            <Moon v-else class="h-4 w-4 text-pine" />
          </button>

          <button
            class="rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            title="Settings (⌘,)"
            @click="settings.openSettings('general')"
          >
            <Settings class="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>

    <!-- Main Inbox Content -->
    <main class="flex-1 overflow-y-auto px-6 py-8">
      <div class="mx-auto max-w-5xl space-y-8">
        <!-- Quick Load by URL -->
        <section class="stroll-card rounded-2xl border border-border bg-canvas-subtle p-5">
          <label class="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Open any Pull Request by URL
          </label>
          <div class="mt-2.5 flex gap-2.5">
            <input
              v-model="urlInput"
              type="url"
              :disabled="review.isLoadingPR"
              :placeholder="`https://${settings.githubHost}/owner/repo/pull/123`"
              class="flex-1 rounded-xl border border-border bg-canvas-inset px-3.5 py-2 font-mono text-xs text-ink placeholder-ink-faint transition-colors focus:border-terra focus:outline-none disabled:opacity-60"
              @keydown.enter="handleLoadUrl"
            />
            <button
              class="inline-flex items-center gap-1.5 rounded-xl bg-terra px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98] disabled:opacity-40"
              :disabled="review.isLoadingPR || !urlInput.trim()"
              :aria-busy="review.isLoadingPR"
              @click="handleLoadUrl"
            >
              <Loader2 v-if="review.isLoadingPR" class="h-3.5 w-3.5 animate-spin" />
              <span>{{ review.isLoadingPR ? 'Loading…' : 'Start Tour' }}</span>
              <ArrowRight v-if="!review.isLoadingPR" class="h-3.5 w-3.5" />
            </button>
          </div>
          <p v-if="review.prError" class="mt-2 text-xs text-crimson-text">{{ review.prError }}</p>
        </section>

        <!-- Recently Viewed / Pinned PRs -->
        <section v-if="review.recentPRs.length > 0" class="space-y-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <History class="h-4 w-4 text-pine" />
              <h2 class="text-sm font-semibold text-ink">Recently Viewed</h2>
              <span
                class="rounded-full bg-sage-soft px-2 py-0.5 font-mono text-[11px] font-medium text-sage-text"
              >
                {{ review.recentPRs.length }}
              </span>
            </div>
            <button
              v-if="hasUnpinnedRecent"
              type="button"
              class="text-[11px] text-ink-muted transition-colors hover:text-ink"
              @click="review.clearRecentPRs()"
            >
              Clear unpinned
            </button>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            <div
              v-for="(entry, index) in review.recentPRs"
              :key="prRefKey(entry.summary)"
              role="button"
              :tabindex="review.isLoadingPR ? -1 : 0"
              class="stroll-card group flex items-center justify-between gap-3 rounded-xl border border-border bg-canvas-subtle px-3.5 py-2.5 text-left transition-all hover:border-terra-border hover:bg-canvas-elevated/50 focus:outline-none focus-visible:border-terra-border"
              :class="{
                'cursor-not-allowed opacity-60': review.isLoadingPR,
                'cursor-pointer': !review.isLoadingPR,
                'sm:col-span-2': review.recentPRs.length % 2 === 1 && index === review.recentPRs.length - 1,
              }"
              :aria-disabled="review.isLoadingPR"
              @click="openInboxItem(entry.summary)"
              @keydown.enter.self.prevent="openInboxItem(entry.summary)"
              @keydown.space.self.prevent="openInboxItem(entry.summary)"
            >
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="font-mono text-[11px] font-medium text-terra-text">
                    {{ entry.summary.owner }}/{{ entry.summary.repo }}#{{ entry.summary.number }}
                  </span>
                  <span class="text-[11px] text-ink-faint">·</span>
                  <span class="text-[11px] text-ink-muted">@{{ entry.summary.author.login }}</span>
                  <span class="text-[11px] text-ink-faint">·</span>
                  <span class="text-[11px] text-ink-faint">{{ formatRelativeTime(entry.viewedAt) }}</span>

                  <span
                    v-if="localProgressFor(entry.summary).draftLabel"
                    class="inline-flex items-center gap-1 rounded-full border border-ochre-border bg-ochre-soft px-1.5 py-0.5 text-[10px] font-medium text-ochre-text"
                  >
                    <PenLine class="h-2.5 w-2.5" />
                    <span>{{ localProgressFor(entry.summary).draftLabel }}</span>
                  </span>

                  <span
                    v-if="localProgressFor(entry.summary).reviewLabel"
                    class="inline-flex items-center gap-1 rounded-full border border-pine-border bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine-text"
                  >
                    <CheckCheck class="h-2.5 w-2.5" />
                    <span>{{ localProgressFor(entry.summary).reviewLabel }}</span>
                  </span>
                </div>
                <div class="truncate text-xs font-medium text-ink">
                  {{ entry.summary.title }}
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1" @click.stop>
                <button
                  type="button"
                  class="rounded-lg p-1 transition-colors"
                  :class="
                    entry.pinned
                      ? 'bg-terra-soft text-terra-text hover:bg-terra-soft/80'
                      : 'text-ink-faint opacity-0 hover:bg-canvas-elevated hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100'
                  "
                  :title="entry.pinned ? 'Unpin PR' : 'Pin PR'"
                  :aria-label="entry.pinned ? 'Unpin PR' : 'Pin PR'"
                  @click="review.togglePinRecentPR(entry.summary)"
                  @keydown.stop
                >
                  <Pin class="h-3.5 w-3.5" :class="{ 'fill-current': entry.pinned }" />
                </button>
                <button
                  type="button"
                  class="rounded-lg p-1 text-ink-faint opacity-0 transition-colors hover:bg-canvas-elevated hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100"
                  title="Remove from recently viewed"
                  aria-label="Remove from recently viewed"
                  @click="review.removeRecentPR(entry.summary)"
                  @keydown.stop
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Pull Request List -->
        <section class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <GitPullRequest class="h-4 w-4 text-terra" />
              <h2 class="text-sm font-semibold text-ink">{{ activeFilterOption.heading }}</h2>
              <span
                v-if="auth.isAuthenticated"
                class="rounded-full bg-sage-soft px-2 py-0.5 font-mono text-[11px] font-medium text-sage-text"
              >
                <Loader2
                  v-if="auth.isReloadingList"
                  class="h-3 w-3 animate-spin"
                  aria-label="Loading pull requests"
                />
                <template v-else-if="hasActiveFilters">
                  {{ filteredPRs.length }} / {{ auth.requestedPRs.length }}
                </template>
                <template v-else>
                  {{ auth.requestedPRs.length }}
                </template>
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <div
                v-if="auth.isAuthenticated"
                class="inline-flex rounded-xl border border-border bg-canvas-inset p-0.5"
                role="tablist"
                aria-label="Filter pull requests"
              >
                <button
                  v-for="opt in PR_FILTER_OPTIONS"
                  :key="opt.value"
                  type="button"
                  role="tab"
                  :aria-selected="auth.prFilter === opt.value"
                  :disabled="auth.isLoading"
                  class="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60"
                  :class="
                    auth.prFilter === opt.value
                      ? 'bg-canvas-subtle text-ink shadow-xs'
                      : 'text-ink-muted hover:text-ink'
                  "
                  @click="auth.setPrFilter(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>

              <div
                v-if="auth.isAuthenticated"
                class="flex items-center gap-2 text-[11px] text-ink-faint"
              >
                <Clock class="h-3 w-3" />
                <span>
                  {{ autoRefreshLabel }}
                  <template v-if="lastRefreshedAt && settings.inboxAutoRefreshSeconds > 0">
                    · Updated {{ lastRefreshedAt.toLocaleTimeString() }}
                  </template>
                </span>
              </div>
            </div>
          </div>

          <!-- Unauthenticated Onboarding Card -->
          <div
            v-if="!auth.isAuthenticated"
            class="stroll-card rounded-2xl border border-dashed border-border bg-canvas-subtle/80 p-8 text-center"
          >
            <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sage-soft text-pine-text">
              <KeyRound class="h-6 w-6" />
            </div>
            <h3 class="mt-3.5 text-sm font-semibold text-ink">
              Connect GitHub to see PRs awaiting your review
            </h3>
            <p class="mx-auto mt-1 max-w-md text-xs text-ink-muted">
              Add a GitHub Personal Access Token (PAT) to automatically fetch open pull requests
              where you are requested as a reviewer.
            </p>
            <div class="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                class="inline-flex items-center gap-1.5 rounded-xl bg-terra px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98]"
                @click="settings.openSettings('github')"
              >
                <KeyRound class="h-3.5 w-3.5" />
                <span>Connect GitHub PAT</span>
              </button>
              <button
                class="inline-flex items-center gap-1.5 rounded-xl border border-ochre-border bg-ochre-soft px-4 py-2 text-xs font-medium text-ochre-text transition-colors hover:bg-canvas-elevated"
                @click="review.loadMockPR()"
              >
                <Sparkles class="h-3.5 w-3.5" />
                <span>Try Interactive Demo PR</span>
              </button>
            </div>
          </div>

          <!-- Reload Skeleton (filter switch / manual refresh) -->
          <div
            v-else-if="auth.isReloadingList"
            class="space-y-2.5"
            role="status"
            aria-live="polite"
            :aria-label="`Loading ${activeFilterOption.label} pull requests`"
          >
            <div
              v-for="n in skeletonRowCount"
              :key="n"
              class="stroll-card relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-border bg-canvas-subtle px-4 py-3.5"
              :style="{ opacity: 1 - (n - 1) * 0.18 }"
              aria-hidden="true"
            >
              <div class="min-w-0 flex-1 space-y-2">
                <div class="flex items-center gap-2">
                  <div class="h-3 w-32 rounded bg-canvas-inset" />
                  <div class="h-3 w-16 rounded bg-canvas-inset" />
                </div>
                <div class="h-3.5 rounded bg-canvas-inset" :class="n % 2 ? 'w-3/4' : 'w-1/2'" />
                <div class="flex items-center gap-2">
                  <div class="h-2.5 w-20 rounded bg-canvas-inset" />
                  <div class="h-2.5 w-12 rounded bg-canvas-inset" />
                </div>
              </div>
              <div class="h-6 w-16 shrink-0 rounded-lg bg-canvas-inset" />
              <div
                class="animate-shimmer pointer-events-none absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-transparent via-canvas-elevated/60 to-transparent"
              />
            </div>
          </div>

          <!-- Empty Inbox -->
          <div
            v-else-if="auth.requestedPRs.length === 0"
            class="stroll-card animate-pop-in rounded-2xl border border-border bg-canvas-subtle/80 p-8 text-center"
          >
            <p class="text-sm font-medium text-ink-secondary">{{ activeFilterOption.emptyMessage }}</p>
            <p class="mt-1 text-xs text-ink-muted">
              Paste any PR URL above or try the offline demo tour.
            </p>
            <button
              class="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-ochre-border bg-ochre-soft px-3.5 py-1.5 text-xs font-medium text-ochre-text transition-colors hover:bg-canvas-elevated"
              @click="review.loadMockPR()"
            >
              <Sparkles class="h-3.5 w-3.5" />
              <span>Try Interactive Demo PR</span>
            </button>
          </div>

          <!-- PR List -->
          <div v-else class="animate-pop-in space-y-3">
            <!-- Lightweight Search, Repo Filter & Sort Bar -->
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div class="relative flex-1">
                <Search
                  class="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
                />
                <input
                  ref="searchInputRef"
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search title, #number, owner/repo, or @author…"
                  class="w-full rounded-xl border border-border bg-canvas-subtle py-1.5 pr-16 pl-8 text-xs text-ink placeholder-ink-faint transition-colors focus:border-terra focus:outline-none"
                />
                <div
                  v-if="!searchQuery"
                  class="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1 text-[10px] text-ink-faint"
                >
                  <kbd class="rounded border border-border bg-canvas-inset px-1 font-mono">/</kbd>
                  <kbd class="rounded border border-border bg-canvas-inset px-1 font-mono">⌘K</kbd>
                </div>
                <button
                  v-if="searchQuery"
                  type="button"
                  class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-ink"
                  title="Clear search"
                  @click="searchQuery = ''"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>

              <div class="flex items-center gap-2">
                <select
                  v-model="selectedRepo"
                  aria-label="Filter by repository"
                  class="rounded-xl border border-border bg-canvas-subtle px-2.5 py-1.5 text-xs text-ink-secondary transition-colors focus:border-terra focus:outline-none"
                >
                  <option value="all">All repos</option>
                  <option v-for="repo in availableRepos" :key="repo" :value="repo">
                    {{ repo }}
                  </option>
                </select>

                <div class="relative flex items-center">
                  <ArrowUpDown
                    class="pointer-events-none absolute left-2.5 h-3 w-3 text-ink-faint"
                  />
                  <select
                    v-model="sortBy"
                    aria-label="Sort pull requests"
                    class="rounded-xl border border-border bg-canvas-subtle py-1.5 pr-2.5 pl-7 text-xs text-ink-secondary transition-colors focus:border-terra focus:outline-none"
                  >
                    <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Filtered Empty State -->
            <div
              v-if="filteredPRs.length === 0"
              class="stroll-card rounded-2xl border border-border bg-canvas-subtle/80 p-6 text-center"
            >
              <p class="text-xs font-medium text-ink-secondary">
                No pull requests match your current search or repository filter.
              </p>
              <button
                type="button"
                class="mt-3 inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-3 py-1 text-xs font-medium text-ink-secondary hover:bg-canvas-elevated"
                @click="clearInboxFilters"
              >
                <X class="h-3 w-3" />
                <span>Clear filters</span>
              </button>
            </div>

            <div v-else class="space-y-2.5">
              <div
                v-for="(item, idx) in filteredPRs"
                :key="item.id"
                :ref="(el) => setCardRef(idx, el)"
                role="button"
                :tabindex="review.isLoadingPR ? -1 : 0"
                class="stroll-card group flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3.5 text-left transition-all focus:outline-none focus-visible:border-terra-border"
                :class="
                  isItemLoading(item.owner, item.repo, item.number)
                    ? 'cursor-wait border-terra-border bg-terra-soft/20'
                    : review.isLoadingPR
                      ? 'cursor-not-allowed border-border bg-canvas-subtle opacity-60'
                      : selectedIndex === idx
                        ? 'cursor-pointer border-terra-border bg-terra-soft/15 ring-1 ring-terra-border/60'
                        : 'cursor-pointer border-border bg-canvas-subtle hover:border-terra-border hover:bg-canvas-elevated/50'
                "
                :aria-disabled="review.isLoadingPR"
                :aria-busy="isItemLoading(item.owner, item.repo, item.number)"
                :aria-selected="selectedIndex === idx"
                @click="openInboxItem(item)"
                @keydown.enter.self.prevent="openInboxItem(item)"
                @keydown.space.self.prevent="openInboxItem(item)"
              >
                <div class="min-w-0 space-y-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-mono text-xs font-medium text-terra-text">
                      {{ item.owner }}/{{ item.repo }}#{{ item.number }}
                    </span>
                    <span class="text-xs text-ink-faint">·</span>
                    <span class="text-xs text-ink-muted">@{{ item.author.login }}</span>
                    <span class="text-xs text-ink-faint">·</span>
                    <span class="text-xs text-ink-faint">{{ formatRelativeTime(item.updatedAt) }}</span>

                    <!-- Draft pill -->
                    <span
                      v-if="item.isDraft"
                      class="rounded-full border border-border bg-canvas-inset px-1.5 py-0.5 text-[10px] font-medium text-ink-muted"
                    >
                      Draft
                    </span>

                    <!-- Review decision badge -->
                    <span
                      v-if="reviewDecisionMeta(item.reviewDecision)"
                      class="rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                      :class="reviewDecisionMeta(item.reviewDecision)!.badgeClass"
                    >
                      {{ reviewDecisionMeta(item.reviewDecision)!.label }}
                    </span>

                    <!-- CI check rollup status -->
                    <span
                      v-if="ciStatusMeta(item.ciState)"
                      class="inline-flex items-center"
                      :class="ciStatusMeta(item.ciState)!.dotClass"
                      :title="ciStatusMeta(item.ciState)!.label"
                    >
                      <CheckCircle2
                        v-if="ciStatusMeta(item.ciState)!.kind === 'success'"
                        class="h-3.5 w-3.5"
                      />
                      <XCircle
                        v-else-if="ciStatusMeta(item.ciState)!.kind === 'failure'"
                        class="h-3.5 w-3.5"
                      />
                      <Clock v-else class="h-3.5 w-3.5" />
                    </span>

                    <!-- Comment count -->
                    <span
                      v-if="item.totalCommentsCount > 0"
                      class="inline-flex items-center gap-0.5 text-[11px] text-ink-muted"
                      :title="`${item.totalCommentsCount} comment${item.totalCommentsCount === 1 ? '' : 's'}`"
                    >
                      <MessageSquare class="h-3 w-3 text-ink-faint" />
                      <span>{{ item.totalCommentsCount }}</span>
                    </span>

                    <!-- Local unsent drafts badge -->
                    <span
                      v-if="localProgressFor(item).draftLabel"
                      class="inline-flex items-center gap-1 rounded-full border border-ochre-border bg-ochre-soft px-1.5 py-0.5 text-[10px] font-medium text-ochre-text"
                      title="Unsent local draft comments"
                    >
                      <PenLine class="h-2.5 w-2.5" />
                      <span>{{ localProgressFor(item).draftLabel }}</span>
                    </span>

                    <!-- Local review progress badge -->
                    <span
                      v-if="localProgressFor(item).reviewLabel"
                      class="inline-flex items-center gap-1 rounded-full border border-pine-border bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine-text"
                      title="Local review progress"
                    >
                      <CheckCheck class="h-2.5 w-2.5" />
                      <span>{{ localProgressFor(item).reviewLabel }}</span>
                    </span>
                  </div>
                  <div class="truncate text-sm font-medium text-ink">
                    {{ item.title }}
                  </div>
                  <div
                    v-if="checkout.errorByPR[checkoutKey(item)] || checkout.messageByPR[checkoutKey(item)]"
                    class="flex items-start gap-1 text-[11px]"
                    :class="checkout.errorByPR[checkoutKey(item)] ? 'text-crimson-text' : 'text-pine-text'"
                    @click.stop
                  >
                    <span class="min-w-0 whitespace-pre-line break-words">{{
                      checkout.errorByPR[checkoutKey(item)] ?? checkout.messageByPR[checkoutKey(item)]
                    }}</span>
                    <button
                      type="button"
                      class="shrink-0 opacity-70 hover:opacity-100"
                      title="Dismiss"
                      @click.stop="checkout.dismiss(item)"
                    >
                      <X class="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-4">
                  <template v-if="canCheckout(item)">
                    <span
                      v-if="checkout.stateFor(checkoutTargetFor(item))?.kind === 'on-pr'"
                      class="inline-flex items-center gap-1 rounded-lg border border-pine-border bg-pine-soft px-2 py-1 text-[11px] font-medium text-pine-text"
                      :title="`${localBranchForPR(item)} is checked out in ${checkout.repoPathFor(item.owner, item.repo)}`"
                    >
                      <GitBranch class="h-3 w-3" />
                      <span>Checked out</span>
                    </span>
                    <button
                      v-else
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink-secondary transition-all hover:border-terra-border hover:text-terra-text focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                      :class="checkout.busyKey === checkoutKey(item) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'"
                      :disabled="!!checkout.busyKey || checkoutBlockedReason(item) !== null"
                      :title="checkoutBlockedReason(item) ?? `Check out ${localBranchForPR(item)} in ${checkout.repoPathFor(item.owner, item.repo)}`"
                      @click.stop="checkout.checkout(checkoutTargetFor(item))"
                      @keydown.stop
                    >
                      <Loader2 v-if="checkout.busyKey === checkoutKey(item)" class="h-3 w-3 animate-spin" />
                      <GitBranch v-else class="h-3 w-3" />
                      <span>{{ checkout.busyKey === checkoutKey(item) ? 'Checking out…' : 'Check out' }}</span>
                    </button>
                  </template>
                  <div class="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex">
                    <FileDiff class="h-3.5 w-3.5 text-ink-faint" />
                    <span>{{ item.changedFiles }} files</span>
                  </div>
                  <div class="font-mono text-xs">
                    <span class="text-pine-text">+{{ item.additions }}</span>
                    <span class="mx-1 text-ink-faint">/</span>
                    <span class="text-crimson-text">-{{ item.deletions }}</span>
                  </div>
                  <span
                    class="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
                    :class="
                      isItemLoading(item.owner, item.repo, item.number)
                        ? 'border-terra-border bg-terra-soft text-terra-text'
                        : 'border-border bg-canvas text-ink-secondary group-hover:border-terra-border group-hover:bg-terra-soft group-hover:text-terra-text'
                    "
                  >
                    <Loader2
                      v-if="isItemLoading(item.owner, item.repo, item.number)"
                      class="h-3 w-3 animate-spin"
                    />
                    <span>{{ isItemLoading(item.owner, item.repo, item.number) ? 'Loading…' : 'Review' }}</span>
                    <ArrowRight
                      v-if="!isItemLoading(item.owner, item.repo, item.number)"
                      class="h-3 w-3"
                    />
                  </span>
                </div>
              </div>
            </div>

            <!-- Load More Pagination & Demo PR Quick Access -->
            <div class="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div>
                <button
                  v-if="auth.hasMorePRs"
                  class="inline-flex items-center gap-1.5 rounded-xl border border-border bg-canvas-subtle px-3.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-terra-border hover:bg-canvas-elevated hover:text-ink disabled:opacity-50"
                  :disabled="auth.isLoadingMore"
                  :aria-busy="auth.isLoadingMore"
                  @click="auth.loadMorePRs()"
                >
                  <Loader2 v-if="auth.isLoadingMore" class="h-3.5 w-3.5 animate-spin" />
                  <span>{{ auth.isLoadingMore ? 'Loading more…' : 'Load more PRs' }}</span>
                </button>
              </div>
              <div class="flex flex-wrap items-center gap-4">
                <span
                  v-if="filteredPRs.length > 0"
                  class="hidden items-center gap-2 text-[11px] text-ink-faint sm:inline-flex"
                >
                  <span><kbd class="rounded border border-border bg-canvas-subtle px-1 font-mono text-ink-secondary">J</kbd>/<kbd class="rounded border border-border bg-canvas-subtle px-1 font-mono text-ink-secondary">K</kbd> or <kbd class="rounded border border-border bg-canvas-subtle px-1 font-mono text-ink-secondary">↑</kbd>/<kbd class="rounded border border-border bg-canvas-subtle px-1 font-mono text-ink-secondary">↓</kbd> Navigate</span>
                  <span>·</span>
                  <span><kbd class="rounded border border-border bg-canvas-subtle px-1 font-mono text-ink-secondary">Enter</kbd> Open</span>
                  <span>·</span>
                  <span><kbd class="rounded border border-border bg-canvas-subtle px-1 font-mono text-ink-secondary">/</kbd> or <kbd class="rounded border border-border bg-canvas-subtle px-1 font-mono text-ink-secondary">⌘K</kbd> Search</span>
                </span>
                <button
                  class="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-terra-text"
                  @click="review.loadMockPR()"
                >
                  <Sparkles class="h-3.5 w-3.5" />
                  <span>Open Interactive Demo PR</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>

    <!-- Loading PR Overlay -->
    <Transition name="modal-pop">
      <div
        v-if="review.isLoadingPR"
        role="status"
        aria-live="polite"
        class="stroll-backdrop fixed inset-0 z-40 flex items-center justify-center p-4 backdrop-blur-[2px]"
      >
        <div
          class="stroll-elevated flex w-full max-w-sm flex-col items-center rounded-2xl border border-border bg-canvas-subtle px-6 py-7 text-center"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-terra-soft text-terra">
            <Loader2 class="h-6 w-6 animate-spin" />
          </div>
          <h3 class="mt-4 text-sm font-semibold text-ink">Opening Pull Request…</h3>
          <p v-if="review.loadingPRKey" class="mt-1 font-mono text-xs text-terra-text">
            {{ review.loadingPRKey }}
          </p>
          <p class="mt-1.5 text-xs text-ink-muted">
            Fetching files, diffs, and building tour order…
          </p>
        </div>
      </div>
    </Transition>
  </div>
</template>
