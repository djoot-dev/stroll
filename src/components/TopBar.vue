<script setup lang="ts">
import {
  ArrowDownUp,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
} from '@lucide/vue'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()

function toggleDirection() {
  const next = review.tourDirection === 'bottom-up' ? 'top-down' : 'bottom-up'
  void review.setTourDirection(next)
}
</script>

<template>
  <header class="shrink-0 border-b border-border bg-canvas-subtle">
    <div class="flex h-12 items-center justify-between gap-3 px-4">
      <!-- Left: Back to PRs + Sidebar toggle + Brand + PR badge -->
      <div class="flex min-w-0 items-center gap-2">
        <button
          class="inline-flex items-center gap-1 rounded border border-border bg-canvas px-2 py-1 text-xs text-slate-300 hover:bg-canvas-elevated"
          title="Back to PR Inbox"
          @click="review.backToInbox()"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">PRs</span>
        </button>

        <button
          class="rounded p-1.5 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
          :title="review.sidebarOpen ? 'Hide tour outline ([)' : 'Show tour outline ([)'"
          @click="review.sidebarOpen = !review.sidebarOpen"
        >
          <PanelLeftClose v-if="review.sidebarOpen" class="h-4 w-4" />
          <PanelLeftOpen v-else class="h-4 w-4" />
        </button>

        <div class="flex items-center gap-2">
          <span
            class="inline-flex h-6 w-6 items-center justify-center rounded bg-blue-500/20 text-xs font-bold text-blue-400"
          >
            PT
          </span>
          <span class="hidden text-sm font-semibold tracking-tight text-slate-100 sm:inline">
            PR Tour
          </span>
        </div>

        <template v-if="review.pr">
          <span class="text-slate-600">/</span>
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-xs font-medium text-slate-300">
              {{ review.pr.owner }}/{{ review.pr.repo }}
              <span class="text-slate-500">#{{ review.pr.number }}</span>
            </span>
            <span
              v-if="review.pr.isMock"
              class="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
            >
              DEMO PR
            </span>
          </div>
        </template>
      </div>

      <!-- Center: Step Progress -->
      <div v-if="review.tourSteps.length > 0" class="flex items-center gap-2">
        <button
          class="rounded border border-border bg-canvas px-2 py-1 text-xs text-slate-300 hover:bg-canvas-elevated disabled:opacity-40"
          :disabled="review.currentStepIndex === 0"
          title="Previous step (K or ←)"
          @click="review.prevStep()"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
        </button>

        <div class="flex items-center gap-2 px-1">
          <span class="font-mono text-xs font-medium text-slate-200">
            Step {{ review.currentStepIndex + 1 }} of {{ review.tourSteps.length }}
          </span>
          <div class="hidden h-1.5 w-28 overflow-hidden rounded-full bg-canvas-inset md:block">
            <div
              class="h-full rounded-full bg-blue-500 transition-all duration-200"
              :style="{ width: `${review.progressPercent}%` }"
            />
          </div>
        </div>

        <button
          class="rounded border border-border bg-canvas px-2 py-1 text-xs text-slate-300 hover:bg-canvas-elevated disabled:opacity-40"
          :disabled="review.currentStepIndex >= review.tourSteps.length - 1"
          title="Next step (J or →)"
          @click="review.nextStep()"
        >
          <ChevronRight class="h-3.5 w-3.5" />
        </button>

        <button
          v-if="review.currentStep"
          class="ml-1 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            review.isStepReviewed(review.currentStep.file.path)
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : 'border-border bg-canvas text-slate-300 hover:bg-canvas-elevated'
          "
          title="Mark step reviewed (M)"
          @click="review.toggleReviewed()"
        >
          <CheckCircle2 class="h-3.5 w-3.5" />
          <span class="hidden lg:inline">
            {{ review.isStepReviewed(review.currentStep.file.path) ? 'Reviewed' : 'Mark Reviewed' }}
          </span>
        </button>
      </div>

      <!-- Right: Reading Order Toggle, Load PR, Settings, Finish Review -->
      <div class="flex items-center gap-2">
        <button
          class="inline-flex items-center gap-1.5 rounded border border-border bg-canvas px-2.5 py-1 text-xs text-slate-300 hover:bg-canvas-elevated"
          :title="`Current reading order: ${review.tourDirection}. Click to switch.`"
          @click="toggleDirection"
        >
          <ArrowDownUp class="h-3.5 w-3.5 text-blue-400" />
          <span class="hidden xl:inline">
            {{ review.tourDirection === 'bottom-up' ? 'Bottom-Up' : 'Top-Down' }}
          </span>
        </button>

        <button
          class="inline-flex items-center gap-1.5 rounded border border-border bg-canvas px-2.5 py-1 text-xs text-slate-300 hover:bg-canvas-elevated"
          @click="review.showLoaderModal = true"
        >
          <FolderGit2 class="h-3.5 w-3.5 text-slate-400" />
          <span class="hidden md:inline">Load PR</span>
        </button>

        <button
          class="inline-flex items-center gap-1.5 rounded border border-border bg-canvas px-2.5 py-1 text-xs hover:bg-canvas-elevated"
          :class="auth.isAuthenticated ? 'text-emerald-300' : 'text-slate-300'"
          title="GitHub Authentication Settings"
          @click="settings.openSettings('github')"
        >
          <KeyRound class="h-3.5 w-3.5" />
          <span class="hidden lg:inline">
            {{ auth.viewer ? `@${auth.viewer.login}` : 'Connect GitHub' }}
          </span>
        </button>

        <button
          class="rounded border border-border bg-canvas p-1.5 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
          title="Settings (⌘,)"
          @click="settings.openSettings('general')"
        >
          <Settings class="h-3.5 w-3.5" />
        </button>

        <button
          v-if="review.pr"
          class="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
          title="Finish & Submit Review (R)"
          @click="review.showFinishModal = true"
        >
          <Send class="h-3.5 w-3.5" />
          <span>Finish Review</span>
          <span
            v-if="review.draftComments.length > 0"
            class="ml-0.5 rounded-full bg-black/30 px-1.5 py-0.2 font-mono text-[10px]"
          >
            {{ review.draftComments.length }}
          </span>
        </button>
      </div>
    </div>
  </header>
</template>
