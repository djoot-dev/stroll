<script setup lang="ts">
import { AlertTriangle, CheckCircle2, MessageSquare } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'

const auth = useAuthStore()
const review = useReviewStore()

const progress = ref(0)
let timer: number | null = null
let rafId: number | null = null

const REDIRECT_MS = 2200

const verdictLabel = computed(() => {
  switch (review.lastSubmitted?.event) {
    case 'APPROVE':
      return 'Pull Request Approved'
    case 'REQUEST_CHANGES':
      return 'Changes Requested'
    default:
      return 'Review Comment Submitted'
  }
})

onMounted(() => {
  const started = performance.now()
  const tick = (now: number) => {
    const elapsed = now - started
    progress.value = Math.min(100, (elapsed / REDIRECT_MS) * 100)
    if (elapsed < REDIRECT_MS) {
      rafId = window.requestAnimationFrame(tick)
    }
  }
  rafId = window.requestAnimationFrame(tick)

  timer = window.setTimeout(() => {
    review.backToInbox()
    if (auth.isAuthenticated) {
      void auth.refreshRequestedPRs()
    }
  }, REDIRECT_MS)
})

onBeforeUnmount(() => {
  if (timer !== null) window.clearTimeout(timer)
  if (rafId !== null) window.cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="flex h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
    <div
      class="animate-pop-in stroll-elevated w-full max-w-md space-y-5 rounded-2xl border border-border bg-canvas-subtle p-8"
    >
      <div
        class="animate-check-pop mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-4"
        :class="
          review.lastSubmitted?.event === 'REQUEST_CHANGES'
            ? 'bg-crimson-soft text-crimson-text ring-crimson-soft'
            : review.lastSubmitted?.event === 'APPROVE'
              ? 'bg-pine-soft text-pine-text ring-pine-soft'
              : 'bg-terra-soft text-terra-text ring-terra-soft'
        "
      >
        <AlertTriangle
          v-if="review.lastSubmitted?.event === 'REQUEST_CHANGES'"
          class="h-7 w-7"
        />
        <MessageSquare
          v-else-if="review.lastSubmitted?.event === 'COMMENT'"
          class="h-7 w-7"
        />
        <CheckCircle2 v-else class="h-7 w-7" />
      </div>

      <div class="space-y-1.5">
        <h1 class="text-lg font-semibold text-ink">{{ verdictLabel }}</h1>
        <p v-if="review.lastSubmitted" class="font-mono text-xs font-medium text-terra-text">
          {{ review.lastSubmitted.prRef }}
        </p>
        <p v-if="review.lastSubmitted" class="line-clamp-2 text-xs text-ink-muted">
          {{ review.lastSubmitted.prTitle }}
        </p>
      </div>

      <p v-if="review.lastSubmitted" class="text-xs text-ink-secondary">
        {{ review.lastSubmitted.commentCount }} inline comment{{
          review.lastSubmitted.commentCount === 1 ? '' : 's'
        }}
        included.
      </p>

      <div class="space-y-2 pt-2">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-canvas-elevated">
          <div
            class="h-full rounded-full bg-pine"
            :style="{ width: `${progress}%` }"
          />
        </div>
        <p class="text-[11px] text-ink-faint">Returning to your PR list…</p>
      </div>
    </div>
  </div>
</template>
