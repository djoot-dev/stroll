<script setup lang="ts">
import UpdateIndicator from './UpdateIndicator.vue'

const emit = defineEmits<{
  (e: 'openCheatsheet'): void
}>()
</script>

<template>
  <footer
    class="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-border bg-canvas-subtle px-4 text-[11px] text-ink-muted"
  >
    <div class="flex items-center gap-4 overflow-x-auto whitespace-nowrap">
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">O</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">0</kbd> Overview</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">L</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">→</kbd> Next</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">H</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">←</kbd> Prev</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">N</kbd> Next unreviewed</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">M</kbd> Mark Reviewed</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">R</kbd> Finish Review</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">⌘K</kbd> Jump</span>
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
