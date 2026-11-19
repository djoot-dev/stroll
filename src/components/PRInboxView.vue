<script setup lang="ts">
import {
  ArrowRight,
  Clock,
  FileDiff,
  FolderGit2,
  GitPullRequest,
  KeyRound,
  Loader2,
  RefreshCw,
  Settings,
  Sparkles,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PR_FILTER_OPTIONS, useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()

const activeFilterOption = computed(
  () => PR_FILTER_OPTIONS.find((opt) => opt.value === auth.prFilter) ?? PR_FILTER_OPTIONS[0],
)

const urlInput = ref('')
const lastRefreshedAt = ref<Date | null>(auth.isAuthenticated ? new Date() : null)
let pollTimer: number | null = null

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
        void handleRefresh()
      }
    }, sec * 1000)
  }
}

async function handleRefresh() {
  if (!auth.isAuthenticated || auth.isLoading) return
  await auth.refreshRequestedPRs()
  lastRefreshedAt.value = new Date()
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
  <div class="flex h-screen flex-col overflow-hidden bg-canvas text-slate-100">
    <!-- Top Header -->
    <header class="shrink-0 border-b border-border bg-canvas-subtle">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <div class="flex items-center gap-2.5">
          <img
            src="/logo.svg"
            alt="Stroll"
            class="h-7 w-7 rounded-lg shadow-sm"
          />
          <div>
            <span class="text-sm font-semibold tracking-tight text-slate-100">Stroll</span>
            <span class="ml-2 hidden text-xs text-slate-500 sm:inline">Review Inbox</span>
          </div>
        </div>

        <div class="flex items-center gap-2.5">
          <button
            v-if="auth.isAuthenticated"
            class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated disabled:opacity-50"
            :disabled="auth.isLoading"
            title="Refresh pending PRs"
            @click="handleRefresh"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': auth.isLoading }" />
            <span>Refresh</span>
          </button>

          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated"
            title="Link local repository checkouts for AST & git blame"
            @click="settings.openSettings('repositories')"
          >
            <FolderGit2 class="h-3.5 w-3.5 text-purple-400" />
            <span>Local Repos</span>
            <span
              v-if="Object.keys(review.repoPaths).length > 0"
              class="rounded-full bg-purple-500/20 px-1.5 py-0.5 font-mono text-[10px] text-purple-300"
            >
              {{ Object.keys(review.repoPaths).length }}
            </span>
          </button>

          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs hover:bg-canvas-elevated"
            :class="auth.isAuthenticated ? 'text-emerald-300' : 'text-slate-200'"
            @click="settings.openSettings('github')"
          >
            <KeyRound class="h-3.5 w-3.5" />
            <span>{{ auth.viewer ? `@${auth.viewer.login}` : 'Connect GitHub' }}</span>
          </button>

          <button
            class="rounded-lg border border-border bg-canvas p-1.5 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
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
        <section class="rounded-xl border border-border bg-canvas-subtle p-5">
          <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400">
            Open any Pull Request by URL
          </label>
          <div class="mt-2.5 flex gap-2.5">
            <input
              v-model="urlInput"
              type="url"
              placeholder="https://github.com/owner/repo/pull/123"
              class="flex-1 rounded-lg border border-border bg-canvas-inset px-3.5 py-2 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
              @keydown.enter="handleLoadUrl"
            />
            <button
              class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
              :disabled="review.isLoadingPR || !urlInput.trim()"
              @click="handleLoadUrl"
            >
              <Loader2 v-if="review.isLoadingPR" class="h-3.5 w-3.5 animate-spin" />
              <span>Start Tour</span>
              <ArrowRight v-if="!review.isLoadingPR" class="h-3.5 w-3.5" />
            </button>
          </div>
          <p v-if="review.prError" class="mt-2 text-xs text-rose-400">{{ review.prError }}</p>
        </section>

        <!-- Pull Request List -->
        <section class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <GitPullRequest class="h-4 w-4 text-blue-400" />
              <h2 class="text-sm font-semibold text-slate-100">{{ activeFilterOption.heading }}</h2>
              <span
                v-if="auth.isAuthenticated"
                class="rounded-full bg-canvas-elevated px-2 py-0.5 font-mono text-[11px] text-slate-300"
              >
                {{ auth.requestedPRs.length }}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <div
                v-if="auth.isAuthenticated"
                class="inline-flex rounded-lg border border-border bg-canvas-inset p-0.5"
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
                  class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60"
                  :class="
                    auth.prFilter === opt.value
                      ? 'bg-canvas-elevated text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  "
                  @click="auth.setPrFilter(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>

              <div
                v-if="auth.isAuthenticated"
                class="flex items-center gap-2 text-[11px] text-slate-500"
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
            class="rounded-xl border border-dashed border-border bg-canvas-subtle/60 p-8 text-center"
          >
            <KeyRound class="mx-auto h-8 w-8 text-slate-500" />
            <h3 class="mt-3 text-sm font-semibold text-slate-200">
              Connect GitHub to see PRs awaiting your review
            </h3>
            <p class="mx-auto mt-1 max-w-md text-xs text-slate-400">
              Add a GitHub Personal Access Token (PAT) to automatically fetch open pull requests
              where you are requested as a reviewer.
            </p>
            <div class="mt-5 flex flex-wrap items-center justify-center gap-3">
              <button
                class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                @click="settings.openSettings('github')"
              >
                <KeyRound class="h-3.5 w-3.5" />
                <span>Connect GitHub PAT</span>
              </button>
              <button
                class="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
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
            class="rounded-xl border border-border bg-canvas-subtle/60 p-8 text-center"
          >
            <p class="text-sm font-medium text-slate-300">{{ activeFilterOption.emptyMessage }}</p>
            <p class="mt-1 text-xs text-slate-500">
              Paste any PR URL above or try the offline demo tour.
            </p>
            <button
              class="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
              @click="review.loadMockPR()"
            >
              <Sparkles class="h-3.5 w-3.5" />
              <span>Try Interactive Demo PR</span>
            </button>
          </div>

          <!-- PR List -->
          <div v-else class="space-y-2">
            <button
              v-for="item in auth.requestedPRs"
              :key="item.id"
              class="group flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-canvas-subtle px-4 py-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-canvas-elevated"
              :disabled="review.isLoadingPR"
              @click="review.loadPRByRepo(item.owner, item.repo, item.number)"
            >
              <div class="min-w-0 space-y-1">
                <div class="flex items-center gap-2">
                  <span class="font-mono text-xs text-blue-400">
                    {{ item.owner }}/{{ item.repo }}#{{ item.number }}
                  </span>
                  <span class="text-xs text-slate-600">·</span>
                  <span class="text-xs text-slate-400">@{{ item.author.login }}</span>
                  <span class="text-xs text-slate-600">·</span>
                  <span class="text-xs text-slate-500">{{ formatRelativeTime(item.updatedAt) }}</span>
                </div>
                <div class="truncate text-sm font-medium text-slate-100 group-hover:text-white">
                  {{ item.title }}
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-4">
                <div class="hidden items-center gap-1.5 text-xs text-slate-400 sm:flex">
                  <FileDiff class="h-3.5 w-3.5 text-slate-500" />
                  <span>{{ item.changedFiles }} files</span>
                </div>
                <div class="font-mono text-xs">
                  <span class="text-emerald-400">+{{ item.additions }}</span>
                  <span class="mx-1 text-slate-600">/</span>
                  <span class="text-rose-400">-{{ item.deletions }}</span>
                </div>
                <span
                  class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-1 text-xs font-medium text-slate-300 group-hover:border-blue-500/40 group-hover:text-blue-300"
                >
                  <span>Review</span>
                  <ArrowRight class="h-3 w-3" />
                </span>
              </div>
            </button>

            <!-- Demo PR Quick Access -->
            <div class="flex justify-end pt-2">
              <button
                class="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-300"
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
