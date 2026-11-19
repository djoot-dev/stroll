<script setup lang="ts">
import { FileCode2, MessageSquare, Search, Sparkles } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'
import { buildPRSymbolIndex } from '@/services/codeContext'
import { useReviewStore } from '@/stores/review'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const review = useReviewStore()
const query = ref('')
const selectedIdx = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

interface PaletteItem {
  id: string
  kind: 'file' | 'symbol' | 'thread' | 'overview'
  title: string
  subtitle: string
  path?: string
}

const symbolIndex = computed(() => {
  if (!review.pr) return new Map()
  return buildPRSymbolIndex(review.pr.files)
})

const items = computed<PaletteItem[]>(() => {
  if (!review.pr) return []
  const q = query.value.trim().toLowerCase()
  const results: PaletteItem[] = []

  if (!q || 'overview'.includes(q)) {
    results.push({
      id: 'overview',
      kind: 'overview',
      title: 'PR Overview',
      subtitle: 'Description, checks, commits & conversation',
    })
  }

  for (const step of review.tourSteps) {
    if (!q || step.file.path.toLowerCase().includes(q)) {
      results.push({
        id: `file:${step.file.path}`,
        kind: 'file',
        title: step.file.path.split('/').pop() ?? step.file.path,
        subtitle: `Step ${step.stepIndex + 1} · ${step.file.path}`,
        path: step.file.path,
      })
    }
  }

  if (q.length >= 2) {
    for (const [name, decls] of symbolIndex.value.entries()) {
      if (!name.toLowerCase().includes(q)) continue
      for (const decl of decls.slice(0, 3)) {
        results.push({
          id: `sym:${decl.filePath}:${decl.line}:${name}`,
          kind: 'symbol',
          title: name,
          subtitle: `${decl.kind} in ${decl.filePath}:${decl.line}`,
          path: decl.filePath,
        })
      }
    }

    for (const thread of review.pr.threads) {
      if (thread.isResolved) continue
      const body = thread.comments[0]?.body ?? ''
      if (
        thread.path.toLowerCase().includes(q) ||
        body.toLowerCase().includes(q)
      ) {
        results.push({
          id: `thread:${thread.id}`,
          kind: 'thread',
          title: `${thread.path}:${thread.line}`,
          subtitle: body.slice(0, 90),
          path: thread.path,
        })
      }
    }
  }

  return results.slice(0, 20)
})

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      query.value = ''
      selectedIdx.value = 0
      await nextTick()
      inputRef.value?.focus()
    }
  },
)

watch(items, () => {
  selectedIdx.value = 0
})

function selectItem(item: PaletteItem) {
  if (item.kind === 'overview') {
    review.openOverview()
  } else if (item.path) {
    review.goToFile(item.path)
  }
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (items.value.length > 0) {
      selectedIdx.value = (selectedIdx.value + 1) % items.value.length
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (items.value.length > 0) {
      selectedIdx.value = (selectedIdx.value - 1 + items.value.length) % items.value.length
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = items.value[selectedIdx.value]
    if (item) selectItem(item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] px-4 backdrop-blur-[1px]"
      @click.self="emit('close')"
    >
      <div
        class="animate-pop-in w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-canvas-subtle shadow-2xl"
        @keydown="handleKeydown"
      >
        <div class="flex items-center gap-2.5 border-b border-border-muted px-4 py-3">
          <Search class="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            placeholder="Jump to file, symbol, or unresolved thread…"
            class="w-full bg-transparent text-sm text-ink placeholder-ink-faint focus:outline-none"
          />
          <kbd class="rounded border border-border bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            ESC
          </kbd>
        </div>

        <div class="max-h-80 overflow-y-auto p-2">
          <div v-if="items.length === 0" class="px-3 py-6 text-center text-xs text-ink-faint">
            No matching files, symbols, or threads.
          </div>

          <button
            v-for="(item, idx) in items"
            :key="item.id"
            type="button"
            class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
            :class="idx === selectedIdx ? 'bg-terra-soft text-ink' : 'hover:bg-canvas-elevated/60'"
            @mouseenter="selectedIdx = idx"
            @click="selectItem(item)"
          >
            <FileCode2 v-if="item.kind === 'file' || item.kind === 'overview'" class="h-4 w-4 shrink-0 text-ink-muted" />
            <Sparkles v-else-if="item.kind === 'symbol'" class="h-4 w-4 shrink-0 text-terra-text" />
            <MessageSquare v-else class="h-4 w-4 shrink-0 text-ochre-text" />

            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-semibold text-ink">{{ item.title }}</div>
              <div class="truncate text-[11px] text-ink-muted">{{ item.subtitle }}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
