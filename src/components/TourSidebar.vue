<script setup lang="ts">
import { Check, MessageSquare } from '@lucide/vue'
import { LAYER_META } from '@/services/readingOrder'
import { useReviewStore } from '@/stores/review'

const review = useReviewStore()

function draftCountForFile(path: string): number {
  const drafts = review.draftComments.filter((d) => d.path === path).length
  const existing = review.pr?.threads.filter((t) => t.path === path).length ?? 0
  return drafts + existing
}

function fileNameOnly(path: string): string {
  return path.split('/').pop() ?? path
}

function dirOnly(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}
</script>

<template>
  <Transition name="sidebar-slide">
    <aside
      v-if="review.sidebarOpen && review.pr"
      class="flex w-72 shrink-0 flex-col border-r border-border bg-canvas-subtle"
    >
      <!-- PR Summary Header -->
      <div class="border-b border-border p-3.5">
        <h2 class="line-clamp-2 text-xs font-semibold leading-snug text-ink">
          {{ review.pr.title }}
        </h2>
        <div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
          <span class="shrink-0 whitespace-nowrap">
            {{ review.reviewedCount }} / {{ review.tourSteps.length }} reviewed
          </span>
          <span class="truncate font-mono text-[10.5px] text-ink-faint">
            {{ review.pr.headRefName }} → {{ review.pr.baseRefName }}
          </span>
        </div>
        <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-canvas-elevated">
          <div
            class="h-full rounded-full bg-pine transition-all duration-300"
            :style="{
              width: review.tourSteps.length
                ? `${Math.round((review.reviewedCount / review.tourSteps.length) * 100)}%`
                : '0%',
            }"
          />
        </div>
      </div>

      <!-- Ordered Tour Steps — Connected Stepping-Stone Trail -->
      <div class="relative flex-1 overflow-y-auto px-2.5 py-2.5">
        <div class="relative space-y-1">
          <!-- Subtle vertical trail rail connecting the stepping stones -->
          <div
            v-if="review.tourSteps.length > 1"
            class="pointer-events-none absolute top-5 bottom-5 left-[17px] w-px bg-border"
          />

          <button
            v-for="step in review.tourSteps"
            :key="step.file.path"
            class="group relative flex w-full items-start gap-2.5 rounded-xl border px-2 py-2 text-left transition-all"
            :class="
              step.stepIndex === review.currentStepIndex
                ? 'stroll-card border-terra-border bg-terra-soft'
                : 'border-transparent hover:border-border-muted hover:bg-canvas-elevated/60'
            "
            @click="review.goToStep(step.stepIndex)"
          >
            <!-- Stepping-Stone Trail Node -->
            <span
              class="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold transition-all"
              :class="
                review.isStepReviewed(step.file.path)
                  ? 'animate-check-pop bg-pine text-white shadow-xs'
                  : step.stepIndex === review.currentStepIndex
                    ? 'bg-terra text-white ring-3 ring-terra-soft shadow-xs'
                    : 'border border-border bg-canvas-subtle text-ink-muted group-hover:border-terra-border group-hover:text-ink'
              "
              :title="review.isStepReviewed(step.file.path) ? 'Reviewed' : `Step ${step.stepIndex + 1}`"
            >
              <Check v-if="review.isStepReviewed(step.file.path)" class="h-3 w-3" />
              <template v-else>{{ step.stepIndex + 1 }}</template>
            </span>

            <!-- Step File Metadata -->
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span
                    class="shrink-0 rounded border px-1 py-0.2 font-mono text-[9px] font-semibold"
                    :class="LAYER_META[step.layer].badgeClass"
                  >
                    {{ LAYER_META[step.layer].shortLabel }}
                  </span>
                  <span
                    class="truncate font-mono text-xs font-medium"
                    :class="
                      step.stepIndex === review.currentStepIndex
                        ? 'text-ink'
                        : 'text-ink-secondary group-hover:text-ink'
                    "
                  >
                    {{ fileNameOnly(step.file.path) }}
                  </span>
                </div>

                <span
                  v-if="draftCountForFile(step.file.path) > 0"
                  class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-terra-soft px-1.5 py-0.2 font-mono text-[10px] font-medium text-terra-text"
                >
                  <MessageSquare class="h-2.5 w-2.5" />
                  {{ draftCountForFile(step.file.path) }}
                </span>
              </div>

              <div class="flex items-center justify-between gap-2 text-[10px] text-ink-faint">
                <span class="truncate">{{ dirOnly(step.file.path) || '.' }}</span>
                <span class="shrink-0 font-mono">
                  <span class="text-pine-text">+{{ step.file.additions }}</span>
                  <span class="mx-0.5 text-ink-faint">/</span>
                  <span class="text-crimson-text">-{{ step.file.deletions }}</span>
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>
