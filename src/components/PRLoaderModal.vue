<script setup lang="ts">
import { FolderGit2, Loader2, RefreshCw, Sparkles, X } from '@lucide/vue'
import { computed, ref } from 'vue'
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

async function handleLoadUrl() {
  if (!urlInput.value.trim()) return
  await review.loadPRByUrl(urlInput.value)
}

async function handleLoadDemo() {
  await review.loadMockPR()
  review.showLoaderModal = false
}
</script>

<template>
  <Transition name="modal-pop">
    <div
      v-if="review.showLoaderModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      @click.self="review.showLoaderModal = false"
    >
    <div class="w-full max-w-xl rounded-xl border border-border bg-canvas-subtle shadow-2xl">
      <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div class="flex items-center gap-2">
          <FolderGit2 class="h-4 w-4 text-blue-400" />
          <h2 class="text-sm font-semibold text-slate-100">Load Pull Request</h2>
        </div>
        <button
          class="rounded p-1 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
          @click="review.showLoaderModal = false"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-5 p-5">
        <!-- Load by URL -->
        <div class="space-y-2">
          <label class="block text-xs font-medium text-slate-300">GitHub PR URL</label>
          <div class="flex gap-2">
            <input
              v-model="urlInput"
              type="url"
              placeholder="https://github.com/owner/repo/pull/123"
              class="flex-1 rounded-lg border border-border bg-canvas-inset px-3 py-2 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
              @keydown.enter="handleLoadUrl"
            />
            <button
              class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
              :disabled="review.isLoadingPR || !urlInput.trim()"
              @click="handleLoadUrl"
            >
              <Loader2 v-if="review.isLoadingPR" class="h-3.5 w-3.5 animate-spin" />
              <span>Load PR</span>
            </button>
          </div>
          <p v-if="review.prError" class="text-xs text-rose-400">{{ review.prError }}</p>
        </div>

        <!-- Pull Requests -->
        <div class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
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
                class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60"
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
            <span v-else class="text-xs font-medium text-slate-300">
              Requested for your review
            </span>
            <button
              v-if="auth.isAuthenticated"
              class="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
              @click="auth.refreshRequestedPRs()"
            >
              <RefreshCw class="h-3 w-3" />
              <span>Refresh</span>
            </button>
          </div>

          <div
            v-if="!auth.isAuthenticated"
            class="rounded-lg border border-border-muted bg-canvas-inset p-4 text-center text-xs text-slate-400"
          >
            <button
              class="font-medium text-blue-400 hover:underline"
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
            class="rounded-lg border border-border-muted bg-canvas-inset p-4 text-center text-xs text-slate-500"
          >
            {{ activeFilterOption.emptyMessage }}
          </div>

          <div v-else class="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            <button
              v-for="item in auth.requestedPRs"
              :key="item.id"
              class="flex w-full items-center justify-between gap-3 rounded-lg border border-border-muted bg-canvas-inset px-3 py-2.5 text-left hover:border-blue-500/40 hover:bg-canvas-elevated"
              @click="review.loadPRByRepo(item.owner, item.repo, item.number)"
            >
              <div class="min-w-0">
                <div class="truncate text-xs font-medium text-slate-200">
                  {{ item.title }}
                </div>
                <div class="mt-0.5 font-mono text-[11px] text-slate-500">
                  {{ item.owner }}/{{ item.repo }}#{{ item.number }} · @{{ item.author.login }}
                </div>
              </div>
              <div class="shrink-0 font-mono text-[11px]">
                <span class="text-emerald-400">+{{ item.additions }}</span>
                <span class="mx-1 text-slate-600">/</span>
                <span class="text-rose-400">-{{ item.deletions }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- Demo PR Fallback -->
        <div class="flex items-center justify-between border-t border-border pt-4">
          <span class="text-xs text-slate-400">Want to explore the guided tour UX offline?</span>
          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
            @click="handleLoadDemo"
          >
            <Sparkles class="h-3.5 w-3.5" />
            <span>Load Demo PR</span>
          </button>
        </div>
      </div>
    </div>
    </div>
  </Transition>
</template>
