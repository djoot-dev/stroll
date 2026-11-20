<script setup lang="ts">
import UpdateIndicator from './UpdateIndicator.vue'
</script>

<template>
  <footer
    class="flex h-7 shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-border bg-canvas-subtle px-4 text-[11px] text-ink-muted"
  >
    <div class="flex items-center gap-4 overflow-x-auto whitespace-nowrap">
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">O</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">0</kbd> Overview</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">L</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">→</kbd> Next</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">H</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">←</kbd> Prev</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">J</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">↓</kbd> &amp; <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">K</kbd> / <kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">↑</kbd> Scroll</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">M</kbd> Mark Reviewed</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">[</kbd> Toggle Sidebar</span>
      <span><kbd class="rounded border border-border bg-canvas px-1 font-mono text-ink-secondary">R</kbd> Finish Review</span>
    </div>
    <UpdateIndicator class="hidden shrink-0 sm:inline-flex" />
  </footer>
</template>
