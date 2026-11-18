<script setup lang="ts">
import { AlertTriangle, Check, Loader2, MessageSquare, Send, Trash2, X } from '@lucide/vue'
import { ref, watch } from 'vue'
import { useReviewStore } from '@/stores/review'
import type { ReviewEvent } from '@/types/pr'

const review = useReviewStore()

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
  const ok = await review.submitCompleteReview(selectedEvent.value, summary.value)
  if (ok) {
    summary.value = ''
  }
}
</script>

<template>
  <div
    v-if="review.showFinishModal && review.pr"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    @click.self="review.showFinishModal = false"
  >
    <div class="w-full max-w-xl rounded-xl border border-border bg-canvas-subtle shadow-2xl">
      <div class="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div class="flex items-center gap-2">
          <Send class="h-4 w-4 text-emerald-400" />
          <h2 class="text-sm font-semibold text-slate-100">
            Finish Review — {{ review.pr.owner }}/{{ review.pr.repo }}#{{ review.pr.number }}
          </h2>
        </div>
        <button
          class="rounded p-1 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
          @click="review.showFinishModal = false"
        >
          <X class="h-4 w-4" />
        </button>
      </div>

      <div class="space-y-4 p-5">
        <!-- Pending Draft Comments Summary -->
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="font-medium text-slate-300">
              Pending Inline Comments ({{ review.draftComments.length }})
            </span>
            <span class="text-slate-500">
              {{ review.reviewedCount }} / {{ review.tourSteps.length }} files marked reviewed
            </span>
          </div>

          <div
            v-if="review.draftComments.length === 0"
            class="rounded-lg border border-border-muted bg-canvas-inset p-3 text-xs text-slate-500"
          >
            No pending inline comments. You can still submit an overall review summary below.
          </div>

          <div v-else class="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            <div
              v-for="draft in review.draftComments"
              :key="draft.id"
              class="flex items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs"
            >
              <div class="min-w-0">
                <div class="font-mono text-[11px] text-amber-300">
                  {{ draft.path }}:{{ draft.line }}
                </div>
                <p class="mt-0.5 line-clamp-2 text-slate-200">{{ draft.body }}</p>
              </div>
              <button
                class="shrink-0 text-slate-400 hover:text-rose-400"
                @click="review.deleteDraftComment(draft.id)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <!-- Review Summary -->
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-300">Review Summary</label>
          <textarea
            v-model="summary"
            rows="4"
            placeholder="Leave an overall summary of your review..."
            class="w-full rounded-lg border border-border bg-canvas-inset px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <!-- Verdict Selector -->
        <div class="grid grid-cols-3 gap-2">
          <button
            class="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
            :class="
              selectedEvent === 'COMMENT'
                ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                : 'border-border bg-canvas text-slate-400 hover:bg-canvas-elevated'
            "
            @click="selectedEvent = 'COMMENT'"
          >
            <MessageSquare class="h-3.5 w-3.5" />
            <span>Comment</span>
          </button>

          <button
            class="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
            :class="
              selectedEvent === 'APPROVE'
                ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                : 'border-border bg-canvas text-slate-400 hover:bg-canvas-elevated'
            "
            @click="selectedEvent = 'APPROVE'"
          >
            <Check class="h-3.5 w-3.5" />
            <span>Approve</span>
          </button>

          <button
            class="flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
            :class="
              selectedEvent === 'REQUEST_CHANGES'
                ? 'border-rose-500 bg-rose-500/15 text-rose-300'
                : 'border-border bg-canvas text-slate-400 hover:bg-canvas-elevated'
            "
            @click="selectedEvent = 'REQUEST_CHANGES'"
          >
            <AlertTriangle class="h-3.5 w-3.5" />
            <span>Request Changes</span>
          </button>
        </div>

        <div
          v-if="review.submitError"
          class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          {{ review.submitError }}
        </div>

        <div
          v-if="review.submitSuccessMessage"
          class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
        >
          {{ review.submitSuccessMessage }}
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <button
          class="rounded-lg border border-border bg-canvas px-3.5 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated"
          @click="review.showFinishModal = false"
        >
          Cancel
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          :disabled="review.isSubmittingReview"
          @click="handleSubmit"
        >
          <Loader2 v-if="review.isSubmittingReview" class="h-3.5 w-3.5 animate-spin" />
          <span>Submit Review</span>
        </button>
      </div>
    </div>
  </div>
</template>
