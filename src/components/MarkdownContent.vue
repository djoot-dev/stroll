<script setup lang="ts">
import { computed } from 'vue'
import { renderSafeMarkdown } from '@/services/markdown'
import { openExternalUrl } from '@/services/native'

const props = defineProps<{
  content: string
  originalLines?: string[]
  interactiveChecklist?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-task', index: number): void
}>()

const renderedHtml = computed(() =>
  renderSafeMarkdown(props.content, {
    originalLines: props.originalLines,
    interactiveChecklist: props.interactiveChecklist,
  }),
)

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (props.interactiveChecklist) {
    const taskButton = target?.closest('button[data-task-index]') as HTMLButtonElement | null
    if (taskButton) {
      const idx = Number(taskButton.getAttribute('data-task-index'))
      if (!Number.isNaN(idx)) {
        event.preventDefault()
        emit('toggle-task', idx)
        return
      }
    }
  }
  const anchor = target?.closest('a[data-external-url]') as HTMLAnchorElement | null
  if (!anchor) return
  event.preventDefault()
  const url = anchor.getAttribute('data-external-url')
  if (url) {
    void openExternalUrl(url)
  }
}
</script>

<template>
  <div
    v-if="renderedHtml"
    class="min-w-0 break-words"
    @click="handleClick"
    v-html="renderedHtml"
  />
</template>
