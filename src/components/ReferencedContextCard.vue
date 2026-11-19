<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ArrowUpRight, BookOpen, ChevronDown, ChevronRight } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  getLanguageSupport,
  strollEditorTheme,
  strollSyntaxExtension,
} from '@/services/highlighter'
import type { ReferencedContext } from '@/types/pr'

const props = defineProps<{
  context: ReferencedContext
}>()

const emit = defineEmits<{
  (e: 'jumpToFile', path: string): void
}>()

const expanded = ref(false)
const editorHost = ref<HTMLElement | null>(null)
let editorView: EditorView | null = null

function mountCodeMirror() {
  if (!editorHost.value) return
  if (editorView) {
    editorView.destroy()
    editorView = null
  }

  const lang = getLanguageSupport(props.context.language)
  const extensions = [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    strollSyntaxExtension,
    strollEditorTheme,
  ]
  if (lang) extensions.push(lang)

  editorView = new EditorView({
    state: EditorState.create({
      doc: props.context.snippet,
      extensions,
    }),
    parent: editorHost.value,
  })
}

watch(expanded, (isOpen) => {
  if (isOpen) {
    requestAnimationFrame(() => mountCodeMirror())
  } else if (editorView) {
    editorView.destroy()
    editorView = null
  }
})

watch(
  () => props.context,
  () => {
    if (expanded.value) {
      requestAnimationFrame(() => mountCodeMirror())
    }
  },
)

onMounted(() => {
  if (expanded.value) mountCodeMirror()
})

onBeforeUnmount(() => {
  editorView?.destroy()
})
</script>

<template>
  <div class="stroll-card overflow-hidden rounded-xl border border-sage-border bg-canvas-subtle">
    <div class="flex items-center justify-between gap-2 bg-sage-soft/50 px-3 py-2">
      <button
        class="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-ink hover:text-pine-text"
        @click="expanded = !expanded"
      >
        <ChevronDown v-if="expanded" class="h-3.5 w-3.5 shrink-0 text-pine" />
        <ChevronRight v-else class="h-3.5 w-3.5 shrink-0 text-pine" />
        <BookOpen class="h-3.5 w-3.5 shrink-0 text-pine" />
        <span class="font-medium text-pine-text">Referenced PR Context:</span>
        <span class="truncate font-mono text-ink-secondary">{{ context.sourcePath }}</span>
        <span
          v-if="context.symbolNames.length > 0"
          class="hidden truncate font-mono text-[11px] text-ink-muted sm:inline"
        >
          ({{ context.symbolNames.join(', ') }})
        </span>
      </button>

      <button
        class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas-subtle px-2 py-0.5 text-[11px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
        @click="emit('jumpToFile', context.sourcePath)"
      >
        <span>Jump to file</span>
        <ArrowUpRight class="h-3 w-3" />
      </button>
    </div>

    <Transition name="reveal-down">
      <div v-if="expanded" class="border-t border-border-muted">
        <div ref="editorHost" class="max-h-64 overflow-auto" />
      </div>
    </Transition>
  </div>
</template>
