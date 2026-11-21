<script setup lang="ts">
import { FolderGit2, Loader2, RefreshCw, Search, Sparkles, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { filterAndSortInboxPRs } from '@/services/inbox'
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
const listSearchQuery = ref('')

const filteredRequestedPRs = computed(() =>
  filterAndSortInboxPRs(auth.requestedPRs, {
    query: listSearchQuery.value,
    repo: 'all',
    sort: 'updated-desc',
  }),
)

async function handleLoadUrl() {
  if (!urlInput.value.trim()) return
  await review.loadPRByUrl(urlInput.value)
}

async function handleLoadDemo() {
  await review.loadMockPR()
  review.showLoaderModal = false
}

function isItemLoading(owner: string, repo: string, number: number): boolean {
  return review.isLoadingPR && review.loadingPRKey === `${owner}/${repo}#${number}`
}
</script>

<template>
  <Transition name="modal-pop">
    <div
      v-if="review.showLoaderModal"
      class="stroll-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      @click.self="!review.isLoadingPR && (review.showLoaderModal = false)"
    >
      <div class="stroll-elevated relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-canvas-subtle">
        <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div class="flex items-center gap-2">
            <FolderGit2 class="h-4 w-4 text-terra" />
            <h2 class="text-sm font-semibold text-ink">Load Pull Request</h2>
          </div>
          <button
            class="rounded-lg p-1 text-ink-muted hover:bg-canvas-elevated hover:text-ink disabled:opacity-40"
            :disabled="review.isLoadingPR"
            @click="review.showLoaderModal = false"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="space-y-5 p-5">
          <!-- Load by URL or shorthand -->
          <div class="space-y-2">
            <label class="block text-xs font-medium text-ink-secondary">
              GitHub PR URL or <span class="font-mono">owner/repo#123</span>
            </label>
            <div class="flex gap-2">
              <input
                v-model="urlInput"
                type="text"
                :disabled="review.isLoadingPR"
                :placeholder="`https://${settings.githubHost}/owner/repo/pull/123 or owner/repo#123`"
                class="flex-1 rounded-xl border border-border bg-canvas-inset px-3 py-2 font-mono text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none disabled:opacity-60"
                @keydown.enter="handleLoadUrl"
              />
              <button
                class="inline-flex items-center gap-1.5 rounded-xl bg-terra px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-terra-hover disabled:opacity-40"
                :disabled="review.isLoadingPR || !urlInput.trim()"
                :aria-busy="review.isLoadingPR"
                @click="handleLoadUrl"
              >
                <Loader2 v-if="review.isLoadingPR" class="h-3.5 w-3.5 animate-spin" />
                <span>{{ review.isLoadingPR ? 'Loading…' : 'Load PR' }}</span>
              </button>
            </div>
            <p v-if="review.prError" class="text-xs text-crimson-text">{{ review.prError }}</p>
          </div>

          <!-- Pull Requests -->
          <div class="space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
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
                  class="rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60"
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
              <span v-else class="text-xs font-medium text-ink-secondary">
                Requested for your review
              </span>
              <button
                v-if="auth.isAuthenticated"
                class="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
                @click="auth.refreshRequestedPRs()"
              >
                <RefreshCw class="h-3 w-3" />
                <span>Refresh</span>
              </button>
            </div>

            <div
              v-if="!auth.isAuthenticated"
              class="rounded-xl border border-border-muted bg-canvas-inset p-4 text-center text-xs text-ink-muted"
            >
              <button
                class="font-medium text-terra-text hover:underline"
                @click="
                  () => {
                    review.showLoaderModal = false
                    settings.openSettings('github')
                  }
                "
              >
                Connect your GitHub PAT
              </button>
              to list open PRs awaiting your review.
            </div>

            <div
              v-else-if="auth.requestedPRs.length === 0"
              class="rounded-xl border border-border-muted bg-canvas-inset p-4 text-center text-xs text-ink-faint"
            >
              {{ activeFilterOption.emptyMessage }}
            </div>

            <template v-else>
              <div class="relative">
                <Search
                  class="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
                />
                <input
                  v-model="listSearchQuery"
                  type="text"
                  placeholder="Filter by title, repo, #number, or @author…"
                  class="w-full rounded-xl border border-border bg-canvas-inset py-1.5 pr-8 pl-8 text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
                />
                <button
                  v-if="listSearchQuery"
                  type="button"
                  aria-label="Clear filter"
                  class="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-ink"
                  @click="listSearchQuery = ''"
                >
                  <X class="h-3.5 w-3.5" />
                </button>
              </div>

              <div
                v-if="filteredRequestedPRs.length === 0"
                class="rounded-xl border border-border-muted bg-canvas-inset p-4 text-center text-xs text-ink-faint"
              >
                No pull requests match "{{ listSearchQuery }}".
              </div>

              <div v-else class="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                <button
                  v-for="item in filteredRequestedPRs"
                  :key="item.id"
                class="flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors"
                :class="
                  isItemLoading(item.owner, item.repo, item.number)
                    ? 'cursor-wait border-terra-border bg-terra-soft/20'
                    : 'border-border-muted bg-canvas hover:border-terra-border hover:bg-canvas-elevated/60 disabled:cursor-not-allowed disabled:opacity-60'
                "
                :disabled="review.isLoadingPR"
                :aria-busy="isItemLoading(item.owner, item.repo, item.number)"
                @click="review.loadPRByRepo(item.owner, item.repo, item.number)"
              >
                <div class="min-w-0">
                  <div class="truncate text-xs font-medium text-ink">
                    {{ item.title }}
                  </div>
                  <div class="mt-0.5 font-mono text-[11px] text-ink-muted">
                    {{ item.owner }}/{{ item.repo }}#{{ item.number }} · @{{ item.author.login }}
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                  <Loader2
                    v-if="isItemLoading(item.owner, item.repo, item.number)"
                    class="h-3.5 w-3.5 animate-spin text-terra"
                  />
                  <template v-else>
                    <span class="text-pine-text">+{{ item.additions }}</span>
                    <span class="mx-1 text-ink-faint">/</span>
                    <span class="text-crimson-text">-{{ item.deletions }}</span>
                  </template>
                </div>
              </button>
              </div>
            </template>
          </div>

          <!-- Demo PR Fallback -->
          <div class="flex items-center justify-between border-t border-border pt-4">
            <span class="text-xs text-ink-muted">Want to explore the guided tour UX offline?</span>
            <button
              class="inline-flex items-center gap-1.5 rounded-xl border border-ochre-border bg-ochre-soft px-3 py-1.5 text-xs font-medium text-ochre-text transition-colors hover:bg-canvas-elevated"
              @click="handleLoadDemo"
            >
              <Sparkles class="h-3.5 w-3.5" />
              <span>Load Demo PR</span>
            </button>
          </div>
        </div>

        <!-- Loading PR Overlay inside modal -->
        <div
          v-if="review.isLoadingPR"
          role="status"
          aria-live="polite"
          class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-canvas-subtle/90 px-6 text-center backdrop-blur-[2px]"
        >
          <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-terra-soft text-terra">
            <Loader2 class="h-5 w-5 animate-spin" />
          </div>
          <h3 class="mt-3.5 text-sm font-semibold text-ink">Opening Pull Request…</h3>
          <p v-if="review.loadingPRKey" class="mt-1 font-mono text-xs text-terra-text">
            {{ review.loadingPRKey }}
          </p>
          <p class="mt-1 text-xs text-ink-muted">
            Fetching files, diffs, and building tour order…
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>
