<script setup lang="ts">
import { Download, Moon, Sun } from '@lucide/vue'
import { useTheme } from '@/composables/useTheme'

const { isDark, toggleTheme } = useTheme()
const base = import.meta.env.BASE_URL
</script>

<template>
  <header
    class="sticky top-0 z-40 border-b border-border/80 bg-canvas/85 backdrop-blur-md"
  >
    <div
      class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
    >
      <a href="#top" class="flex items-center gap-2.5 text-ink">
        <img :src="`${base}logo.svg`" alt="Stroll logo" class="h-8 w-8 rounded-lg" />
        <span class="text-base font-semibold tracking-tight">Stroll</span>
      </a>

      <nav
        aria-label="Primary"
        class="hidden items-center gap-6 text-sm font-medium text-ink-secondary md:flex"
      >
        <a href="#tour" class="transition-colors hover:text-ink">The Tour</a>
        <a href="#features" class="transition-colors hover:text-ink">Features</a>
        <a href="#shortcuts" class="transition-colors hover:text-ink">Shortcuts</a>
        <a href="#download" class="transition-colors hover:text-ink">Get Started</a>
      </nav>

      <div class="flex items-center gap-2">
        <button
          type="button"
          :aria-label="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
          class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-canvas-subtle text-ink-secondary transition-colors hover:border-terra-border hover:text-ink"
          @click="toggleTheme"
        >
          <Sun v-if="isDark" class="h-4 w-4" />
          <Moon v-else class="h-4 w-4" />
        </button>

        <a
          href="https://github.com/djoot-dev/stroll"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Stroll on GitHub"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-canvas-subtle px-3 text-sm font-medium text-ink-secondary transition-colors hover:border-terra-border hover:text-ink"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.09.73-.24.73-.53v-1.85c-3.03.66-3.67-1.45-3.67-1.45-.5-1.29-1.21-1.64-1.21-1.64-.99-.68.07-.66.07-.66 1.09.08 1.67 1.12 1.67 1.12.97 1.66 2.54 1.18 3.16.9.1-.7.38-1.18.69-1.45-2.42-.27-4.96-1.21-4.96-5.4 0-1.19.42-2.17 1.12-2.93-.11-.28-.49-1.38.11-2.89 0 0 .92-.29 3 1.12a10.4 10.4 0 0 1 5.5 0c2.08-1.41 3-1.12 3-1.12.6 1.51.22 2.61.11 2.89.7.76 1.12 1.74 1.12 2.93 0 4.2-2.55 5.12-4.98 5.39.39.34.74 1.01.74 2.04v3.02c0 .29.19.63.74.53A11 11 0 0 0 12 1.27" />
          </svg>
          <span class="hidden sm:inline">GitHub</span>
        </a>

        <a
          href="#download"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-terra px-3.5 text-sm font-medium text-white shadow-card transition-colors hover:bg-terra-hover"
        >
          <Download class="h-4 w-4" />
          <span>Download</span>
        </a>
      </div>
    </div>
  </header>
</template>
