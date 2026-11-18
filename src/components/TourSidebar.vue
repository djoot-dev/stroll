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
  <aside
    v-if="review.sidebarOpen && review.pr"
    class="flex w-72 shrink-0 flex-col border-r border-border bg-canvas-subtle"
  >
    <!-- PR Summary Header -->
    <div class="border-b border-border p-3.5">
      <h2 class="line-clamp-2 text-xs font-semibold leading-snug text-slate-100">
        {{ review.pr.title }}
      </h2>
      <div class="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>
          {{ review.reviewedCount }} / {{ review.tourSteps.length }} reviewed
        </span>
        <span class="font-mono text-slate-500">
          {{ review.pr.headRefName }} → {{ review.pr.baseRefName }}
        </span>
      </div>
      <div class="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-canvas-inset">
        <div
          class="h-full bg-emerald-500 transition-all duration-200"
          :style="{
            width: review.tourSteps.length
              ? `${Math.round((review.reviewedCount / review.tourSteps.length) * 100)}%`
              : '0%',
          }"
        />
      </div>
    </div>

    <!-- Ordered Tour Steps -->
    <div class="flex-1 overflow-y-auto p-2 space-y-1">
      <button
        v-for="step in review.tourSteps"
        :key="step.file.path"
        class="group flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors"
        :class="
          step.stepIndex === review.currentStepIndex
            ? 'border-blue-500/50 bg-blue-500/10'
            : 'border-transparent hover:border-border-muted hover:bg-canvas-elevated/60'
        "
        @click="review.goToStep(step.stepIndex)"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="font-mono text-[10px] text-slate-500">
              {{ step.stepIndex + 1 }}.
            </span>
            <span
              class="shrink-0 rounded border px-1 py-0.2 font-mono text-[9px] font-semibold"
              :class="LAYER_META[step.layer].badgeClass"
            >
              {{ LAYER_META[step.layer].shortLabel }}
            </span>
            <span class="truncate font-mono text-xs font-medium text-slate-200">
              {{ fileNameOnly(step.file.path) }}
            </span>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <span
              v-if="draftCountForFile(step.file.path) > 0"
              class="inline-flex items-center gap-0.5 rounded bg-blue-500/15 px-1 py-0.2 font-mono text-[10px] text-blue-300"
            >
              <MessageSquare class="h-2.5 w-2.5" />
              {{ draftCountForFile(step.file.path) }}
            </span>
            <span
              v-if="review.isStepReviewed(step.file.path)"
              class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400"
              title="Reviewed"
            >
              <Check class="h-2.5 w-2.5" />
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pl-4 text-[10px] text-slate-500">
          <span class="truncate">{{ dirOnly(step.file.path) || '.' }}</span>
          <span class="shrink-0 font-mono">
            <span class="text-emerald-400">+{{ step.file.additions }}</span>
            <span class="mx-0.5 text-slate-600">/</span>
            <span class="text-rose-400">-{{ step.file.deletions }}</span>
          </span>
        </div>
      </button>
    </div>
  </aside>
</template>
