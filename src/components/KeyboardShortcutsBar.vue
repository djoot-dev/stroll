<script setup lang="ts">
import { computed } from 'vue'
import { isMacPlatform } from '@/services/shortcuts'
import { getContextualShortcutHints } from '@/services/shortcutsBar'
import { useReviewStore } from '@/stores/review'
import UpdateIndicator from './UpdateIndicator.vue'

const emit = defineEmits<{
  (e: 'openCheatsheet'): void
}>()

const review = useReviewStore()
const isMac = isMacPlatform()

const hints = computed(() =>
  getContextualShortcutHints({
    hasPR: Boolean(review.pr),
    activeView: review.activeView,
    stepCount: review.tourSteps.length,
    currentStepIndex: review.currentStepIndex,
    hasUnreviewedSteps: review.reviewedCount < review.tourSteps.length,
    currentStepReviewed: review.currentStep
      ? review.isStepReviewed(review.currentStep.file.path)
      : false,
    isMac,
  }),
)
</script>

<template>
  <footer
    class="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-border bg-canvas-subtle px-4 text-[11px] text-ink-muted"
  >
    <div class="flex items-center gap-4 overflow-x-auto whitespace-nowrap">
      <span
        v-for="hint in hints"
        :key="hint.id"
        class="inline-flex items-center gap-1 transition-opacity duration-150"
        :class="hint.enabled ? 'opacity-100' : 'opacity-35'"
        :aria-disabled="!hint.enabled || undefined"
        :title="hint.disabledReason"
      >
        <template v-for="(key, idx) in hint.keys" :key="key">
          <span v-if="idx > 0" class="text-ink-faint">/</span>
          <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">
            {{ key }}
          </kbd>
        </template>
        <span>{{ hint.label }}</span>
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
        title="Show all keyboard shortcuts (?)"
        @click="emit('openCheatsheet')"
      >
        <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">?</kbd>
        <span class="hidden sm:inline">Shortcuts</span>
      </button>
      <UpdateIndicator class="hidden shrink-0 sm:inline-flex" />
    </div>
  </footer>
</template>
