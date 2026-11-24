<script setup lang="ts">
import { ArrowRight, Download, Footprints, Sparkles } from '@lucide/vue'
import { useLatestRelease } from '@/composables/useLatestRelease'
import { useTheme } from '@/composables/useTheme'

const { isDark } = useTheme()
const { activePlatform, latestVersion } = useLatestRelease()
const base = import.meta.env.BASE_URL
</script>

<template>
  <section id="top" class="relative overflow-hidden pt-12 pb-16 sm:pt-20 sm:pb-24">
    <!-- Subtle warm sage & terracotta atmospheric wash -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 -top-24 -z-10 mx-auto h-96 max-w-4xl rounded-full bg-sage-soft/50 blur-3xl"
    />

    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="mx-auto max-w-3xl text-center">
        <div
          class="mb-5 inline-flex items-center gap-2 rounded-full border border-terra-border bg-terra-soft px-3.5 py-1 text-xs font-medium text-terra-text"
        >
          <Footprints class="h-3.5 w-3.5" />
          <span>Guided Code Review for GitHub Pull Requests</span>
          <span
            v-if="latestVersion"
            class="rounded-full bg-canvas-subtle px-2 py-0.5 font-mono text-[11px] text-ink-secondary"
          >
            {{ latestVersion }}
          </span>
        </div>

        <h1
          class="text-3xl font-bold tracking-tight text-ink sm:text-5xl lg:text-6xl"
        >
          Review Pull Requests as a
          <span class="text-terra-text">guided tour</span>, not an alphabetical
          list.
        </h1>

        <p
          class="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-secondary sm:text-lg"
        >
          Stroll sorts PR files by architectural layer and import dependencies,
          pairs tests right after their implementation, and walks you through
          one focused file at a time.
        </p>

        <div
          class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a
            :href="activePlatform.primary.url"
            class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-terra px-5 py-3 text-sm font-semibold text-white shadow-card transition-colors hover:bg-terra-hover sm:w-auto"
          >
            <Download class="h-4 w-4" />
            <span>Download for {{ activePlatform.name }}</span>
          </a>

          <a
            href="#download"
            class="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-canvas-subtle px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-terra-border sm:w-auto"
          >
            <span>All platforms</span>
            <ArrowRight class="h-4 w-4 text-ink-muted" />
          </a>

          <a
            href="https://github.com/totalfreak/stroll"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-canvas-subtle px-4 py-3 text-sm font-medium text-ink-secondary transition-colors hover:border-pine-border hover:text-ink sm:w-auto"
          >
            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.09.73-.24.73-.53v-1.85c-3.03.66-3.67-1.45-3.67-1.45-.5-1.29-1.21-1.64-1.21-1.64-.99-.68.07-.66.07-.66 1.09.08 1.67 1.12 1.67 1.12.97 1.66 2.54 1.18 3.16.9.1-.7.38-1.18.69-1.45-2.42-.27-4.96-1.21-4.96-5.4 0-1.19.42-2.17 1.12-2.93-.11-.28-.49-1.38.11-2.89 0 0 .92-.29 3 1.12a10.4 10.4 0 0 1 5.5 0c2.08-1.41 3-1.12 3-1.12.6 1.51.22 2.61.11 2.89.7.76 1.12 1.74 1.12 2.93 0 4.2-2.55 5.12-4.98 5.39.39.34.74 1.01.74 2.04v3.02c0 .29.19.63.74.53A11 11 0 0 0 12 1.27" />
            </svg>
            <span>View Source</span>
          </a>
        </div>

        <p class="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-muted">
          <Sparkles class="h-3.5 w-3.5 text-pine-text" />
          <span>
            macOS, Windows &amp; Linux · Sign in with
            <code class="font-mono text-ink-secondary">gh</code> CLI, PAT, or try
            the built-in offline demo PR.
          </span>
        </p>
      </div>

      <!-- Hero App Screenshot Frame -->
      <div class="mt-12 sm:mt-16">
        <div
          class="overflow-hidden rounded-2xl border border-border bg-canvas-subtle shadow-elevated"
        >
          <div
            class="flex items-center justify-between border-b border-border-muted bg-canvas-elevated/70 px-4 py-2.5"
          >
            <div class="flex items-center gap-1.5">
              <span class="h-2.5 w-2.5 rounded-full bg-crimson/70" />
              <span class="h-2.5 w-2.5 rounded-full bg-ochre-text/60" />
              <span class="h-2.5 w-2.5 rounded-full bg-pine/70" />
            </div>
            <span class="truncate font-mono text-xs text-ink-muted">
              Stroll — acme-cloud/webhook-engine #428 (Demo Tour)
            </span>
            <span
              class="hidden rounded-md border border-border bg-canvas-subtle px-2 py-0.5 text-[11px] font-medium text-ink-secondary sm:inline-block"
            >
              {{ isDark ? 'Deep Pine Dark' : 'Warm Parchment' }}
            </span>
          </div>
          <img
            :src="isDark ? `${base}screenshots/hero-dark.png` : `${base}screenshots/hero-light.png`"
            alt="Stroll desktop application showing the guided tour sidebar on the left and a syntax-highlighted diff with Referenced PR Context and inline comments on the right"
            class="block w-full object-cover"
            loading="eager"
          />
        </div>
      </div>
    </div>
  </section>
</template>
