<script setup lang="ts">
const base = import.meta.env.BASE_URL
</script>

<template>
  <footer class="border-t border-border-muted bg-canvas-subtle/60 py-10">
    <div
      class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-xs text-ink-muted sm:flex-row sm:px-6"
    >
      <div class="flex items-center gap-2.5">
        <img :src="`${base}logo.svg`" alt="Stroll logo" class="h-6 w-6 rounded-md" />
        <span>
          <strong class="font-semibold text-ink">Stroll</strong> — Guided Code
          Review · MIT License © djoot-dev
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-5 font-medium text-ink-secondary">
        <a
          href="https://github.com/djoot-dev/stroll"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink"
        >
          GitHub
        </a>
        <a
          href="https://github.com/djoot-dev/stroll/releases"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink"
        >
          Releases
        </a>
        <a
          href="https://github.com/djoot-dev/stroll/issues"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink"
        >
          Issues
        </a>
        <a
          href="https://github.com/djoot-dev/stroll/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-ink"
        >
          License
        </a>
      </div>
    </div>
  </footer>
</template>
