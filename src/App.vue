<script setup lang="ts">
import { Check, ChevronLeft, ChevronRight, FolderGit2, Minimize2, RefreshCw, X } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CommandPaletteModal from '@/components/CommandPaletteModal.vue'
import DiffViewer from '@/components/DiffViewer.vue'
import FinishReviewModal from '@/components/FinishReviewModal.vue'
import KeyboardShortcutsBar from '@/components/KeyboardShortcutsBar.vue'
import PRInboxView from '@/components/PRInboxView.vue'
import PRLoaderModal from '@/components/PRLoaderModal.vue'
import PRLoadingOverlay from '@/components/PRLoadingOverlay.vue'
import PROverview from '@/components/PROverview.vue'
import ReviewSubmittedView from '@/components/ReviewSubmittedView.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import ShortcutsCheatsheetModal from '@/components/ShortcutsCheatsheetModal.vue'
import SplashScreen from '@/components/SplashScreen.vue'
import TopBar from '@/components/TopBar.vue'
import TourSidebar from '@/components/TourSidebar.vue'
import UpdateIndicator from '@/components/UpdateIndicator.vue'
import { isModKey } from '@/services/shortcuts'
import { runAppStartup } from '@/services/startup'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import { BACKGROUND_UPDATE_CHECK_MS, useUpdatesStore } from '@/stores/updates'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()
const updates = useUpdatesStore()

const SCROLL_TAP_PX = 100
const SCROLL_HOLD_SPEED_PX = 950
const SCROLL_HOLD_DELAY_MS = 160
const SCROLL_SMOOTHING = 10
const stepTransitionName = ref<'step-next' | 'step-prev'>('step-next')
const previewScrollRef = ref<HTMLElement | null>(null)
const showCommandPalette = ref(false)
const showShortcutsModal = ref(false)

let currentScrollTop: number | null = null
let targetScrollTop: number | null = null
let scrollRafId: number | null = null
let lastScrollFrameTime = 0
let heldScrollDirection: -1 | 0 | 1 = 0
let holdStartTime = 0

function getScrollDirection(key: string): -1 | 0 | 1 {
  if (key === 'j' || key === 'J' || key === 'ArrowDown') return 1
  if (key === 'k' || key === 'K' || key === 'ArrowUp') return -1
  return 0
}

function cancelSmoothScroll() {
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  currentScrollTop = null
  targetScrollTop = null
  heldScrollDirection = 0
}

function stepSmoothScroll(now: number) {
  const el = previewScrollRef.value
  if (!el || targetScrollTop === null || currentScrollTop === null) {
    cancelSmoothScroll()
    return
  }

  const dt = Math.min(0.05, Math.max(0.001, (now - lastScrollFrameTime) / 1000))
  lastScrollFrameTime = now

  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  if (heldScrollDirection !== 0 && now - holdStartTime >= SCROLL_HOLD_DELAY_MS) {
    targetScrollTop = Math.max(
      0,
      Math.min(maxScroll, targetScrollTop + heldScrollDirection * SCROLL_HOLD_SPEED_PX * dt),
    )
  }

  const diff = targetScrollTop - currentScrollTop
  if (Math.abs(diff) < 0.25 && heldScrollDirection === 0) {
    el.scrollTop = targetScrollTop
    cancelSmoothScroll()
    return
  }

  const factor = 1 - Math.exp(-SCROLL_SMOOTHING * dt)
  currentScrollTop += diff * factor
  el.scrollTop = currentScrollTop
  scrollRafId = requestAnimationFrame(stepSmoothScroll)
}

function startScrollAnimation() {
  if (scrollRafId === null) {
    lastScrollFrameTime = performance.now()
    scrollRafId = requestAnimationFrame(stepSmoothScroll)
  }
}

function scrollPreviewBy(delta: number) {
  const el = previewScrollRef.value
  if (!el) return

  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  if (currentScrollTop === null) {
    currentScrollTop = el.scrollTop
  }
  const base = targetScrollTop ?? currentScrollTop
  targetScrollTop = Math.max(0, Math.min(maxScroll, base + delta))

  startScrollAnimation()
}

function resetPreviewScroll() {
  cancelSmoothScroll()
  if (previewScrollRef.value) {
    previewScrollRef.value.scrollTop = 0
  }
}

watch(
  () => review.currentStepIndex,
  (nextIdx, prevIdx) => {
    stepTransitionName.value = nextIdx >= prevIdx ? 'step-next' : 'step-prev'
  },
)

watch(
  () => [review.activeView, review.currentStep?.file.path] as const,
  () => {
    resetPreviewScroll()
  },
)

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || target.isContentEditable
}

function handleKeydown(e: KeyboardEvent) {
  if (isModKey(e) && !e.altKey && e.key.toLowerCase() === 'k') {
    if (review.screen === 'review' && review.pr) {
      e.preventDefault()
      showCommandPalette.value = !showCommandPalette.value
    }
    return
  }

  if (isModKey(e) && !e.altKey && e.key === ',') {
    e.preventDefault()
    if (settings.isOpen) {
      settings.closeSettings()
    } else {
      settings.openSettings('general')
    }
    return
  }

  if (e.key === 'Escape') {
    if (showShortcutsModal.value) {
      e.preventDefault()
      showShortcutsModal.value = false
      return
    }
    if (showCommandPalette.value) {
      e.preventDefault()
      showCommandPalette.value = false
      return
    }
    if (settings.isOpen) {
      e.preventDefault()
      settings.closeSettings()
      return
    }
    if (review.showFinishModal) {
      e.preventDefault()
      if (!review.isSubmittingReview) {
        review.showFinishModal = false
      }
      return
    }
    if (review.showLoaderModal) {
      e.preventDefault()
      if (!review.isLoadingPR) {
        review.showLoaderModal = false
      }
      return
    }
    if (review.isLoadingPR) {
      e.preventDefault()
      review.dismissPRLoading()
      return
    }
    if (e.defaultPrevented) {
      return
    }
    if (review.screen === 'review' && review.zenMode && !isEditableElement(e.target)) {
      e.preventDefault()
      review.toggleZenMode(false)
      return
    }
  }

  if (settings.isOpen || review.isLoadingPR || review.showFinishModal || review.showLoaderModal || showCommandPalette.value) return
  if (review.screen !== 'review') return
  if (isEditableElement(e.target)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === '?') {
    e.preventDefault()
    showShortcutsModal.value = !showShortcutsModal.value
    return
  }

  if (showShortcutsModal.value) return

  const scrollDir = getScrollDirection(e.key)
  if (scrollDir !== 0) {
    e.preventDefault()
    if (!e.repeat) {
      heldScrollDirection = scrollDir
      holdStartTime = performance.now()
      scrollPreviewBy(scrollDir * SCROLL_TAP_PX)
    }
    return
  }

  if (e.key === '0') {
    e.preventDefault()
    review.openOverview()
  } else if (e.key === 'o' || e.key === 'O') {
    e.preventDefault()
    review.toggleOverview()
  } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
    e.preventDefault()
    review.nextStep()
  } else if (e.key === 'h' || e.key === 'H' || e.key === 'ArrowLeft') {
    e.preventDefault()
    review.prevStep()
  } else if (e.key === 'n' || e.key === 'N') {
    e.preventDefault()
    review.nextUnreviewedStep()
  } else if (e.key === 'm' || e.key === 'M') {
    if (review.activeView === 'step') {
      e.preventDefault()
      review.toggleReviewed()
    }
  } else if (e.key === '[') {
    e.preventDefault()
    review.sidebarOpen = !review.sidebarOpen
  } else if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault()
    review.toggleZenMode()
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault()
    if (review.pr) review.showFinishModal = true
  }
}

function handleKeyup(e: KeyboardEvent) {
  const scrollDir = getScrollDirection(e.key)
  if (scrollDir !== 0 && scrollDir === heldScrollDirection) {
    heldScrollDirection = 0
  }
}

function handleWindowBlur() {
  heldScrollDirection = 0
}

let pulseTimerId: ReturnType<typeof setInterval> | null = null
let updateCheckTimerId: ReturnType<typeof setInterval> | null = null

const isSlowStartup = ref(false)
const startupError = ref<string | null>(null)
const isRetryingStartup = ref(false)

function continueToInbox(): void {
  startupError.value = null
  if (review.screen === 'splash') {
    review.screen = 'inbox'
  }
}

async function executeStartup(): Promise<void> {
  isSlowStartup.value = false
  startupError.value = null

  const result = await runAppStartup({
    initSettings: () => settings.init(),
    isOnboardingCompleted: () => settings.onboardingCompleted,
    initAuth: () => auth.init(),
    initReview: () => review.init(),
    getAuthError: () => auth.error,
    onSlowStartup: () => {
      isSlowStartup.value = true
    },
  })

  if (result.ok) {
    if (review.screen === 'splash') {
      review.screen = 'inbox'
    }
  } else {
    startupError.value = result.error
  }
}

async function retryStartup(): Promise<void> {
  if (isRetryingStartup.value) return
  isRetryingStartup.value = true
  try {
    await executeStartup()
  } finally {
    isRetryingStartup.value = false
  }
}

watch(
  () => auth.isAuthenticated,
  (authenticated) => {
    if (authenticated && review.screen === 'splash' && startupError.value) {
      continueToInbox()
    }
  },
)

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('keyup', handleKeyup)
  window.addEventListener('blur', handleWindowBlur)
  pulseTimerId = setInterval(() => {
    void review.checkForRemotePRUpdates()
  }, 60_000)
  await executeStartup()
  // Quietly look for a new desktop release so the version indicator can surface it.
  void updates.checkForUpdates({ silent: true })
  updateCheckTimerId = setInterval(() => {
    void updates.checkForUpdates({ silent: true })
  }, BACKGROUND_UPDATE_CHECK_MS)
})

onBeforeUnmount(() => {
  if (pulseTimerId !== null) clearInterval(pulseTimerId)
  if (updateCheckTimerId !== null) clearInterval(updateCheckTimerId)
  cancelSmoothScroll()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('keyup', handleKeyup)
  window.removeEventListener('blur', handleWindowBlur)
})
</script>

<template>
  <Transition name="screen-fade" mode="out-in">
    <!-- 1. Splash Screen -->
    <SplashScreen
      v-if="review.screen === 'splash'"
      key="splash"
      :status-text="auth.initStatus"
      :is-slow="isSlowStartup"
      :error="startupError"
      :is-retrying="isRetryingStartup"
      @retry="retryStartup"
      @open-settings="settings.openSettings('github')"
      @continue="continueToInbox"
    />

    <!-- 2. Centralized PRs Pending Your Review -->
    <PRInboxView v-else-if="review.screen === 'inbox'" key="inbox" />

    <!-- 4. Short Non-Interactive Success Screen -->
    <ReviewSubmittedView v-else-if="review.screen === 'submitted'" key="submitted" />

    <!-- 3. Guided PR Review Screen -->
    <div v-else key="review" class="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <TopBar v-if="!review.zenMode" @open-command-palette="showCommandPalette = true" />

      <!-- Live PR Update Banner -->
      <div
        v-if="review.prHasRemoteUpdates && !review.zenMode"
        class="flex items-center justify-between gap-3 border-b border-terra-border bg-terra-soft px-4 py-1.5 text-xs text-terra-text"
      >
        <span class="font-medium">
          {{ review.remoteUpdateSummary ?? 'This Pull Request has new updates on GitHub.' }}
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-lg bg-terra px-2.5 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-terra-hover disabled:opacity-50"
            :disabled="review.isRefreshingPR"
            :aria-busy="review.isRefreshingPR"
            @click="review.refreshCurrentPR()"
          >
            <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': review.isRefreshingPR }" />
            <span>Refresh now</span>
          </button>
          <button
            type="button"
            class="rounded p-0.5 text-terra-text/70 transition-colors hover:bg-terra/15 hover:text-terra-text"
            title="Dismiss"
            @click="review.dismissRemoteUpdates()"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <!-- Active Commit Filter Banner when Sidebar is Collapsed -->
      <div
        v-if="review.commitFilter !== 'all' && !review.sidebarOpen && !review.zenMode"
        class="flex items-center justify-between gap-3 border-b border-ochre-border bg-ochre-soft px-4 py-1 text-xs text-ochre-text"
      >
        <span class="font-medium">
          Tour is filtered to
          <code class="rounded bg-canvas px-1 py-0.5 font-mono text-[11px]">
            {{
              review.commitFilter === 'since-last-review'
                ? review.lastReviewedCommitOid && review.pr
                  ? `${review.lastReviewedCommitOid.slice(0, 7)}..${review.pr.headRefOid.slice(0, 7)}`
                  : 'since last review'
                : review.commitFilter.slice(0, 7)
            }}
          </code>
        </span>
        <button
          type="button"
          class="rounded-md border border-ochre-border bg-canvas px-2 py-0.5 text-[11px] font-medium text-ochre-text hover:bg-canvas-elevated"
          @click="review.setCommitFilter('all')"
        >
          Show all commits
        </button>
      </div>

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <TourSidebar v-if="!review.zenMode" />

        <main
          ref="previewScrollRef"
          class="relative flex-1 overflow-y-auto overflow-x-hidden bg-canvas"
          @wheel="cancelSmoothScroll"
          @pointerdown="cancelSmoothScroll"
        >
          <PROverview v-if="review.pr && review.activeView === 'overview'" />

          <template v-else-if="review.currentStep">
            <Transition :name="stepTransitionName" mode="out-in">
              <DiffViewer :key="review.currentStep.file.path" :step="review.currentStep" />
            </Transition>

            <!-- Bottom Step Pager -->
            <div
              class="mx-auto mb-10 flex max-w-6xl items-center justify-between border-t border-border-muted px-5 pt-4"
            >
              <button
                class="stroll-card inline-flex items-center gap-1.5 rounded-xl border border-border bg-canvas-subtle px-4 py-2 text-xs font-medium text-ink-secondary transition-all hover:bg-canvas-elevated active:scale-[0.98] disabled:opacity-40"
                :disabled="review.currentStepIndex === 0"
                @click="review.prevStep()"
              >
                <ChevronLeft class="h-4 w-4" />
                <span>Previous Step</span>
              </button>

              <button
                v-if="review.currentStepIndex < review.tourSteps.length - 1"
                class="inline-flex items-center gap-1.5 rounded-xl bg-terra px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98]"
                @click="review.nextStep()"
              >
                <span>Next Step</span>
                <ChevronRight class="h-4 w-4" />
              </button>

              <button
                v-else
                class="inline-flex items-center gap-1.5 rounded-xl bg-pine px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-pine-hover active:scale-[0.98]"
                @click="review.showFinishModal = true"
              >
                <span>Complete Tour & Finish Review</span>
                <ChevronRight class="h-4 w-4" />
              </button>
            </div>
          </template>

          <div
            v-else
            class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
          >
            <FolderGit2 class="h-10 w-10 text-ink-faint" />
            <p class="text-sm font-medium text-ink-secondary">No Pull Request loaded</p>
            <button
              class="rounded-xl bg-terra px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98]"
              @click="review.backToInbox()"
            >
              Back to PR Inbox
            </button>
          </div>
        </main>
      </div>

      <KeyboardShortcutsBar
        v-if="settings.showShortcutsBar && !review.zenMode"
        @open-cheatsheet="showShortcutsModal = true"
      />

      <!-- Zen Mode Floating Exit Pill -->
      <div
        v-if="review.zenMode"
        role="region"
        aria-label="Zen mode controls"
        class="fixed right-6 top-3 z-30 flex items-center gap-1.5 rounded-full border border-border bg-canvas-subtle/90 px-2.5 py-1 text-xs opacity-60 shadow-md backdrop-blur-md transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100"
      >
        <span
          v-if="review.tourSteps.length > 0"
          class="px-1.5 font-mono text-[11px] font-medium text-ink-secondary"
        >
          <template v-if="review.activeView === 'overview'">Overview</template>
          <template v-else>Step {{ review.currentStepIndex + 1 }}/{{ review.tourSteps.length }}</template>
        </span>

        <template v-if="review.activeView === 'step' && review.currentStep">
          <span class="h-3.5 w-px bg-border-muted" aria-hidden="true" />
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors"
            :class="
              review.isStepReviewed(review.currentStep.file.path)
                ? 'bg-pine-soft text-pine-text hover:bg-pine-soft/80'
                : 'text-ink-secondary hover:bg-canvas-elevated hover:text-ink'
            "
            title="Mark step reviewed (M)"
            @click="review.toggleReviewed()"
          >
            <Check class="h-3 w-3" />
            <span>{{ review.isStepReviewed(review.currentStep.file.path) ? 'Reviewed' : 'Mark Reviewed' }}</span>
            <kbd class="rounded border border-border-muted bg-canvas px-1 font-mono text-[9.5px] text-ink-faint">M</kbd>
          </button>
        </template>

        <span class="h-3.5 w-px bg-border-muted" aria-hidden="true" />

        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
          title="Exit Zen Mode (Esc or Z)"
          @click="review.toggleZenMode(false)"
        >
          <Minimize2 class="h-3 w-3" />
          <span>Exit Zen</span>
          <kbd class="rounded border border-border-muted bg-canvas px-1 font-mono text-[9.5px] text-ink-faint">Esc</kbd>
        </button>
      </div>
    </div>
  </Transition>

  <!-- Update indicator for screens without the shortcuts footer -->
  <UpdateIndicator
    v-if="review.screen !== 'splash' && !review.zenMode && !(review.screen === 'review' && settings.showShortcutsBar)"
    variant="floating"
  />

  <!-- Global Modals -->
  <CommandPaletteModal :open="showCommandPalette" @close="showCommandPalette = false" />
  <ShortcutsCheatsheetModal :open="showShortcutsModal" @close="showShortcutsModal = false" />
  <SettingsModal />
  <PRLoaderModal />
  <PRLoadingOverlay />
  <FinishReviewModal />
</template>
