<script setup lang="ts">
import { Download, ExternalLink, Laptop, Terminal } from '@lucide/vue'
import { useLatestRelease } from '@/composables/useLatestRelease'

const { detectedPlatform, latestVersion, platforms, releaseUrl } = useLatestRelease()
</script>

<template>
  <section id="download" class="py-16 sm:py-24">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="mx-auto max-w-2xl text-center">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border border-pine-border bg-pine-soft px-3 py-1 text-xs font-medium text-pine-text"
        >
          <Laptop class="h-3.5 w-3.5" />
          Get Started
        </span>
        <h2 class="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Download Stroll
          <span v-if="latestVersion" class="font-mono text-terra-text">
            {{ latestVersion }}
          </span>
        </h2>
        <p class="mt-3 text-sm text-ink-secondary sm:text-base">
          Native Tauri v2 desktop builds for macOS, Windows, and Linux. Sign in
          with <code class="font-mono text-xs">gh</code> CLI or a PAT — or
          explore the built-in offline demo PR with no account needed.
        </p>
      </div>

      <div class="mt-10 grid gap-5 md:grid-cols-3">
        <div
          v-for="platform in platforms"
          :key="platform.id"
          class="flex flex-col justify-between rounded-2xl border p-6 shadow-card transition-colors"
          :class="
            platform.id === detectedPlatform
              ? 'border-terra-border bg-canvas-subtle'
              : 'border-border bg-canvas-subtle/70'
          "
        >
          <div>
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-lg font-semibold text-ink">{{ platform.name }}</h3>
              <span
                v-if="platform.id === detectedPlatform"
                class="rounded-full bg-terra-soft px-2.5 py-0.5 text-[11px] font-medium text-terra-text"
              >
                Recommended
              </span>
            </div>
            <p class="mt-1 text-xs text-ink-muted">{{ platform.subtitle }}</p>
          </div>

          <div class="mt-6 space-y-2.5">
            <a
              :href="platform.primary.url"
              class="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors"
              :class="
                platform.id === detectedPlatform
                  ? 'bg-terra text-white hover:bg-terra-hover'
                  : 'border border-border bg-canvas text-ink hover:border-terra-border'
              "
            >
              <Download class="h-4 w-4" />
              <span>{{ platform.primary.label }}</span>
            </a>

            <a
              v-if="platform.secondary"
              :href="platform.secondary.url"
              class="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border-muted bg-canvas px-3 py-2 text-xs font-medium text-ink-secondary transition-colors hover:border-border hover:text-ink"
            >
              <span>{{ platform.secondary.label }}</span>
            </a>
          </div>
        </div>
      </div>

      <!-- macOS Gatekeeper note + All Releases link -->
      <div
        class="mt-6 flex flex-col items-start justify-between gap-4 rounded-xl border border-border-muted bg-canvas-subtle px-5 py-4 text-xs text-ink-secondary sm:flex-row sm:items-center"
      >
        <div class="flex items-start gap-2.5">
          <Terminal class="mt-0.5 h-4 w-4 shrink-0 text-terra-text" />
          <p>
            <strong class="text-ink">macOS note:</strong> Builds are ad-hoc
            signed. If Gatekeeper blocks first launch, run
            <code class="rounded bg-canvas-inset px-1.5 py-0.5 font-mono text-[11px] text-ink">
              xattr -cr /Applications/Stroll.app
            </code>
            or allow it in <strong>System Settings → Privacy &amp; Security</strong>.
          </p>
        </div>

        <a
          :href="releaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex shrink-0 items-center gap-1 font-medium text-terra-text hover:underline"
        >
          <span>All release notes</span>
          <ExternalLink class="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  </section>
</template>
