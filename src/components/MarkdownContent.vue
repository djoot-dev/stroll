<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMarkdownDom } from '@/composables/useMarkdownDom'
import { renderSafeMarkdown } from '@/services/markdown'
import { useReviewStore } from '@/stores/review'

const props = defineProps<{
  content: string
  originalLines?: string[]
  interactiveChecklist?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-task', index: number): void
}>()

const review = useReviewStore()
const rootRef = ref<HTMLElement | null>(null)

const renderedHtml = computed(() =>
  renderSafeMarkdown(props.content, {
    originalLines: props.originalLines,
    interactiveChecklist: props.interactiveChecklist,
    repoContext: review.pr ? { owner: review.pr.owner, repo: review.pr.repo } : undefined,
  }),
)

const { handleMarkdownClick } = useMarkdownDom(rootRef, renderedHtml, {
  interactiveChecklist: () => Boolean(props.interactiveChecklist),
  onToggleTask: (idx) => emit('toggle-task', idx),
})

function handleClick(event: MouseEvent): void {
  void handleMarkdownClick(event)
}
</script>

<template>
  <div
    v-if="renderedHtml"
    ref="rootRef"
    class="min-w-0 break-words"
    @click="handleClick"
    v-html="renderedHtml"
  />
</template>
