<script setup lang="ts">
import { computed } from 'vue'
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Loader2 } from '@lucide/vue'
import type { AutocompleteOption, AutocompleteTrigger } from '@/composables/useCommentAutocomplete'

const props = defineProps<{
  open: boolean
  trigger: AutocompleteTrigger
  options: AutocompleteOption[]
  activeIndex: number
  isLoading: boolean
  coords: { top: number; left: number }
}>()

const emit = defineEmits<{
  (e: 'select', option: AutocompleteOption): void
  (e: 'hover', index: number): void
}>()

const POPOVER_WIDTH = 300

const style = computed(() => {
  if (typeof window === 'undefined') return {}
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16)
  const left = Math.max(8, Math.min(props.coords.left, window.innerWidth - width - 8))
  const maxHeight = 240
  const fitsBelow = props.coords.top + maxHeight <= window.innerHeight - 8
  const top = fitsBelow
    ? props.coords.top
    : Math.max(8, props.coords.top - maxHeight - 24)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
  }
})

function stateIcon(opt: AutocompleteOption) {
  if (opt.refState === 'MERGED') return GitMerge
  if (opt.refState === 'CLOSED') return GitPullRequestClosed
  if (opt.isDraft) return GitPullRequestDraft
  return GitPullRequest
}

function stateClass(opt: AutocompleteOption): string {
  if (opt.refState === 'MERGED') return 'text-plum-text'
  if (opt.refState === 'CLOSED') return 'text-crimson-text'
  if (opt.isDraft) return 'text-ink-faint'
  return 'text-pine-text'
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && (options.length > 0 || isLoading)"
      role="listbox"
      :style="style"
      class="fixed z-50 max-h-60 overflow-y-auto rounded-xl border border-border bg-canvas-subtle p-1 shadow-xl"
    >
      <div
        v-if="isLoading && options.length === 0"
        class="flex items-center gap-2 px-2.5 py-2 text-[11px] text-ink-muted"
      >
        <Loader2 class="h-3 w-3 animate-spin" />
        <span>{{ trigger === '@' ? 'Searching users…' : 'Searching PRs & issues…' }}</span>
      </div>

      <button
        v-for="(opt, idx) in options"
        :key="opt.id"
        type="button"
        role="option"
        :aria-selected="idx === activeIndex"
        class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors"
        :class="idx === activeIndex ? 'bg-canvas-elevated text-ink' : 'text-ink-secondary hover:bg-canvas-elevated/60'"
        @mouseenter="emit('hover', idx)"
        @mousedown.prevent="emit('select', opt)"
      >
        <img
          v-if="opt.trigger === '@' && opt.avatarUrl"
          :src="opt.avatarUrl"
          :alt="opt.primary"
          class="h-4 w-4 shrink-0 rounded-full border border-border object-cover"
        />
        <span
          v-else-if="opt.trigger === '@'"
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-canvas-inset text-[9px] font-semibold text-ink-muted"
        >
          {{ opt.primary.slice(1, 2).toUpperCase() }}
        </span>
        <component
          :is="stateIcon(opt)"
          v-else
          class="h-3.5 w-3.5 shrink-0"
          :class="stateClass(opt)"
        />

        <span class="shrink-0 font-mono text-[11px] font-semibold text-ink">{{ opt.primary }}</span>
        <span v-if="opt.secondary" class="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
          {{ opt.secondary }}
        </span>
      </button>
    </div>
  </Teleport>
</template>
