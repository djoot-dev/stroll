<script setup lang="ts">
import { ChevronLeft, ChevronRight, FolderGit2, RefreshCw, X } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CommandPaletteModal from '@/components/CommandPaletteModal.vue'
import DiffViewer from '@/components/DiffViewer.vue'
import FinishReviewModal from '@/components/FinishReviewModal.vue'
import KeyboardShortcutsBar from '@/components/KeyboardShortcutsBar.vue'
import PRInboxView from '@/components/PRInboxView.vue'
import PRLoaderModal from '@/components/PRLoaderModal.vue'
import PROverview from '@/components/PROverview.vue'
import ReviewSubmittedView from '@/components/ReviewSubmittedView.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import SplashScreen from '@/components/SplashScreen.vue'
import TopBar from '@/components/TopBar.vue'
import TourSidebar from '@/components/TourSidebar.vue'
import UpdateIndicator from '@/components/UpdateIndicator.vue'
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
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    if (review.screen === 'review' && review.pr) {
      e.preventDefault()
      showCommandPalette.value = !showCommandPalette.value
    }
    return
  }

  if ((e.metaKey || e.ctrlKey) && e.key === ',') {
    e.preventDefault()
    if (settings.isOpen) {
      settings.closeSettings()
    } else {
      settings.openSettings('general')
    }
    return
  }

  if (e.key === 'Escape') {
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
      review.showFinishModal = false
      return
    }
    if (review.showLoaderModal) {
      e.preventDefault()
      review.showLoaderModal = false
      return
    }
  }

  if (settings.isOpen || review.showFinishModal || review.showLoaderModal || showCommandPalette.value) return
  if (review.screen !== 'review') return
  if (isEditableElement(e.target)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

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
  } else if (e.key === 'm' || e.key === 'M') {
    if (review.activeView === 'step') {
      e.preventDefault()
      review.toggleReviewed()
    }
  } else if (e.key === '[') {
    e.preventDefault()
    review.sidebarOpen = !review.sidebarOpen
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
      <TopBar />

      <!-- Live PR Update Banner -->
      <div
        v-if="review.prHasRemoteUpdates"
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

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <TourSidebar />

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

      <KeyboardShortcutsBar v-if="settings.showShortcutsBar" />
    </div>
  </Transition>

  <!-- Update indicator for screens without the shortcuts footer -->
  <UpdateIndicator
    v-if="review.screen !== 'splash' && !(review.screen === 'review' && settings.showShortcutsBar)"
    variant="floating"
  />

  <!-- Global Modals -->
  <CommandPaletteModal :open="showCommandPalette" @close="showCommandPalette = false" />
  <SettingsModal />
  <PRLoaderModal />
  <FinishReviewModal />
</template>
