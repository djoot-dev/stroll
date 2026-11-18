<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import { ArrowUpRight, BookOpen, ChevronDown, ChevronRight } from '@lucide/vue'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getLanguageSupport } from '@/services/highlighter'
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
    oneDark,
    EditorView.theme({
      '&': {
        fontSize: '12px',
        backgroundColor: '#090c10',
      },
      '.cm-scroller': {
        fontFamily: 'JetBrains Mono, Fira Code, SF Mono, Menlo, monospace',
        lineHeight: '1.5',
      },
      '.cm-content': {
        padding: '8px 12px',
      },
    }),
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
  <div class="overflow-hidden rounded-lg border border-purple-500/30 bg-canvas-subtle">
    <div class="flex items-center justify-between gap-2 px-3 py-2">
      <button
        class="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-slate-200 hover:text-white"
        @click="expanded = !expanded"
      >
        <ChevronDown v-if="expanded" class="h-3.5 w-3.5 shrink-0 text-purple-400" />
        <ChevronRight v-else class="h-3.5 w-3.5 shrink-0 text-purple-400" />
        <BookOpen class="h-3.5 w-3.5 shrink-0 text-purple-400" />
        <span class="font-medium text-purple-300">Referenced PR Context:</span>
        <span class="truncate font-mono text-slate-300">{{ context.sourcePath }}</span>
        <span
          v-if="context.symbolNames.length > 0"
          class="hidden truncate font-mono text-[11px] text-slate-400 sm:inline"
        >
          ({{ context.symbolNames.join(', ') }})
        </span>
      </button>

      <button
        class="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-canvas px-2 py-0.5 text-[11px] text-slate-300 hover:bg-canvas-elevated"
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
