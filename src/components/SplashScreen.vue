<script setup lang="ts">
import { computed } from 'vue'
import { AlertCircle, ArrowRight, RotateCw, Settings } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    statusText?: string
    isSlow?: boolean
    error?: string | null
    isRetrying?: boolean
  }>(),
  {
    statusText: 'Preparing your review trail…',
    isSlow: false,
    error: null,
    isRetrying: false,
  },
)

const emit = defineEmits<{
  retry: []
  'open-settings': []
  continue: []
}>()

const displayStatus = computed(() =>
  props.isSlow && props.statusText ? props.statusText : 'Preparing your review trail…',
)
</script>

<template>
  <div class="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-canvas px-6 text-center">
    <!-- Soft organic sage & terracotta ambient halo echoing the Stroll logo -->
    <div
      class="pointer-events-none absolute h-80 w-80 rounded-full bg-sage-soft/80 blur-3xl"
    />
    <div
      class="pointer-events-none absolute translate-x-12 translate-y-8 h-48 w-48 rounded-full bg-terra-soft blur-3xl"
    />

    <div class="animate-pop-in relative flex flex-col items-center gap-5">
      <div class="relative">
        <img
          src="/logo.svg"
          alt="Stroll"
          class="stroll-elevated h-20 w-20 rounded-[22px]"
        />
      </div>

      <div class="space-y-1.5">
        <h1 class="text-2xl font-bold tracking-tight text-ink">Stroll</h1>
        <p class="text-xs text-ink-muted">Guided, dependency-aware code review</p>
      </div>

      <!-- Error recovery state -->
      <div
        v-if="error"
        role="alert"
        class="mt-2 w-full max-w-sm rounded-2xl border border-terra-border bg-canvas-subtle/90 p-4 text-left shadow-xs backdrop-blur-xs"
      >
        <div class="flex items-start gap-2.5">
          <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-terra-text" />
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-ink">Couldn't finish startup</p>
            <p class="mt-1 break-words text-[11px] leading-relaxed text-ink-muted">
              {{ error }}
            </p>
          </div>
        </div>

        <div class="mt-3.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-xl bg-terra px-3 py-1.5 text-[11px] font-semibold text-white shadow-xs transition-all hover:bg-terra-hover active:scale-[0.98] disabled:opacity-60"
            :disabled="isRetrying"
            @click="emit('retry')"
          >
            <RotateCw class="h-3 w-3" :class="{ 'animate-spin': isRetrying }" />
            <span>{{ isRetrying ? 'Retrying…' : 'Retry' }}</span>
          </button>

          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-xl border border-border bg-canvas px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-canvas-elevated"
            @click="emit('open-settings')"
          >
            <Settings class="h-3 w-3 text-ink-muted" />
            <span>GitHub Settings</span>
          </button>

          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-medium text-ink-muted transition-colors hover:text-ink"
            @click="emit('continue')"
          >
            <span>Continue</span>
            <ArrowRight class="h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- Normal / slow loading state -->
      <div
        v-else
        role="status"
        aria-live="polite"
        class="mt-2 flex w-56 flex-col items-center space-y-2"
      >
        <div class="h-1.5 w-48 overflow-hidden rounded-full bg-canvas-elevated">
          <div class="animate-shimmer h-full w-2/5 rounded-full bg-terra" />
        </div>
        <p class="text-[11px] text-ink-faint transition-opacity duration-200">
          {{ displayStatus }}
        </p>
        <button
          v-if="isSlow"
          type="button"
          class="inline-flex items-center gap-1 pt-1 text-[11px] font-medium text-ink-muted transition-colors hover:text-ink"
          @click="emit('continue')"
        >
          <span>Continue to Inbox</span>
          <ArrowRight class="h-3 w-3" />
        </button>
      </div>
    </div>
  </div>
</template>
