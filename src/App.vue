<script setup lang="ts">
import { ChevronLeft, ChevronRight, FolderGit2 } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import DiffViewer from '@/components/DiffViewer.vue'
import FinishReviewModal from '@/components/FinishReviewModal.vue'
import KeyboardShortcutsBar from '@/components/KeyboardShortcutsBar.vue'
import PRInboxView from '@/components/PRInboxView.vue'
import PRLoaderModal from '@/components/PRLoaderModal.vue'
import ReviewSubmittedView from '@/components/ReviewSubmittedView.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import SplashScreen from '@/components/SplashScreen.vue'
import TopBar from '@/components/TopBar.vue'
import TourSidebar from '@/components/TourSidebar.vue'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'

const auth = useAuthStore()
const review = useReviewStore()

const SCROLL_STEP_PX = 80
const SCROLL_SMOOTHING = 18
const stepTransitionName = ref<'step-next' | 'step-prev'>('step-next')
const previewScrollRef = ref<HTMLElement | null>(null)

let targetScrollTop: number | null = null
let scrollRafId: number | null = null
let lastScrollFrameTime = 0

function cancelSmoothScroll() {
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }
  targetScrollTop = null
}

function stepSmoothScroll(now: number) {
  const el = previewScrollRef.value
  if (!el || targetScrollTop === null) {
    cancelSmoothScroll()
    return
  }

  const dt = Math.min(0.05, Math.max(0.001, (now - lastScrollFrameTime) / 1000))
  lastScrollFrameTime = now

  const diff = targetScrollTop - el.scrollTop
  if (Math.abs(diff) < 0.5) {
    el.scrollTop = targetScrollTop
    cancelSmoothScroll()
    return
  }

  const factor = 1 - Math.exp(-SCROLL_SMOOTHING * dt)
  el.scrollTop += diff * factor
  scrollRafId = requestAnimationFrame(stepSmoothScroll)
}

function scrollPreviewBy(delta: number) {
  const el = previewScrollRef.value
  if (!el) return

  const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
  const base = targetScrollTop ?? el.scrollTop
  targetScrollTop = Math.max(0, Math.min(maxScroll, base + delta))

  if (scrollRafId === null) {
    lastScrollFrameTime = performance.now()
    scrollRafId = requestAnimationFrame(stepSmoothScroll)
  }
}

watch(
  () => review.currentStepIndex,
  (nextIdx, prevIdx) => {
    cancelSmoothScroll()
    stepTransitionName.value = nextIdx >= prevIdx ? 'step-next' : 'step-prev'
  },
)

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || target.isContentEditable
}

function handleKeydown(e: KeyboardEvent) {
  if (review.screen !== 'review') return
  if (isEditableElement(e.target)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
    e.preventDefault()
    scrollPreviewBy(SCROLL_STEP_PX)
  } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
    e.preventDefault()
    scrollPreviewBy(-SCROLL_STEP_PX)
  } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
    e.preventDefault()
    review.nextStep()
  } else if (e.key === 'h' || e.key === 'H' || e.key === 'ArrowLeft') {
    e.preventDefault()
    review.prevStep()
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault()
    review.toggleReviewed()
  } else if (e.key === '[') {
    e.preventDefault()
    review.sidebarOpen = !review.sidebarOpen
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault()
    if (review.pr) review.showFinishModal = true
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  const minSplashDelay = new Promise((resolve) => setTimeout(resolve, 750))
  await Promise.all([auth.init(), review.init(), minSplashDelay])
  review.screen = 'inbox'
})

onBeforeUnmount(() => {
  cancelSmoothScroll()
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Transition name="screen-fade" mode="out-in">
    <!-- 1. Splash Screen -->
    <SplashScreen v-if="review.screen === 'splash'" key="splash" />

    <!-- 2. Centralized PRs Pending Your Review -->
    <PRInboxView v-else-if="review.screen === 'inbox'" key="inbox" />

    <!-- 4. Short Non-Interactive Success Screen -->
    <ReviewSubmittedView v-else-if="review.screen === 'submitted'" key="submitted" />

    <!-- 3. Guided PR Review Screen -->
    <div v-else key="review" class="flex h-screen flex-col overflow-hidden bg-canvas text-slate-100">
      <TopBar />

      <div class="flex min-h-0 flex-1 overflow-hidden">
        <TourSidebar />

        <main
          ref="previewScrollRef"
          class="relative flex-1 overflow-y-auto overflow-x-hidden bg-canvas"
          @wheel="cancelSmoothScroll"
          @pointerdown="cancelSmoothScroll"
        >
          <template v-if="review.currentStep">
            <Transition :name="stepTransitionName" mode="out-in">
              <DiffViewer :key="review.currentStep.file.path" :step="review.currentStep" />
            </Transition>

            <!-- Bottom Step Pager -->
            <div
              class="mx-auto mb-10 flex max-w-6xl items-center justify-between border-t border-border-muted px-5 pt-4"
            >
              <button
                class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas-subtle px-3.5 py-2 text-xs font-medium text-slate-300 transition-all hover:bg-canvas-elevated active:scale-[0.98] disabled:opacity-40"
                :disabled="review.currentStepIndex === 0"
                @click="review.prevStep()"
              >
                <ChevronLeft class="h-4 w-4" />
                <span>Previous Step</span>
              </button>

              <button
                v-if="review.currentStepIndex < review.tourSteps.length - 1"
                class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.98]"
                @click="review.nextStep()"
              >
                <span>Next Step</span>
                <ChevronRight class="h-4 w-4" />
              </button>

              <button
                v-else
                class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-emerald-500 active:scale-[0.98]"
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
            <FolderGit2 class="h-10 w-10 text-slate-600" />
            <p class="text-sm font-medium text-slate-300">No Pull Request loaded</p>
            <button
              class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-blue-500 active:scale-[0.98]"
              @click="review.backToInbox()"
            >
              Back to PR Inbox
            </button>
          </div>
        </main>
      </div>

      <KeyboardShortcutsBar />
    </div>
  </Transition>

  <!-- Global Modals -->
  <SettingsModal />
  <PRLoaderModal />
  <FinishReviewModal />
</template>
