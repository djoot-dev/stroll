<script setup lang="ts">
import { Search } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { buildMatchSnippet, type DiffSearchMatch } from '@/services/diffSearch'

const MAX_RENDERED = 200

const props = defineProps<{
  open: boolean
  matches: DiffSearchMatch[]
}>()

const query = defineModel<string>('query', { required: true })
const activeIndex = defineModel<number>('activeIndex', { required: true })

const emit = defineEmits<{
  /** Enter / click on a result: keep the diff where the active match is. */
  (e: 'confirm'): void
  /** Escape: return to where the reader was before searching. */
  (e: 'cancel'): void
  /** Click elsewhere: close and leave the scroll position alone. */
  (e: 'dismiss'): void
}>()

const panelRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const rendered = computed(() =>
  props.matches.slice(0, MAX_RENDERED).map((m) => ({
    key: m.line.key,
    type: m.line.type,
    lineNumber: m.line.newLineNumber ?? m.line.oldLineNumber,
    snippet: buildMatchSnippet(m.line.content, m.start, m.end),
  })),
)

function focusInput() {
  inputRef.value?.focus({ preventScroll: true })
  inputRef.value?.select()
}

function handleOutsideMousedown(e: MouseEvent) {
  const target = e.target as Node | null
  if (!target || panelRef.value?.contains(target)) return
  if (target instanceof Element && target.closest('[data-diff-search-toggle]')) return
  emit('dismiss')
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      await nextTick()
      focusInput()
      document.addEventListener('mousedown', handleOutsideMousedown, true)
    } else {
      document.removeEventListener('mousedown', handleOutsideMousedown, true)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleOutsideMousedown, true)
})

watch(activeIndex, async (idx) => {
  await nextTick()
  const el = listRef.value?.querySelector<HTMLElement>(`[data-match-idx="${idx}"]`)
  el?.scrollIntoView({ block: 'nearest' })
})

function step(delta: 1 | -1) {
  const n = props.matches.length
  if (n === 0) return
  activeIndex.value = (activeIndex.value + delta + n) % n
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    step(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    step(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) step(-1)
    else emit('confirm')
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
  }
}

function pick(idx: number) {
  activeIndex.value = idx
  emit('confirm')
}

defineExpose({ focusInput })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="pointer-events-none fixed inset-x-0 top-[12vh] z-40 flex justify-center px-4"
    >
      <div
        ref="panelRef"
        data-diff-search-palette
        class="animate-pop-in pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-canvas-subtle shadow-2xl"
        @keydown="handleKeydown"
      >
        <div class="flex items-center gap-2.5 border-b border-border-muted px-4 py-3">
          <Search class="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            placeholder="Find in this file…"
            class="w-full bg-transparent text-sm text-ink placeholder-ink-faint focus:outline-none"
          />
          <span v-if="query.trim()" class="shrink-0 font-mono text-[10.5px] text-ink-muted">
            {{ matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : '0/0' }}
          </span>
          <kbd class="rounded border border-border bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            ESC
          </kbd>
        </div>

        <div v-if="query.trim()" ref="listRef" class="max-h-60 overflow-y-auto p-2">
          <div v-if="matches.length === 0" class="px-3 py-6 text-center text-xs text-ink-faint">
            No matching lines in this file.
          </div>

          <button
            v-for="(item, idx) in rendered"
            :key="item.key"
            type="button"
            :data-match-idx="idx"
            class="flex w-full items-center gap-3 rounded-xl px-3 py-1.5 text-left transition-colors"
            :class="idx === activeIndex ? 'bg-terra-soft text-ink' : 'hover:bg-canvas-elevated/60'"
            @click="pick(idx)"
          >
            <span
              class="w-3 shrink-0 text-center font-mono text-[11px]"
              :class="{
                'text-pine-text': item.type === 'add',
                'text-crimson-text': item.type === 'del',
                'text-ink-faint': item.type === 'context',
              }"
            >{{ item.type === 'add' ? '+' : item.type === 'del' ? '−' : '' }}</span>
            <span class="w-10 shrink-0 text-right font-mono text-[11px] text-ink-faint">
              {{ item.lineNumber ?? '' }}
            </span>
            <span class="min-w-0 flex-1 truncate whitespace-pre font-mono text-[11.5px] text-ink-secondary">{{ item.snippet.before }}<mark class="rounded-sm bg-ochre-soft px-px text-ink">{{ item.snippet.match }}</mark>{{ item.snippet.after }}</span>
          </button>

          <div
            v-if="matches.length > MAX_RENDERED"
            class="px-3 py-1.5 text-center text-[11px] text-ink-faint"
          >
            Showing first {{ MAX_RENDERED }} of {{ matches.length }} matches
          </div>
        </div>

        <div class="flex items-center gap-3 border-t border-border-muted px-4 py-1.5 text-[10.5px] text-ink-faint">
          <span><kbd class="font-mono">↑↓</kbd> step</span>
          <span><kbd class="font-mono">↵</kbd> go to line</span>
          <span><kbd class="font-mono">esc</kbd> back to where you were</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
