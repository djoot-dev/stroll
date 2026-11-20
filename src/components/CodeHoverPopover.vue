<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpRight,
  Equal,
  FileCode2,
  GitCommitHorizontal,
  GitCompare,
  Layers,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { HoverSymbolInfo } from '@/services/codeContext'
import { highlightLinesWithCodeMirror } from '@/services/highlighter'
import type { GitBlameInfo } from '@/services/native'
import { computePopoverPosition } from '@/services/popoverPosition'

const props = defineProps<{
  info: HoverSymbolInfo | null
  blame?: GitBlameInfo | null
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
  if (!props.info) return ''
  if (showBefore.value && props.info.declaration.baseSnippet) {
    return props.info.declaration.baseSnippet
  }
  return props.info.declaration.headSnippet
})

const highlightedSnippet = computed(() => {
  if (!props.info) return []
  return highlightLinesWithCodeMirror(
    activeSnippet.value.split('\n'),
    props.info.declaration.language,
  )
})

const KIND_LABELS: Record<string, string> = { enumMember: 'enum member' }

const kindLabel = computed(() =>
  props.info ? (KIND_LABELS[props.info.declaration.kind] ?? props.info.declaration.kind) : '',
)

const VALUE_NOTES: Record<string, { label: string; title: string }> = {
  implicit: {
    label: 'implicit',
    title: 'No initializer: value inferred from the member position',
  },
  convention: {
    label: 'by convention',
    title: 'UPPER_CASE module variable: constant by naming convention, not enforced',
  },
  readonly: {
    label: 'readonly',
    title: 'static readonly: fixed after initialization, but evaluated at runtime',
  },
}

const constValue = computed(() => props.info?.declaration.value ?? null)

const changedFromValue = computed(() => {
  const decl = props.info?.declaration
  if (!decl || !decl.value || !decl.baseValue) return null
  return decl.baseValue !== decl.value ? decl.baseValue : null
})

const valueNote = computed(() => {
  const note = props.info?.declaration.valueNote
  return note ? VALUE_NOTES[note] ?? null : null
})

function highlightValue(value: string) {
  return highlightLinesWithCodeMirror([value], props.info?.declaration.language ?? '')[0] ?? []
}

const highlightedValue = computed(() => (constValue.value ? highlightValue(constValue.value) : []))
const highlightedBaseValue = computed(() =>
  changedFromValue.value ? highlightValue(changedFromValue.value) : [],
)

function formatBlameDate(timestamp: number): string {
  if (!timestamp) return ''
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - timestamp)
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

const POPOVER_WIDTH = 460
const ESTIMATED_HEIGHT = 380

const popoverEl = ref<HTMLElement | null>(null)
const measuredHeight = ref<number | null>(null)
const viewport = ref({
  width: typeof window !== 'undefined' ? window.innerWidth : 1280,
  height: typeof window !== 'undefined' ? window.innerHeight : 800,
})

let resizeObserver: ResizeObserver | null = null

function measure() {
  const el = popoverEl.value
  if (!el) return
  // scrollHeight (+ borders) reflects the natural height even when max-height caps it.
  measuredHeight.value = el.scrollHeight + (el.offsetHeight - el.clientHeight)
}

function handleWindowResize() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
}

onMounted(() => {
  measure()
  window.addEventListener('resize', handleWindowResize)
  if (typeof ResizeObserver !== 'undefined' && popoverEl.value) {
    resizeObserver = new ResizeObserver(() => measure())
    // Observe the content so toggles (Peek, Before/After) re-align the popover.
    for (const child of Array.from(popoverEl.value.children)) resizeObserver.observe(child)
    resizeObserver.observe(popoverEl.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)
  resizeObserver?.disconnect()
  resizeObserver = null
})

const popoverStyle = computed(() => {
  const pos = computePopoverPosition({
    x: props.x,
    y: props.y,
    width: POPOVER_WIDTH,
    height: measuredHeight.value ?? ESTIMATED_HEIGHT,
    viewportWidth: viewport.value.width,
    viewportHeight: viewport.value.height,
  })

  return {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    width: `${pos.width}px`,
    maxHeight: pos.maxHeight !== null ? `${pos.maxHeight}px` : undefined,
    overflowY: pos.maxHeight !== null ? ('auto' as const) : undefined,
    visibility: measuredHeight.value === null ? ('hidden' as const) : undefined,
  }
})

const hasBeforeAfter = computed(
  () =>
    Boolean(props.info) &&
    props.info!.declaration.isModifiedInPR &&
    Boolean(props.info!.declaration.baseSnippet) &&
    props.info!.declaration.baseSnippet !== props.info!.declaration.headSnippet,
)
</script>

<template>
  <Teleport to="body">
    <div
      ref="popoverEl"
      class="animate-pop-in stroll-elevated fixed z-50 overflow-hidden rounded-2xl border border-border bg-canvas-subtle"
      :style="popoverStyle"
      @mouseenter="emit('mouseenter')"
      @mouseleave="emit('mouseleave')"
      @click.stop
    >
      <!-- Header -->
      <div
        v-if="info"
        class="flex items-center justify-between gap-2 border-b border-border bg-canvas-elevated/60 px-3 py-2"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <FileCode2 class="h-3.5 w-3.5 shrink-0 text-terra" />
          <span class="rounded-md bg-terra-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-terra-text">
            {{ kindLabel }}
          </span>
          <span class="truncate font-mono text-xs font-semibold text-ink">
            {{ info.declaration.name }}
          </span>
          <span
            v-if="info.declaration.isModifiedInPR"
            class="shrink-0 rounded-md border border-ochre-border bg-ochre-soft px-1.5 py-0.5 text-[10px] font-medium text-ochre-text"
          >
            Modified in PR
          </span>
          <span
            v-else-if="info.declaration.source === 'repo'"
            class="shrink-0 rounded-md border border-plum-border bg-plum-soft px-1.5 py-0.5 text-[10px] font-medium text-plum-text"
          >
            Repo Definition (Unchanged)
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <button
            v-if="hasBeforeAfter"
            class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors"
            :class="
              showBefore
                ? 'border-ochre-border bg-ochre-soft text-ochre-text'
                : 'border-border bg-canvas-subtle text-ink-secondary hover:bg-canvas-elevated'
            "
            title="Toggle Before / After PR definition"
            @click="showBefore = !showBefore"
          >
            <GitCompare class="h-3 w-3" />
            <span>{{ showBefore ? 'Base (Before)' : 'Head (After)' }}</span>
          </button>

          <button
            v-if="!info.isSameFile && info.declaration.source !== 'repo'"
            class="inline-flex items-center gap-0.5 rounded-md border border-terra-border bg-terra-soft px-1.5 py-0.5 text-[10px] font-medium text-terra-text transition-colors hover:bg-terra hover:text-white"
            title="Jump to definition step"
            @click="emit('jumpToFile', info.declaration.path)"
          >
            <span>Jump</span>
            <ArrowUpRight class="h-3 w-3" />
          </button>

          <button
            class="rounded-md p-0.5 text-ink-muted hover:bg-canvas-elevated hover:text-ink"
            title="Close (Esc)"
            @click="emit('close')"
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <!-- Constant / enum member value -->
      <div
        v-if="info && constValue"
        class="flex items-start gap-2 border-b border-border-muted bg-canvas px-3 py-1.5"
      >
        <Equal class="mt-0.5 h-3.5 w-3.5 shrink-0 text-terra" />
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11.5px]">
          <template v-if="changedFromValue">
            <span
              class="rounded bg-crimson-soft px-1 text-crimson-text line-through decoration-crimson-text/60 break-words"
              title="Value before this PR"
            >
              <span v-for="(sp, sIdx) in highlightedBaseValue" :key="sIdx">{{ sp.text }}</span>
            </span>
            <ArrowRight class="h-3 w-3 shrink-0 text-ink-faint" />
            <span class="rounded bg-pine-soft px-1 font-semibold break-words" title="Value after this PR">
              <span v-for="(sp, sIdx) in highlightedValue" :key="sIdx" :class="sp.className">{{ sp.text }}</span>
            </span>
          </template>
          <span v-else class="font-semibold break-words">
            <span v-for="(sp, sIdx) in highlightedValue" :key="sIdx" :class="sp.className">{{ sp.text }}</span>
          </span>
          <span
            v-if="valueNote"
            class="shrink-0 rounded-md border border-border bg-canvas-subtle px-1.5 py-px font-sans text-[10px] text-ink-muted"
            :title="valueNote.title"
          >
            {{ valueNote.label }}
          </span>
        </div>
      </div>

      <!-- Location -->
      <div
        v-if="info"
        class="border-b border-border-muted bg-canvas px-3 py-1 font-mono text-[10px] text-ink-muted"
      >
        {{ info.declaration.path }}:{{ info.declaration.line }}
      </div>

      <!-- Leading Doc Comment -->
      <div
        v-if="info?.declaration.docComment"
        class="border-b border-border-muted bg-canvas-subtle/60 px-3 py-1.5 font-mono text-[11px] text-ink-muted whitespace-pre-wrap"
      >
        {{ info.declaration.docComment }}
      </div>

      <!-- Highlighted Definition Snippet -->
      <div
        v-if="info"
        class="max-h-48 overflow-auto bg-code px-3 py-2 font-mono text-[11.5px] leading-relaxed"
      >
        <div
          v-for="(spans, lIdx) in highlightedSnippet"
          :key="lIdx"
          class="whitespace-pre text-ink"
        >
          <span v-for="(sp, sIdx) in spans" :key="sIdx" :class="sp.className">{{ sp.text }}</span>
        </div>
      </div>

      <!-- Blast Radius / Used By in PR -->
      <div
        v-if="info && info.usages.length > 0"
        class="border-t border-border-muted bg-canvas-subtle px-3 py-2"
      >
        <div class="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          <Layers class="h-3 w-3 text-plum-text" />
          <span>Used in {{ info.usages.length }} PR location{{ info.usages.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="max-h-24 space-y-1 overflow-y-auto">
          <button
            v-for="(u, uIdx) in info.usages"
            :key="`${u.path}:${u.line}:${uIdx}`"
            class="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-left font-mono text-[10.5px] text-ink-secondary hover:bg-canvas-elevated"
            @click="emit('jumpToFile', u.path)"
          >
            <span class="shrink-0 text-terra-text">{{ u.path.split('/').pop() }}:{{ u.line }}</span>
            <span class="truncate text-ink-faint">{{ u.preview }}</span>
          </button>
        </div>
      </div>

      <!-- Git Blame (for unchanged context lines when local repo linked) -->
      <div
        v-if="blame"
        class="border-t border-border-muted bg-canvas px-3 py-2"
      >
        <div class="flex items-center justify-between gap-2 text-[10.5px]">
          <div class="flex min-w-0 items-center gap-1.5">
            <GitCommitHorizontal class="h-3.5 w-3.5 shrink-0 text-pine" />
            <span class="rounded bg-pine-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-pine-text">
              {{ blame.shortOid }}
            </span>
            <span class="truncate font-medium text-ink">{{ blame.authorName }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <span class="text-[10px] text-ink-faint">{{ formatBlameDate(blame.timestamp) }}</span>
            <button
              v-if="!info"
              class="rounded p-0.5 text-ink-muted hover:bg-canvas-elevated hover:text-ink"
              title="Close (Esc)"
              @click="emit('close')"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <p v-if="blame.summary" class="mt-1 truncate text-[11px] text-ink-muted">
          {{ blame.summary }}
        </p>
      </div>

      <!-- Replaced '-' Lines Peek (when hovering a '+' line) -->
      <div
        v-if="replacedLines.length > 0"
        class="border-t border-border-muted bg-crimson-soft px-3 py-1.5"
      >
        <button
          class="flex w-full items-center justify-between text-[11px] font-medium text-crimson-text"
          @click="showReplaced = !showReplaced"
        >
          <span>Replaces {{ replacedLines.length }} removed line{{ replacedLines.length === 1 ? '' : 's' }}</span>
          <span class="text-[10px] opacity-80">{{ showReplaced ? 'Hide' : 'Peek' }}</span>
        </button>
        <pre
          v-if="showReplaced"
          class="mt-1.5 max-h-24 overflow-auto rounded-lg bg-code p-2 font-mono text-[11px] text-crimson-text"
        >{{ replacedLines.map((l) => `- ${l}`).join('\n') }}</pre>
      </div>
    </div>
  </Teleport>
</template>
