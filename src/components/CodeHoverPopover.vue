<script setup lang="ts">
import { ArrowUpRight, FileCode2, GitCompare, Layers, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { HoverSymbolInfo } from '@/services/codeContext'
import { highlightLinesWithCodeMirror } from '@/services/highlighter'

const props = defineProps<{
  info: HoverSymbolInfo
  replacedLines: string[]
  x: number
  y: number
}>()

const emit = defineEmits<{
  (e: 'mouseenter'): void
  (e: 'mouseleave'): void
  (e: 'close'): void
  (e: 'jumpToFile', path: string): void
}>()

const showBefore = ref(false)
const showReplaced = ref(false)

const activeSnippet = computed(() => {
  if (showBefore.value && props.info.declaration.baseSnippet) {
    return props.info.declaration.baseSnippet
  }
  return props.info.declaration.headSnippet
})

const highlightedSnippet = computed(() =>
  highlightLinesWithCodeMirror(
    activeSnippet.value.split('\n'),
    props.info.declaration.language,
  ),
)

const popoverStyle = computed(() => {
  const maxWidth = 460
  const maxHeight = 380
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  const left = Math.min(Math.max(12, props.x), vw - maxWidth - 16)
  const placeAbove = props.y + maxHeight + 24 > vh && props.y > maxHeight
  const top = placeAbove ? Math.max(12, props.y - 10) : Math.min(props.y + 18, vh - 120)

  return {
    left: `${left}px`,
    top: `${top}px`,
    transform: placeAbove ? 'translateY(-100%)' : undefined,
    width: `${maxWidth}px`,
  }
})

const hasBeforeAfter = computed(
  () =>
    props.info.declaration.isModifiedInPR &&
    Boolean(props.info.declaration.baseSnippet) &&
    props.info.declaration.baseSnippet !== props.info.declaration.headSnippet,
)
</script>

<template>
  <Teleport to="body">
    <div
      class="animate-pop-in fixed z-50 overflow-hidden rounded-xl border border-border bg-canvas-subtle shadow-2xl shadow-black/60"
      :style="popoverStyle"
      @mouseenter="emit('mouseenter')"
      @mouseleave="emit('mouseleave')"
      @click.stop
    >
      <!-- Header -->
      <div class="flex items-center justify-between gap-2 border-b border-border bg-canvas-elevated px-3 py-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <FileCode2 class="h-3.5 w-3.5 shrink-0 text-blue-400" />
          <span class="rounded bg-blue-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-300">
            {{ info.declaration.kind }}
          </span>
          <span class="truncate font-mono text-xs font-semibold text-slate-100">
            {{ info.declaration.name }}
          </span>
          <span
            v-if="info.declaration.isModifiedInPR"
            class="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
          >
            Modified in PR
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <button
            v-if="hasBeforeAfter"
            class="inline-flex items-center gap-1 rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-canvas-elevated"
            :class="{ 'border-amber-500/50 text-amber-300': showBefore }"
            title="Toggle Before / After PR definition"
            @click="showBefore = !showBefore"
          >
            <GitCompare class="h-3 w-3" />
            <span>{{ showBefore ? 'Base (Before)' : 'Head (After)' }}</span>
          </button>

          <button
            v-if="!info.isSameFile"
            class="inline-flex items-center gap-0.5 rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-blue-300 hover:bg-blue-500/15"
            title="Jump to definition step"
            @click="emit('jumpToFile', info.declaration.path)"
          >
            <span>Jump</span>
            <ArrowUpRight class="h-3 w-3" />
          </button>

          <button
            class="rounded p-0.5 text-slate-400 hover:bg-canvas hover:text-slate-100"
            title="Close (Esc)"
            @click="emit('close')"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <!-- Location -->
      <div class="border-b border-border-muted bg-canvas px-3 py-1 font-mono text-[10px] text-slate-400">
        {{ info.declaration.path }}:{{ info.declaration.line }}
      </div>

      <!-- Leading Doc Comment -->
      <div
        v-if="info.declaration.docComment"
        class="border-b border-border-muted bg-canvas-subtle/60 px-3 py-1.5 font-mono text-[11px] text-slate-400 whitespace-pre-wrap"
      >
        {{ info.declaration.docComment }}
      </div>

      <!-- CodeMirror Highlighted Definition Snippet -->
      <div class="max-h-48 overflow-auto bg-canvas-inset px-3 py-2 font-mono text-[11.5px] leading-relaxed">
        <div
          v-for="(spans, lIdx) in highlightedSnippet"
          :key="lIdx"
          class="whitespace-pre text-slate-200"
        >
          <span v-for="(sp, sIdx) in spans" :key="sIdx" :class="sp.className">{{ sp.text }}</span>
        </div>
      </div>

      <!-- Blast Radius / Used By in PR -->
      <div
        v-if="info.usages.length > 0"
        class="border-t border-border-muted bg-canvas-subtle px-3 py-2"
      >
        <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <Layers class="h-3 w-3 text-purple-400" />
          <span>Used in {{ info.usages.length }} PR location{{ info.usages.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="max-h-24 space-y-1 overflow-y-auto">
          <button
            v-for="(u, uIdx) in info.usages"
            :key="`${u.path}:${u.line}:${uIdx}`"
            class="flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left font-mono text-[10.5px] text-slate-300 hover:bg-canvas-elevated"
            @click="emit('jumpToFile', u.path)"
          >
            <span class="shrink-0 text-blue-400">{{ u.path.split('/').pop() }}:{{ u.line }}</span>
            <span class="truncate text-slate-500">{{ u.preview }}</span>
          </button>
        </div>
      </div>

      <!-- Replaced '-' Lines Peek (when hovering a '+' line) -->
      <div
        v-if="replacedLines.length > 0"
        class="border-t border-border-muted bg-rose-950/20 px-3 py-1.5"
      >
        <button
          class="flex w-full items-center justify-between text-[11px] font-medium text-rose-300 hover:text-rose-200"
          @click="showReplaced = !showReplaced"
        >
          <span>Replaces {{ replacedLines.length }} removed line{{ replacedLines.length === 1 ? '' : 's' }}</span>
          <span class="text-[10px] text-rose-400/80">{{ showReplaced ? 'Hide' : 'Peek' }}</span>
        </button>
        <pre
          v-if="showReplaced"
          class="mt-1.5 max-h-24 overflow-auto rounded bg-canvas-inset p-2 font-mono text-[11px] text-rose-200/90"
        >{{ replacedLines.map((l) => `- ${l}`).join('\n') }}</pre>
      </div>
    </div>
  </Teleport>
</template>
