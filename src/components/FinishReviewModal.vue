<script setup lang="ts">
import {
  AlertTriangle,
  Check,
  CornerDownRight,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  X,
} from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import type { ReviewEvent } from '@/types/pr'

const review = useReviewStore()
const settings = useSettingsStore()

const summary = ref('')
const selectedEvent = ref<ReviewEvent>('COMMENT')

watch(
  () => review.showFinishModal,
  (open) => {
    if (open) {
      review.submitError = null
      review.submitSuccessMessage = null
    }
  },
)

async function handleSubmit() {
  if (review.isSubmittingReview) return
  const ok = await review.submitCompleteReview(selectedEvent.value, summary.value)
  if (ok) {
    summary.value = ''
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!review.showFinishModal || !review.pr || settings.isOpen) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.altKey) {
    e.preventDefault()
    void handleSubmit()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Transition name="modal-pop">
    <div
      v-if="review.showFinishModal && review.pr"
      class="stroll-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      @click.self="review.showFinishModal = false"
    >
      <div class="stroll-elevated w-full max-w-xl rounded-2xl border border-border bg-canvas-subtle">
        <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div class="flex items-center gap-2">
            <Send class="h-4 w-4 text-pine" />
            <h2 class="text-sm font-semibold text-ink">
              Finish Review — {{ review.pr.owner }}/{{ review.pr.repo }}#{{ review.pr.number }}
            </h2>
          </div>
          <button
            class="rounded-lg p-1 text-ink-muted hover:bg-canvas-elevated hover:text-ink"
            @click="review.showFinishModal = false"
          >
            <X class="h-4 w-4" />
          </button>
        </div>

        <div class="space-y-4 p-5">
          <!-- Pending Draft Comments Summary -->
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-ink-secondary">
                Pending Inline Comments ({{ review.draftComments.length }})
              </span>
              <span class="text-ink-muted">
                {{ review.reviewedCount }} / {{ review.tourSteps.length }} files marked reviewed
              </span>
            </div>

            <div
              v-if="review.draftComments.length === 0"
              class="rounded-xl border border-border-muted bg-canvas-inset p-3 text-xs text-ink-muted"
            >
              No pending inline comments. You can still submit an overall review summary below.
            </div>

            <div v-else class="max-h-40 space-y-1.5 overflow-x-hidden overflow-y-auto pr-1">
              <div
                v-for="draft in review.draftComments"
                :key="draft.id"
                class="flex items-start justify-between gap-3 rounded-xl border border-ochre-border bg-ochre-soft p-2.5 text-xs"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-mono text-[11px] font-medium break-all text-ochre-text">
                    {{ draft.path
                    }}<template v-if="draft.subjectType === 'FILE'">
                      <span class="ml-1 font-sans text-[10px] text-ink-muted">(file)</span>
                    </template><template v-else>:{{
                      draft.startLine && draft.startLine !== draft.line
                        ? `${draft.startLine}-${draft.line}`
                        : draft.line
                    }}</template>
                  </div>
                  <p class="mt-0.5 line-clamp-2 break-words text-ink">{{ draft.body }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <button
                    class="text-ink-muted hover:text-ink"
                    title="Go to comment in file"
                    aria-label="Go to comment in file"
                    @click="review.focusDraftComment(draft.id)"
                  >
                    <CornerDownRight class="h-3.5 w-3.5" />
                  </button>
                  <button
                    class="text-ink-muted hover:text-crimson-text"
                    title="Delete pending comment"
                    aria-label="Delete pending comment"
                    @click="review.deleteDraftComment(draft.id)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Review Summary -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-ink-secondary">Review Summary</label>
            <textarea
              v-model="summary"
              rows="4"
              placeholder="Leave an overall summary of your review..."
              class="w-full rounded-xl border border-border bg-canvas-inset px-3 py-2 text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
            />
          </div>

          <!-- Verdict Selector -->
          <div class="grid grid-cols-3 gap-2">
            <button
              class="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
              :class="
                selectedEvent === 'COMMENT'
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
              "
              @click="selectedEvent = 'COMMENT'"
            >
              <MessageSquare class="h-3.5 w-3.5" />
              <span>Comment</span>
            </button>

            <button
              class="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
              :class="
                selectedEvent === 'APPROVE'
                  ? 'border-pine-border bg-pine-soft text-pine-text'
                  : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
              "
              @click="selectedEvent = 'APPROVE'"
            >
              <Check class="h-3.5 w-3.5" />
              <span>Approve</span>
            </button>

            <button
              class="flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
              :class="
                selectedEvent === 'REQUEST_CHANGES'
                  ? 'border-crimson-border bg-crimson-soft text-crimson-text'
                  : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
              "
              @click="selectedEvent = 'REQUEST_CHANGES'"
            >
              <AlertTriangle class="h-3.5 w-3.5" />
              <span>Request Changes</span>
            </button>
          </div>

          <div
            v-if="review.submitError"
            class="rounded-xl border border-crimson-border bg-crimson-soft px-3 py-2 text-xs text-crimson-text"
          >
            {{ review.submitError }}
          </div>

          <div
            v-if="review.submitSuccessMessage"
            class="rounded-xl border border-pine-border bg-pine-soft px-3 py-2 text-xs text-pine-text"
          >
            {{ review.submitSuccessMessage }}
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span class="text-[11px] text-ink-faint">Ctrl+↵ / ⌘↵ to submit</span>
          <div class="flex items-center gap-2">
            <button
              class="rounded-xl border border-border bg-canvas px-3.5 py-1.5 text-xs text-ink-secondary hover:bg-canvas-elevated"
              @click="review.showFinishModal = false"
            >
              Cancel
            </button>
            <button
              class="inline-flex items-center gap-1.5 rounded-xl bg-pine px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-pine-hover disabled:opacity-40"
              :disabled="review.isSubmittingReview"
              @click="handleSubmit"
            >
              <Loader2 v-if="review.isSubmittingReview" class="h-3.5 w-3.5 animate-spin" />
              <span>Submit Review</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
