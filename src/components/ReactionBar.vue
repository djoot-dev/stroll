<script setup lang="ts">
import { SmilePlus } from '@lucide/vue'
import { ref } from 'vue'
import { useReviewStore } from '@/stores/review'
import type { ReactionContent, ReactionGroup } from '@/types/pr'

const props = defineProps<{
  subjectId: string
  reactions?: ReactionGroup[]
}>()

const review = useReviewStore()
const pickerOpen = ref(false)
const isUpdating = ref(false)

const REACTION_OPTIONS: Array<{ content: ReactionContent; emoji: string; label: string }> = [
  { content: 'THUMBS_UP', emoji: '👍', label: '+1' },
  { content: 'THUMBS_DOWN', emoji: '👎', label: '-1' },
  { content: 'LAUGH', emoji: '😄', label: 'Laugh' },
  { content: 'HOORAY', emoji: '🎉', label: 'Hooray' },
  { content: 'CONFUSED', emoji: '😕', label: 'Confused' },
  { content: 'HEART', emoji: '❤️', label: 'Heart' },
  { content: 'ROCKET', emoji: '🚀', label: 'Rocket' },
  { content: 'EYES', emoji: '👀', label: 'Eyes' },
]

function emojiFor(content: ReactionContent): string {
  return REACTION_OPTIONS.find((r) => r.content === content)?.emoji ?? '👍'
}

async function handleToggle(content: ReactionContent) {
  if (isUpdating.value) return
  isUpdating.value = true
  pickerOpen.value = false
  try {
    await review.toggleCommentReaction(props.subjectId, content)
  } catch {
    // Store reverts optimistic update on error
  } finally {
    isUpdating.value = false
  }
}
</script>

<template>
  <div class="relative flex flex-wrap items-center gap-1.5 pt-1">
    <button
      v-for="reaction in reactions ?? []"
      :key="reaction.content"
      type="button"
      class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
      :class="
        reaction.viewerHasReacted
          ? 'border-terra-border bg-terra-soft text-terra-text'
          : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated'
      "
      :disabled="isUpdating"
      :aria-busy="isUpdating"
      @click="handleToggle(reaction.content)"
    >
      <span>{{ emojiFor(reaction.content) }}</span>
      <span class="font-mono text-[10.5px]">{{ reaction.count }}</span>
    </button>

    <div class="relative">
      <button
        type="button"
        title="Add reaction"
        class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border-muted bg-canvas text-ink-muted transition-colors hover:border-border hover:bg-canvas-elevated hover:text-ink"
        @click="pickerOpen = !pickerOpen"
      >
        <SmilePlus class="h-3 w-3" />
      </button>

      <div
        v-if="pickerOpen"
        class="animate-pop-in absolute left-0 bottom-full z-20 mb-1.5 flex items-center gap-0.5 rounded-xl border border-border bg-canvas-subtle p-1 shadow-lg"
      >
        <button
          v-for="opt in REACTION_OPTIONS"
          :key="opt.content"
          type="button"
          :title="opt.label"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-sm transition-colors hover:bg-canvas-elevated"
          @click="handleToggle(opt.content)"
        >
          {{ opt.emoji }}
        </button>
      </div>
    </div>
  </div>
</template>
