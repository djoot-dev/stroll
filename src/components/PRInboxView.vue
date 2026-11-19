<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  FileDiff,
  FolderGit2,
  GitPullRequest,
  KeyRound,
  Loader2,
  MessageSquare,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
  XCircle,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { extractInboxRepos, filterAndSortInboxPRs } from '@/services/inbox'
import { PR_FILTER_OPTIONS, useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import type { CheckRollupState, PRInboxSortOption, PRReviewDecision } from '@/types/pr'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()

const activeFilterOption = computed(
  () => PR_FILTER_OPTIONS.find((opt) => opt.value === auth.prFilter) ?? PR_FILTER_OPTIONS[0],
)

const urlInput = ref('')
const searchQuery = ref('')
const selectedRepo = ref('all')
const sortBy = ref<PRInboxSortOption>('updated-desc')
const lastRefreshedAt = ref<Date | null>(auth.isAuthenticated ? new Date() : null)
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
  await auth.refreshRequestedPRs({ notifyOnNew: isAutoRefresh })
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

async function handleLoadUrl() {
  if (!urlInput.value.trim()) return
  await review.loadPRByUrl(urlInput.value)
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
})

watch(
  () => settings.inboxAutoRefreshSeconds,
  () => {
    resetPollTimer()
  },
)

onBeforeUnmount(() => {
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
              :placeholder="`https://${settings.githubHost}/owner/repo/pull/123`"
              class="flex-1 rounded-xl border border-border bg-canvas-inset px-3.5 py-2 font-mono text-xs text-ink placeholder-ink-faint transition-colors focus:border-terra focus:outline-none"
              @keydown.enter="handleLoadUrl"
            />
            <button
              class="inline-flex items-center gap-1.5 rounded-xl bg-terra px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98] disabled:opacity-40"
              :disabled="review.isLoadingPR || !urlInput.trim()"
              @click="handleLoadUrl"
            >
              <Loader2 v-if="review.isLoadingPR" class="h-3.5 w-3.5 animate-spin" />
              <span>Start Tour</span>
              <ArrowRight v-if="!review.isLoadingPR" class="h-3.5 w-3.5" />
            </button>
          </div>
          <p v-if="review.prError" class="mt-2 text-xs text-crimson-text">{{ review.prError }}</p>
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
                <template v-if="hasActiveFilters">
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

          <!-- Empty Inbox -->
          <div
            v-else-if="auth.requestedPRs.length === 0"
            class="stroll-card rounded-2xl border border-border bg-canvas-subtle/80 p-8 text-center"
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
          <div v-else class="space-y-3">
            <!-- Lightweight Search, Repo Filter & Sort Bar -->
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div class="relative flex-1">
                <Search
                  class="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
                />
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search title, #number, owner/repo, or @author…"
                  class="w-full rounded-xl border border-border bg-canvas-subtle py-1.5 pr-8 pl-8 text-xs text-ink placeholder-ink-faint transition-colors focus:border-terra focus:outline-none"
                />
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
              <button
                v-for="item in filteredPRs"
                :key="item.id"
                class="stroll-card group flex w-full items-center justify-between gap-4 rounded-2xl border border-border bg-canvas-subtle px-4 py-3.5 text-left transition-all hover:border-terra-border hover:bg-canvas-elevated/50"
                :disabled="review.isLoadingPR"
                @click="review.loadPRByRepo(item.owner, item.repo, item.number)"
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
                  </div>
                  <div class="truncate text-sm font-medium text-ink">
                    {{ item.title }}
                  </div>
                </div>

                <div class="flex shrink-0 items-center gap-4">
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
                    class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors group-hover:border-terra-border group-hover:bg-terra-soft group-hover:text-terra-text"
                  >
                    <span>Review</span>
                    <ArrowRight class="h-3 w-3" />
                  </span>
                </div>
              </button>
            </div>

            <!-- Demo PR Quick Access -->
            <div class="flex justify-end pt-2">
              <button
                class="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-terra-text"
                @click="review.loadMockPR()"
              >
                <Sparkles class="h-3.5 w-3.5" />
                <span>Open Interactive Demo PR</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>
