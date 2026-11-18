<script setup lang="ts">
import { ChevronLeft, ChevronRight, FolderGit2 } from '@lucide/vue'
import { onBeforeUnmount, onMounted } from 'vue'
import DiffViewer from '@/components/DiffViewer.vue'
import FinishReviewModal from '@/components/FinishReviewModal.vue'
import KeyboardShortcutsBar from '@/components/KeyboardShortcutsBar.vue'
import PRLoaderModal from '@/components/PRLoaderModal.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import TopBar from '@/components/TopBar.vue'
import TourSidebar from '@/components/TourSidebar.vue'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'

const auth = useAuthStore()
const review = useReviewStore()

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || target.isContentEditable
}

function handleKeydown(e: KeyboardEvent) {
  if (isEditableElement(e.target)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowRight') {
    e.preventDefault()
    review.nextStep()
  } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowLeft') {
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
  await Promise.all([auth.init(), review.init()])
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-canvas text-slate-100">
    <TopBar />

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <TourSidebar />

      <main class="relative flex-1 overflow-y-auto bg-canvas">
        <template v-if="review.currentStep">
          <DiffViewer :step="review.currentStep" />

          <!-- Bottom Step Pager -->
          <div
            class="mx-auto mb-10 flex max-w-6xl items-center justify-between border-t border-border-muted px-5 pt-4"
          >
            <button
              class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas-subtle px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-canvas-elevated disabled:opacity-40"
              :disabled="review.currentStepIndex === 0"
              @click="review.prevStep()"
            >
              <ChevronLeft class="h-4 w-4" />
              <span>Previous Step</span>
            </button>

            <button
              v-if="review.currentStepIndex < review.tourSteps.length - 1"
              class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              @click="review.nextStep()"
            >
              <span>Next Step</span>
              <ChevronRight class="h-4 w-4" />
            </button>

            <button
              v-else
              class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
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
            class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
            @click="review.showLoaderModal = true"
          >
            Load a Pull Request
          </button>
        </div>
      </main>
    </div>

    <KeyboardShortcutsBar />

    <!-- Modals -->
    <SettingsModal />
    <PRLoaderModal />
    <FinishReviewModal />
  </div>
</template>
