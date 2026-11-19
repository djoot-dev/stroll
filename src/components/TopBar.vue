<script setup lang="ts">
import {
  ArrowDownUp,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderGit2,
  KeyRound,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Send,
  Settings,
  Sun,
} from '@lucide/vue'
import { openExternalUrl } from '@/services/native'
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

function handleOpenOnGitHub() {
  if (!review.pr?.url) return
  void openExternalUrl(review.pr.url)
}

function handleRefreshPR() {
  if (!review.pr || review.pr.isMock || review.isRefreshingPR) return
  void review.refreshCurrentPR()
}
</script>

<template>
  <header class="shrink-0 border-b border-border bg-canvas-subtle">
    <div class="flex h-12 items-center justify-between gap-3 px-4">
      <!-- Left: Back to PRs + Sidebar toggle + Brand + PR badge -->
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <button
          class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated"
          title="Back to PR Inbox"
          @click="review.backToInbox()"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">PRs</span>
        </button>

        <button
          class="shrink-0 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
          :title="review.sidebarOpen ? 'Hide tour outline ([)' : 'Show tour outline ([)'"
          @click="review.sidebarOpen = !review.sidebarOpen"
        >
          <PanelLeftClose v-if="review.sidebarOpen" class="h-4 w-4" />
          <PanelLeftOpen v-else class="h-4 w-4" />
        </button>

        <div class="flex shrink-0 items-center gap-2">
          <img
            src="/logo.svg"
            alt="Stroll"
            class="h-6 w-6 shrink-0 rounded-md shadow-xs"
          />
          <span class="hidden whitespace-nowrap text-sm font-semibold tracking-tight text-ink sm:inline">
            Stroll
          </span>
        </div>

        <template v-if="review.pr">
          <span class="shrink-0 text-ink-faint">/</span>
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-xs font-medium text-ink-secondary">
              {{ review.pr.owner }}/{{ review.pr.repo }}
              <span class="text-ink-muted">#{{ review.pr.number }}</span>
            </span>
            <span
              v-if="review.pr.isMock"
              class="shrink-0 whitespace-nowrap rounded-md border border-ochre-border bg-ochre-soft px-1.5 py-0.5 text-[10px] font-medium text-ochre-text"
            >
              DEMO PR
            </span>
          </div>
        </template>
      </div>

      <!-- Center: Step Progress -->
      <div v-if="review.tourSteps.length > 0" class="flex shrink-0 items-center gap-2">
        <button
          class="shrink-0 rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-40"
          :disabled="review.activeView === 'overview' || review.currentStepIndex === 0"
          title="Previous step (H or ←)"
          @click="review.prevStep()"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
        </button>

        <div class="flex shrink-0 items-center gap-2 px-1">
          <span class="whitespace-nowrap font-mono text-xs font-medium text-ink">
            <template v-if="review.activeView === 'overview'">Overview</template>
            <template v-else>Step {{ review.currentStepIndex + 1 }} of {{ review.tourSteps.length }}</template>
          </span>
          <div class="hidden h-1.5 w-24 overflow-hidden rounded-full bg-canvas-elevated lg:block">
            <div
              class="h-full rounded-full bg-terra transition-all duration-200"
              :style="{ width: review.activeView === 'overview' ? '0%' : `${review.progressPercent}%` }"
            />
          </div>
        </div>

        <button
          class="shrink-0 rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-40"
          :disabled="review.activeView === 'step' && review.currentStepIndex >= review.tourSteps.length - 1"
          :title="review.activeView === 'overview' ? 'Enter Guided Tour (L or →)' : 'Next step (L or →)'"
          @click="review.nextStep()"
        >
          <ChevronRight class="h-3.5 w-3.5" />
        </button>

        <button
          v-if="review.activeView === 'step' && review.currentStep"
          class="ml-1 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            review.isStepReviewed(review.currentStep.file.path)
              ? 'border-pine-border bg-pine-soft text-pine-text'
              : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated'
          "
          title="Mark step reviewed (M)"
          @click="review.toggleReviewed()"
        >
          <CheckCircle2 class="h-3.5 w-3.5" />
          <span class="hidden xl:inline">
            {{ review.isStepReviewed(review.currentStep.file.path) ? 'Reviewed' : 'Mark Reviewed' }}
          </span>
        </button>
      </div>

      <!-- Right: Refresh, Open on GitHub, Reading Order Toggle, Load PR, Theme, Settings, Finish Review -->
      <div class="flex shrink-0 items-center gap-1.5">
        <button
          v-if="review.pr"
          class="shrink-0 rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="review.pr.isMock || review.isRefreshingPR"
          :title="
            review.pr.isMock
              ? 'Refresh is disabled in Demo PR mode'
              : review.isRefreshingPR
                ? 'Refreshing Pull Request…'
                : 'Refresh Pull Request'
          "
          @click="handleRefreshPR"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin text-terra': review.isRefreshingPR }" />
        </button>

        <button
          v-if="review.pr"
          class="shrink-0 rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
          title="Open PR on GitHub"
          @click="handleOpenOnGitHub"
        >
          <ExternalLink class="h-3.5 w-3.5" />
        </button>
        <button
          class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-canvas px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated"
          :title="`Current reading order: ${review.tourDirection}. Click to switch.`"
          @click="toggleDirection"
        >
          <ArrowDownUp class="h-3.5 w-3.5 text-terra" />
          <span class="hidden 2xl:inline">
            {{ review.tourDirection === 'bottom-up' ? 'Bottom-Up' : 'Top-Down' }}
          </span>
        </button>

        <button
          class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-canvas px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated"
          @click="review.showLoaderModal = true"
        >
          <FolderGit2 class="h-3.5 w-3.5 text-ink-muted" />
          <span class="hidden lg:inline">Load PR</span>
        </button>

        <button
          class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-canvas px-2.5 py-1 text-xs transition-colors hover:bg-canvas-elevated"
          :class="auth.isAuthenticated ? 'text-pine-text' : 'text-ink-secondary'"
          title="GitHub Authentication Settings"
          @click="settings.openSettings('github')"
        >
          <KeyRound class="h-3.5 w-3.5" />
          <span class="hidden xl:inline">
            {{ auth.viewer ? `@${auth.viewer.login}` : 'Connect GitHub' }}
          </span>
        </button>

        <button
          class="shrink-0 rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
          :title="settings.resolvedTheme === 'dark' ? 'Switch to Warm Light theme' : 'Switch to Deep Pine Dark theme'"
          @click="settings.toggleTheme()"
        >
          <Sun v-if="settings.resolvedTheme === 'dark'" class="h-3.5 w-3.5 text-terra" />
          <Moon v-else class="h-3.5 w-3.5 text-pine" />
        </button>

        <button
          class="shrink-0 rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
          title="Settings (⌘,)"
          @click="settings.openSettings('general')"
        >
          <Settings class="h-3.5 w-3.5" />
        </button>

        <button
          v-if="review.pr"
          class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-pine px-3 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-pine-hover"
          title="Finish & Submit Review (R)"
          @click="review.showFinishModal = true"
        >
          <Send class="h-3.5 w-3.5" />
          <span>Finish Review</span>
          <span
            v-if="review.draftComments.length > 0"
            class="ml-0.5 rounded-full bg-black/25 px-1.5 py-0.2 font-mono text-[10px]"
          >
            {{ review.draftComments.length }}
          </span>
        </button>
      </div>
    </div>
  </header>
</template>
