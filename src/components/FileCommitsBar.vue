<script setup lang="ts">
import { ChevronDown, ChevronRight, Filter, GitCommitHorizontal, GitMerge, Loader2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useReviewStore } from '@/stores/review'
import type { PRFileCommit } from '@/types/pr'

const props = defineProps<{
  path: string
  stepIndex: number
}>()

const review = useReviewStore()
const expanded = ref(false)

watch(
  () => [props.path, props.stepIndex, review.pr?.headRefOid] as const,
  () => {
    void review.ensureFileCommitsForStep(props.stepIndex)
  },
  { immediate: true },
)

watch(
  () => props.path,
  () => {
    expanded.value = false
  },
)

const commits = computed<PRFileCommit[] | null>(() => review.fileCommits[props.path] ?? null)
const isLoading = computed(() => review.fileCommitsLoading.has(props.path))
const latest = computed(() => commits.value?.[0] ?? null)
const moreCount = computed(() => Math.max(0, (commits.value?.length ?? 0) - 1))

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return ''
  const diffMs = Date.now() - ts
  if (diffMs < 60_000) return 'just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function filterToCommit(oid: string): void {
  void review.setCommitFilter(review.commitFilter === oid ? 'all' : oid)
}
</script>

<template>
  <div v-if="latest" class="pt-1 text-[11px]">
    <button
      type="button"
      class="group flex w-full min-w-0 items-center gap-1.5 rounded-md text-left text-ink-muted transition-colors hover:text-ink"
      :title="expanded ? 'Hide commits for this file' : 'Show commits that touched this file'"
      @click="expanded = !expanded"
    >
      <GitCommitHorizontal class="h-3.5 w-3.5 shrink-0 text-ink-faint" />
      <code class="shrink-0 rounded bg-canvas-elevated px-1 py-px font-mono text-[10.5px] text-terra-text">
        {{ latest.shortOid }}
      </code>
      <span class="truncate font-medium text-ink-secondary group-hover:text-ink">
        {{ latest.messageHeadline }}
      </span>
      <span class="hidden shrink-0 text-ink-faint sm:inline">
        · {{ latest.authorName }} · {{ formatRelativeTime(latest.committedDate) }}
      </span>
      <span
        v-if="moreCount > 0"
        class="shrink-0 rounded-full border border-border bg-canvas px-1.5 font-mono text-[10px] text-ink-muted"
      >
        +{{ moreCount }}
      </span>
      <ChevronDown v-if="expanded" class="h-3 w-3 shrink-0 text-ink-faint" />
      <ChevronRight v-else class="h-3 w-3 shrink-0 text-ink-faint" />
    </button>

    <ul
      v-if="expanded"
      class="mt-2 divide-y divide-border-muted overflow-hidden rounded-lg border border-border-muted bg-canvas"
    >
      <li v-for="commit in commits" :key="commit.oid" class="space-y-1 px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <code class="shrink-0 rounded bg-canvas-elevated px-1 py-px font-mono text-[10.5px] text-terra-text">
            {{ commit.shortOid }}
          </code>
          <span
            v-if="commit.isMerge"
            class="inline-flex shrink-0 items-center gap-0.5 rounded border border-plum-border bg-plum-soft px-1 font-mono text-[9.5px] uppercase text-plum-text"
            title="Merge commit"
          >
            <GitMerge class="h-2.5 w-2.5" />
            merge
          </span>
          <span class="min-w-0 flex-1 truncate font-medium text-ink" :title="commit.messageHeadline">
            {{ commit.messageHeadline }}
          </span>
          <span class="hidden shrink-0 text-ink-faint sm:inline">
            {{ commit.authorName }} · {{ formatRelativeTime(commit.committedDate) }}
          </span>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors"
            :class="
              review.commitFilter === commit.oid
                ? 'border-terra-border bg-terra-soft text-terra-text'
                : 'border-border text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            :title="
              review.commitFilter === commit.oid
                ? 'Show all commits again'
                : 'Only review the changes from this commit'
            "
            @click="filterToCommit(commit.oid)"
          >
            <Filter class="h-2.5 w-2.5" />
            {{ review.commitFilter === commit.oid ? 'Filtered' : 'This commit' }}
          </button>
        </div>
        <p
          v-if="commit.messageBody.trim()"
          class="whitespace-pre-wrap break-words pl-0.5 font-mono text-[10.5px] leading-relaxed text-ink-muted"
        >{{ commit.messageBody.trim() }}</p>
      </li>
    </ul>
  </div>
  <div v-else-if="isLoading" class="flex items-center gap-1.5 pt-1 text-[11px] text-ink-faint">
    <Loader2 class="h-3 w-3 animate-spin" />
    Loading commits…
  </div>
  <div
    v-else-if="review.fileCommitsError && !commits"
    class="pt-1 text-[11px] text-ink-faint"
    :title="review.fileCommitsError"
  >
    Couldn't load commits for this file.
  </div>
</template>
