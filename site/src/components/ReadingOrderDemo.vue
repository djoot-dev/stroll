<script setup lang="ts">
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, FileCode2, Link2 } from '@lucide/vue'
import { computed, ref } from 'vue'

type OrderMode = 'alphabetical' | 'bottom-up' | 'top-down'

interface TourFile {
  id: string
  path: string
  layer: 'CONFIG' | 'TYPES' | 'CORE' | 'UI' | 'TESTS'
  note: string
  paired?: boolean
}

const mode = ref<OrderMode>('bottom-up')

const FILES_BY_MODE: Record<OrderMode, TourFile[]> = {
  alphabetical: [
    {
      id: 'pkg',
      path: 'package.json',
      layer: 'CONFIG',
      note: 'Mixed in at the top only because "p" comes before "s"',
    },
    {
      id: 'card',
      path: 'src/components/WebhookCard.vue',
      layer: 'UI',
      note: 'Appears before the types and rate limiter it consumes',
    },
    {
      id: 'test',
      path: 'src/services/rateLimiter.test.ts',
      layer: 'TESTS',
      note: 'Read before seeing the implementation it tests',
    },
    {
      id: 'limiter',
      path: 'src/services/rateLimiter.ts',
      layer: 'CORE',
      note: 'Imports WebhookEndpoint & backoff, but shows up fourth',
    },
    {
      id: 'types',
      path: 'src/types/webhook.ts',
      layer: 'TYPES',
      note: 'Shared interfaces buried near the bottom',
    },
    {
      id: 'backoff',
      path: 'src/utils/backoff.ts',
      layer: 'CORE',
      note: 'Leaf helper seen dead last',
    },
  ],
  'bottom-up': [
    {
      id: 'pkg',
      path: 'package.json',
      layer: 'CONFIG',
      note: '1. Dependencies & config changes first',
    },
    {
      id: 'types',
      path: 'src/types/webhook.ts',
      layer: 'TYPES',
      note: '2. Data contracts before any callers',
    },
    {
      id: 'backoff',
      path: 'src/utils/backoff.ts',
      layer: 'CORE',
      note: '3. Leaf utility (imported by rateLimiter.ts)',
    },
    {
      id: 'limiter',
      path: 'src/services/rateLimiter.ts',
      layer: 'CORE',
      note: '4. Core service after its imports',
    },
    {
      id: 'test',
      path: 'src/services/rateLimiter.test.ts',
      layer: 'TESTS',
      note: '5. Paired right after its implementation',
      paired: true,
    },
    {
      id: 'card',
      path: 'src/components/WebhookCard.vue',
      layer: 'UI',
      note: '6. UI consumer last, with full mental model',
    },
  ],
  'top-down': [
    {
      id: 'pkg',
      path: 'package.json',
      layer: 'CONFIG',
      note: '1. Config & manifest changes first',
    },
    {
      id: 'card',
      path: 'src/components/WebhookCard.vue',
      layer: 'UI',
      note: '2. Entry-point UI component',
    },
    {
      id: 'limiter',
      path: 'src/services/rateLimiter.ts',
      layer: 'CORE',
      note: '3. Core service called by the UI',
    },
    {
      id: 'test',
      path: 'src/services/rateLimiter.test.ts',
      layer: 'TESTS',
      note: '4. Paired right after its implementation',
      paired: true,
    },
    {
      id: 'backoff',
      path: 'src/utils/backoff.ts',
      layer: 'CORE',
      note: '5. Supporting utility',
    },
    {
      id: 'types',
      path: 'src/types/webhook.ts',
      layer: 'TYPES',
      note: '6. Underlying type definitions',
    },
  ],
}

const activeFiles = computed(() => FILES_BY_MODE[mode.value])

function layerBadgeClass(layer: TourFile['layer']) {
  switch (layer) {
    case 'CONFIG':
      return 'bg-ochre-soft text-ochre-text border-ochre-border'
    case 'TYPES':
      return 'bg-plum-soft text-plum-text border-plum-border'
    case 'CORE':
      return 'bg-terra-soft text-terra-text border-terra-border'
    case 'UI':
      return 'bg-sage-soft text-sage-text border-sage-border'
    case 'TESTS':
      return 'bg-pine-soft text-pine-text border-pine-border'
  }
}
</script>

<template>
  <section id="tour" class="border-y border-border-muted bg-canvas-subtle/60 py-16 sm:py-24">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="grid items-center gap-10 lg:grid-cols-12">
        <div class="min-w-0 lg:col-span-5">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-pine-border bg-pine-soft px-3 py-1 text-xs font-medium text-pine-text"
          >
            Guided Reading Order Engine
          </span>
          <h2 class="mt-4 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Stop jumping back and forth across A–Z diffs.
          </h2>
          <p class="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
            GitHub sorts files alphabetically, forcing you to read UI components
            and tests before the types and helpers they depend on.
          </p>
          <p class="mt-3 text-sm leading-relaxed text-ink-secondary sm:text-base">
            Stroll classifies files into
            <code class="rounded bg-canvas-inset px-1.5 py-0.5 font-mono text-xs text-ink">config</code>
            →
            <code class="rounded bg-canvas-inset px-1.5 py-0.5 font-mono text-xs text-ink">types</code>
            →
            <code class="rounded bg-canvas-inset px-1.5 py-0.5 font-mono text-xs text-ink">core</code>
            →
            <code class="rounded bg-canvas-inset px-1.5 py-0.5 font-mono text-xs text-ink">ui</code>
            →
            <code class="rounded bg-canvas-inset px-1.5 py-0.5 font-mono text-xs text-ink">tests</code>,
            parses relative, <code class="font-mono text-xs">@/</code>, Python,
            and C# imports, and pairs test files right after their implementation.
          </p>

          <div class="mt-6 flex flex-wrap gap-2" role="group" aria-label="Reading order mode">
            <button
              type="button"
              class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                mode === 'alphabetical'
                  ? 'border-crimson-border bg-crimson-soft text-crimson-text'
                  : 'border-border bg-canvas-subtle text-ink-secondary hover:text-ink'
              "
              @click="mode = 'alphabetical'"
            >
              Before: Alphabetical
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                mode === 'bottom-up'
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas-subtle text-ink-secondary hover:text-ink'
              "
              @click="mode = 'bottom-up'"
            >
              <ArrowUp class="h-3.5 w-3.5" />
              Bottom-Up Tour
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              :class="
                mode === 'top-down'
                  ? 'border-pine-border bg-pine-soft text-pine-text'
                  : 'border-border bg-canvas-subtle text-ink-secondary hover:text-ink'
              "
              @click="mode = 'top-down'"
            >
              <ArrowDown class="h-3.5 w-3.5" />
              Top-Down Tour
            </button>
          </div>
        </div>

        <div class="min-w-0 lg:col-span-7">
          <div
            class="rounded-2xl border border-border bg-canvas p-4 shadow-card sm:p-5"
          >
            <div class="mb-3 flex items-center justify-between text-xs text-ink-muted">
              <span class="font-medium">
                {{
                  mode === 'alphabetical'
                    ? 'Flat A–Z file list (6 files)'
                    : mode === 'bottom-up'
                      ? 'Stroll Guided Tour · Bottom-Up (Dependencies first)'
                      : 'Stroll Guided Tour · Top-Down (UI entry points first)'
                }}
              </span>
              <span class="font-mono text-[11px]">
                {{ mode === 'alphabetical' ? 'Unordered' : 'Topological' }}
              </span>
            </div>

            <TransitionGroup
              name="tour-list"
              tag="ol"
              class="space-y-2"
            >
              <li
                v-for="(file, idx) in activeFiles"
                :key="file.id"
                class="flex items-start justify-between gap-3 rounded-xl border border-border-muted bg-canvas-subtle px-3.5 py-2.5 transition-all"
                :class="file.paired ? 'ml-4 border-l-2 border-l-pine' : ''"
              >
                <div class="flex min-w-0 items-start gap-3">
                  <span
                    class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold"
                    :class="
                      mode === 'alphabetical'
                        ? 'bg-canvas-inset text-ink-muted'
                        : 'bg-terra-soft text-terra-text'
                    "
                  >
                    {{ idx + 1 }}
                  </span>
                  <div class="min-w-0">
                    <div class="flex min-h-5 flex-nowrap items-center gap-2">
                      <FileCode2 class="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                      <span class="truncate font-mono text-xs font-medium text-ink">
                        {{ file.path }}
                      </span>
                      <span
                        v-if="file.paired"
                        class="inline-flex shrink-0 items-center gap-1 rounded bg-pine-soft px-1.5 py-0.5 text-[10px] font-medium text-pine-text"
                      >
                        <Link2 class="h-2.5 w-2.5" />
                        Paired test
                      </span>
                    </div>
                    <p class="mt-0.5 truncate text-xs text-ink-muted">{{ file.note }}</p>
                  </div>
                </div>

                <span
                  class="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                  :class="layerBadgeClass(file.layer)"
                >
                  {{ file.layer }}
                </span>
              </li>
            </TransitionGroup>

            <div
              class="mt-3 flex items-center gap-1.5 text-xs"
              :class="mode === 'alphabetical' ? 'text-crimson-text' : 'text-pine-text'"
            >
              <AlertCircle v-if="mode === 'alphabetical'" class="h-3.5 w-3.5 shrink-0" />
              <CheckCircle2 v-else class="h-3.5 w-3.5 shrink-0" />
              <span>
                {{
                  mode === 'alphabetical'
                    ? 'You read UI callers and tests before the types they depend on.'
                    : "Every file's imports are already in your head before you open it."
                }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tour-list-move {
  transition: transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .tour-list-move {
    transition: none;
  }
}
</style>
