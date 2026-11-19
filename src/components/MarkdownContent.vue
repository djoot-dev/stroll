<script setup lang="ts">
import { computed } from 'vue'
import { renderSafeMarkdown } from '@/services/markdown'
import { openExternalUrl } from '@/services/native'

const props = defineProps<{
  content: string
  originalLines?: string[]
}>()

const renderedHtml = computed(() =>
  renderSafeMarkdown(props.content, { originalLines: props.originalLines }),
)

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
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
