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
      class="animate-pop-in w-full max-w-md space-y-5 rounded-2xl border border-border bg-canvas-subtle p-8 shadow-2xl"
    >
      <div
        class="animate-check-pop mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-4"
        :class="
          review.lastSubmitted?.event === 'REQUEST_CHANGES'
            ? 'bg-rose-500/15 text-rose-400 ring-rose-500/10'
            : review.lastSubmitted?.event === 'APPROVE'
              ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/10'
              : 'bg-blue-500/15 text-blue-400 ring-blue-500/10'
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
        <h1 class="text-lg font-semibold text-slate-100">{{ verdictLabel }}</h1>
        <p v-if="review.lastSubmitted" class="font-mono text-xs text-blue-400">
          {{ review.lastSubmitted.prRef }}
        </p>
        <p v-if="review.lastSubmitted" class="line-clamp-2 text-xs text-slate-400">
          {{ review.lastSubmitted.prTitle }}
        </p>
      </div>

      <p v-if="review.lastSubmitted" class="text-xs text-slate-300">
        {{ review.lastSubmitted.commentCount }} inline comment{{
          review.lastSubmitted.commentCount === 1 ? '' : 's'
        }}
        included.
      </p>

      <div class="space-y-2 pt-2">
        <div class="h-1 w-full overflow-hidden rounded-full bg-canvas-inset">
          <div
            class="h-full bg-emerald-500"
            :style="{ width: `${progress}%` }"
          />
        </div>
        <p class="text-[11px] text-slate-500">Returning to your PR list…</p>
      </div>
    </div>
  </div>
</template>
