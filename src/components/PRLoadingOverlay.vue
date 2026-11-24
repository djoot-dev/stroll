<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { useReviewStore } from '@/stores/review'

const review = useReviewStore()
</script>

<template>
  <Transition name="modal-pop">
    <div
      v-if="review.isLoadingPR && !review.showLoaderModal"
      role="status"
      aria-live="polite"
      class="stroll-backdrop fixed inset-0 z-40 flex items-center justify-center p-4 backdrop-blur-[2px]"
    >
      <div
        class="stroll-elevated flex w-full max-w-sm flex-col items-center rounded-2xl border border-border bg-canvas-subtle px-6 py-7 text-center"
      >
        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-terra-soft text-terra">
          <Loader2 class="h-6 w-6 animate-spin" />
        </div>
        <h3 class="mt-4 text-sm font-semibold text-ink">Opening Pull Request…</h3>
        <p v-if="review.loadingPRKey" class="mt-1 font-mono text-xs text-terra-text">
          {{ review.loadingPRKey }}
        </p>
        <p class="mt-1.5 text-xs text-ink-muted">
          Fetching files, diffs, and building tour order…
        </p>
        <button
          type="button"
          class="mt-4 rounded-lg border border-border bg-canvas px-3 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
          @click="review.dismissPRLoading()"
        >
          Dismiss
        </button>
      </div>
    </div>
  </Transition>
</template>
