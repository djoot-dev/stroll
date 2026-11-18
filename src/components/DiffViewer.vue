<script setup lang="ts">
import {
  CheckCircle2,
  ChevronsUpDown,
  ChevronRight,
  MessageSquarePlus,
  Sparkles,
  Trash2,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildPRSymbolIndex,
  getEnclosingScope,
  getReplacedLinesForAddedLine,
  resolveHoverSymbol,
  type HoverSymbolInfo,
} from '@/services/codeContext'
import { buildDiffSegments, type DiffLine } from '@/services/diffParser'
import { highlightLinesWithCodeMirror, type HighlightSpan } from '@/services/highlighter'
import { LAYER_META } from '@/services/readingOrder'
import { useReviewStore } from '@/stores/review'
import type { DiffSide, DraftComment, ReviewThread, TourStep } from '@/types/pr'
import CodeHoverPopover from './CodeHoverPopover.vue'
import CommentComposer from './CommentComposer.vue'
import ReferencedContextCard from './ReferencedContextCard.vue'

interface TokenPart {
  text: string
  className: string
  ident: string | null
}

const props = defineProps<{
  step: TourStep
}>()

const review = useReviewStore()

const expandedGaps = ref<Set<string>>(new Set())
const activeComposer = ref<{
  key: string
  line: number
  side: DiffSide
  startLine?: number
  startSide?: DiffSide
  selectedKeys: Set<string>
} | null>(null)

// Drag-to-select multiline comment state
const isDraggingSelection = ref(false)
const dragAnchorKey = ref<string | null>(null)
const dragFocusKey = ref<string | null>(null)

// Hover context & UX guardrails state
const requireAltForHover = ref(false)
const activeScopes = ref<string[]>([])
const activeReplacedCount = ref(0)
const hoverState = ref<{
  info: HoverSymbolInfo
  replacedLines: string[]
  x: number
  y: number
} | null>(null)

let hoverOpenTimer: number | null = null
let hoverCloseTimer: number | null = null

function clearHoverTimers() {
  if (hoverOpenTimer !== null) {
    window.clearTimeout(hoverOpenTimer)
    hoverOpenTimer = null
  }
  if (hoverCloseTimer !== null) {
    window.clearTimeout(hoverCloseTimer)
    hoverCloseTimer = null
  }
}

function closePopoverImmediately() {
  clearHoverTimers()
  hoverState.value = null
}

watch(
  () => props.step.file.path,
  () => {
    expandedGaps.value = new Set()
    activeComposer.value = null
    activeScopes.value = []
    activeReplacedCount.value = 0
    closePopoverImmediately()
  },
)

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && hoverState.value) {
    closePopoverImmediately()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleEsc)
  window.addEventListener('mouseup', handleWindowMouseUp)
})

onBeforeUnmount(() => {
  clearHoverTimers()
  window.removeEventListener('keydown', handleEsc)
  window.removeEventListener('mouseup', handleWindowMouseUp)
})

const symbolIndex = computed(() => buildPRSymbolIndex(review.pr?.files ?? []))

const segments = computed(() => buildDiffSegments(props.step.file))

const visibleLines = computed<DiffLine[]>(() => {
  const list: DiffLine[] = []
  for (const seg of segments.value) {
    if (seg.kind === 'gap' && !expandedGaps.value.has(seg.id)) continue
    list.push(...seg.lines)
  }
  return list
})

const selectedLineKeys = computed<Set<string>>(() => {
  if (isDraggingSelection.value && dragAnchorKey.value && dragFocusKey.value) {
    const lines = visibleLines.value
    const idxA = lines.findIndex((l) => l.key === dragAnchorKey.value)
    const idxB = lines.findIndex((l) => l.key === dragFocusKey.value)
    if (idxA !== -1 && idxB !== -1) {
      const lo = Math.min(idxA, idxB)
      const hi = Math.max(idxA, idxB)
      return new Set(lines.slice(lo, hi + 1).map((l) => l.key))
    }
  }
  return activeComposer.value?.selectedKeys ?? new Set()
})

/**
 * Pre-computes CodeMirror 6 highlight spans + resolvable PR identifier parts
 * for every DiffLine key in the current file.
 */
const tokenizedByKey = computed(() => {
  const allLines: DiffLine[] = []
  for (const seg of segments.value) {
    allLines.push(...seg.lines)
  }

  const partMap = new Map<string, TokenPart[]>()
  const tokenized = highlightLinesWithCodeMirror(
    allLines.map((l) => l.content),
    props.step.file.language,
  )

  const index = symbolIndex.value

  allLines.forEach((line, idx) => {
    const spans: HighlightSpan[] = tokenized[idx] ?? [{ text: line.content || ' ', className: '' }]
    const parts: TokenPart[] = []

    for (const sp of spans) {
      const pieces = sp.text.split(/([A-Za-z_$][\w$]*)/g)
      for (const piece of pieces) {
        if (!piece) continue
        const isIdent = piece.length >= 2 && /^[A-Za-z_$][\w$]*$/.test(piece) && index.has(piece)
        parts.push({
          text: piece,
          className: sp.className,
          ident: isIdent ? piece : null,
        })
      }
    }

    partMap.set(line.key, parts)
  })

  return partMap
})

const fileThreads = computed<ReviewThread[]>(() =>
  (review.pr?.threads ?? []).filter((t) => t.path === props.step.file.path),
)

const fileDrafts = computed<DraftComment[]>(() =>
  review.draftComments.filter((d) => d.path === props.step.file.path),
)

function threadsForLine(line: DiffLine): ReviewThread[] {
  return fileThreads.value.filter(
    (t) => t.line === line.commentLine && t.side === line.commentSide,
  )
}

function draftsForLine(line: DiffLine): DraftComment[] {
  return fileDrafts.value.filter(
    (d) => d.line === line.commentLine && d.side === line.commentSide,
  )
}

function toggleGap(gapId: string) {
  const next = new Set(expandedGaps.value)
  if (next.has(gapId)) {
    next.delete(gapId)
  } else {
    next.add(gapId)
  }
  expandedGaps.value = next
}

function startLineDrag(line: DiffLine) {
  closePopoverImmediately()
  isDraggingSelection.value = true
  dragAnchorKey.value = line.key
  dragFocusKey.value = line.key
}

function handleWindowMouseUp() {
  if (!isDraggingSelection.value) return
  const anchorKey = dragAnchorKey.value
  const focusKey = dragFocusKey.value
  isDraggingSelection.value = false
  dragAnchorKey.value = null
  dragFocusKey.value = null

  if (!anchorKey || !focusKey) return
  const lines = visibleLines.value
  const idxA = lines.findIndex((l) => l.key === anchorKey)
  const idxB = lines.findIndex((l) => l.key === focusKey)
  if (idxA === -1 || idxB === -1) return

  const lo = Math.min(idxA, idxB)
  const hi = Math.max(idxA, idxB)
  const startLineObj = lines[lo]
  const endLineObj = lines[hi]
  const keys = new Set(lines.slice(lo, hi + 1).map((l) => l.key))

  activeComposer.value = {
    key: endLineObj.key,
    line: endLineObj.commentLine,
    side: endLineObj.commentSide,
    startLine: startLineObj.commentLine,
    startSide: startLineObj.commentSide,
    selectedKeys: keys,
  }
}

function handleLineMouseEnter(line: DiffLine, hunkLines: DiffLine[], lineIdx: number) {
  if (isDraggingSelection.value) {
    dragFocusKey.value = line.key
  }
  const targetLine = line.newLineNumber ?? line.oldLineNumber ?? line.commentLine
  activeScopes.value = getEnclosingScope(props.step.file, targetLine)
  activeReplacedCount.value =
    line.type === 'add' ? getReplacedLinesForAddedLine(hunkLines, lineIdx).length : 0
}

function handleIdentMouseEnter(
  event: MouseEvent,
  ident: string,
  hunkLines: DiffLine[],
  lineIdx: number,
) {
  if (requireAltForHover.value && !event.altKey) return

  clearHoverTimers()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const replacedLines = getReplacedLinesForAddedLine(hunkLines, lineIdx)

  hoverOpenTimer = window.setTimeout(() => {
    const info = resolveHoverSymbol(
      ident,
      props.step.file,
      review.pr?.files ?? [],
      symbolIndex.value,
    )
    if (!info) return
    hoverState.value = {
      info,
      replacedLines,
      x: rect.left,
      y: rect.bottom,
    }
  }, 250)
}

function handleIdentMouseLeave() {
  if (hoverOpenTimer !== null) {
    window.clearTimeout(hoverOpenTimer)
    hoverOpenTimer = null
  }
  if (hoverState.value) {
    hoverCloseTimer = window.setTimeout(() => {
      hoverState.value = null
    }, 150)
  }
}

function handlePopoverMouseEnter() {
  if (hoverCloseTimer !== null) {
    window.clearTimeout(hoverCloseTimer)
    hoverCloseTimer = null
  }
}

function handlePopoverMouseLeave() {
  hoverCloseTimer = window.setTimeout(() => {
    hoverState.value = null
  }, 140)
}

function handleJumpFromPopover(path: string) {
  closePopoverImmediately()
  review.goToFile(path)
}

async function handleCreateDraft(body: string) {
  if (!activeComposer.value) return
  await review.addDraftComment(
    props.step.file.path,
    activeComposer.value.line,
    activeComposer.value.side,
    body,
    activeComposer.value.startLine,
    activeComposer.value.startSide,
  )
  activeComposer.value = null
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'added':
      return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
    case 'deleted':
      return 'border-rose-500/30 bg-rose-500/15 text-rose-300'
    case 'renamed':
      return 'border-amber-500/30 bg-amber-500/15 text-amber-300'
    default:
      return 'border-blue-500/30 bg-blue-500/15 text-blue-300'
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4 p-5 pb-16">
    <!-- Step Header -->
    <div class="rounded-lg border border-border bg-canvas-subtle p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
              :class="LAYER_META[step.layer].badgeClass"
            >
              {{ LAYER_META[step.layer].shortLabel }}
            </span>
            <span
              class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase"
              :class="statusBadgeClass(step.file.status)"
            >
              {{ step.file.status }}
            </span>
            <h1 class="truncate font-mono text-sm font-semibold text-slate-100">
              {{ step.file.path }}
            </h1>
          </div>

          <p class="text-xs text-slate-400">
            {{ step.reason }}
          </p>
        </div>

        <div class="flex items-center gap-3">
          <div class="font-mono text-xs">
            <span class="text-emerald-400">+{{ step.file.additions }}</span>
            <span class="mx-1 text-slate-600">/</span>
            <span class="text-rose-400">-{{ step.file.deletions }}</span>
          </div>

          <button
            class="inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              review.isStepReviewed(step.file.path)
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-border bg-canvas text-slate-300 hover:bg-canvas-elevated'
            "
            @click="review.toggleReviewed(step.file.path)"
          >
            <CheckCircle2 class="h-3.5 w-3.5" />
            <span>{{ review.isStepReviewed(step.file.path) ? 'Reviewed' : 'Mark Reviewed' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Referenced PR Context Cards -->
    <div v-if="step.referencedContexts.length > 0" class="space-y-2">
      <ReferencedContextCard
        v-for="ctx in step.referencedContexts"
        :key="ctx.sourcePath"
        :context="ctx"
        @jump-to-file="(p) => review.goToFile(p)"
      />
    </div>

    <!-- Isolated Diff Surface -->
    <div class="overflow-hidden rounded-lg border border-border bg-canvas-inset">
      <!-- Sticky Diff Context Toolbar (Enclosing Scope Breadcrumb + Hover Guardrail Toggle) -->
      <div
        class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-canvas-subtle/95 px-3 py-1.5 text-[11px] text-slate-400 backdrop-blur-sm"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="shrink-0 text-slate-500">Click or drag lines to comment</span>
          <template v-if="activeScopes.length > 0">
            <span class="text-slate-600">·</span>
            <div class="flex min-w-0 items-center gap-1 font-mono text-[11px] text-blue-300">
              <template v-for="(sc, idx) in activeScopes" :key="sc">
                <ChevronRight v-if="idx > 0" class="h-3 w-3 shrink-0 text-slate-600" />
                <span class="truncate">{{ sc }}</span>
              </template>
            </div>
          </template>
          <span
            v-if="activeReplacedCount > 0"
            class="shrink-0 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.2 font-mono text-[10px] text-rose-300"
          >
            Replaces -{{ activeReplacedCount }}
          </span>
        </div>

        <button
          class="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-slate-300 hover:bg-canvas-elevated"
          :class="{ 'border-blue-500/40 text-blue-300': !requireAltForHover }"
          title="Toggle whether symbol hover popovers open automatically (250ms delay) or only when holding Option/Alt"
          @click="requireAltForHover = !requireAltForHover"
        >
          <Sparkles class="h-3 w-3" />
          <span>{{ requireAltForHover ? 'Hover: ⌥ + Hover' : 'Hover: Auto' }}</span>
        </button>
      </div>

      <div v-if="segments.length === 0" class="p-8 text-center text-xs text-slate-500">
        No textual diff available for this file (binary or empty change).
      </div>

      <div
        v-else
        class="overflow-x-auto font-mono text-[12.5px] leading-[1.55]"
        :class="{ 'select-none': isDraggingSelection }"
      >
        <template v-for="seg in segments" :key="seg.id">
          <!-- Collapsed Unchanged Gap -->
          <template v-if="seg.kind === 'gap'">
            <button
              v-if="!expandedGaps.has(seg.id)"
              class="flex w-full items-center gap-2 border-y border-border-muted bg-canvas-subtle/70 px-4 py-1 text-left font-sans text-[11px] text-slate-400 hover:bg-blue-500/10 hover:text-blue-300"
              @click="toggleGap(seg.id)"
            >
              <ChevronsUpDown class="h-3.5 w-3.5 shrink-0" />
              <span>
                Expand {{ seg.lineCount }} unchanged line{{ seg.lineCount === 1 ? '' : 's' }}
                (lines {{ seg.startNewLine }}–{{ seg.endNewLine }})
              </span>
            </button>

            <template v-else>
              <div
                class="flex items-center justify-between border-y border-border-muted bg-canvas-subtle/50 px-4 py-0.5 font-sans text-[10px] text-slate-500"
              >
                <span>Expanded unchanged context ({{ seg.lineCount }} lines)</span>
                <button class="hover:text-slate-300" @click="toggleGap(seg.id)">Collapse</button>
              </div>
              <template v-for="(line, lIdx) in seg.lines" :key="line.key">
                <div
                  class="group flex cursor-pointer items-stretch"
                  :class="
                    selectedLineKeys.has(line.key)
                      ? 'bg-blue-500/20 ring-1 ring-inset ring-blue-500/40'
                      : 'hover:bg-slate-800/40'
                  "
                  @mousedown.left="startLineDrag(line)"
                  @mouseenter="handleLineMouseEnter(line, seg.lines, lIdx)"
                >
                  <span class="w-12 shrink-0 select-none px-2 text-right text-[11px] text-slate-600">
                    {{ line.oldLineNumber ?? '' }}
                  </span>
                  <span class="w-12 shrink-0 select-none border-r border-border-muted px-2 text-right text-[11px] text-slate-600">
                    {{ line.newLineNumber ?? '' }}
                  </span>
                  <span class="w-6 shrink-0 select-none text-center text-slate-600">
                    <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-blue-400 group-hover:block" />
                  </span>
                  <pre class="flex-1 whitespace-pre pr-4 text-slate-300"><template
                    v-for="(pt, pIdx) in tokenizedByKey.get(line.key)"
                    :key="pIdx"
                  ><span
                    v-if="pt.ident"
                    :class="[pt.className, 'cursor-help hover:underline hover:decoration-blue-400/70 hover:decoration-dotted']"
                    @mouseenter="handleIdentMouseEnter($event, pt.ident, seg.lines, lIdx)"
                    @mouseleave="handleIdentMouseLeave"
                  >{{ pt.text }}</span><span v-else :class="pt.className">{{ pt.text }}</span></template></pre>
                </div>

                <!-- Inline Composer -->
                <CommentComposer
                  v-if="activeComposer?.key === line.key"
                  :line="activeComposer.line"
                  :side="activeComposer.side"
                  :start-line="activeComposer.startLine"
                  :start-side="activeComposer.startSide"
                  @submit="handleCreateDraft"
                  @cancel="activeComposer = null"
                />
              </template>
            </template>
          </template>

          <!-- Diff Hunk Block -->
          <template v-else>
            <div
              class="border-y border-border-muted bg-blue-950/20 px-4 py-1 text-[11px] text-blue-300/80"
            >
              {{ seg.header }}
            </div>

            <template v-for="(line, lIdx) in seg.lines" :key="line.key">
              <div
                class="group flex cursor-pointer items-stretch"
                :class="
                  selectedLineKeys.has(line.key)
                    ? 'bg-blue-500/20 ring-1 ring-inset ring-blue-500/40'
                    : {
                        'bg-emerald-500/10 hover:bg-emerald-500/15': line.type === 'add',
                        'bg-rose-500/10 hover:bg-rose-500/15': line.type === 'del',
                        'hover:bg-slate-800/40': line.type === 'context',
                      }
                "
                @mousedown.left="startLineDrag(line)"
                @mouseenter="handleLineMouseEnter(line, seg.lines, lIdx)"
              >
                <span class="w-12 shrink-0 select-none px-2 text-right text-[11px] text-slate-500">
                  {{ line.oldLineNumber ?? '' }}
                </span>
                <span class="w-12 shrink-0 select-none border-r border-border-muted px-2 text-right text-[11px] text-slate-500">
                  {{ line.newLineNumber ?? '' }}
                </span>
                <span
                  class="w-6 shrink-0 select-none text-center font-bold"
                  :class="{
                    'text-emerald-400': line.type === 'add',
                    'text-rose-400': line.type === 'del',
                    'text-slate-600': line.type === 'context',
                  }"
                >
                  <span class="group-hover:hidden">
                    {{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}
                  </span>
                  <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-blue-400 group-hover:block" />
                </span>
                <pre class="flex-1 whitespace-pre pr-4 text-slate-200"><template
                  v-for="(pt, pIdx) in tokenizedByKey.get(line.key)"
                  :key="pIdx"
                ><span
                  v-if="pt.ident"
                  :class="[pt.className, 'cursor-help hover:underline hover:decoration-blue-400/70 hover:decoration-dotted']"
                  @mouseenter="handleIdentMouseEnter($event, pt.ident, seg.lines, lIdx)"
                  @mouseleave="handleIdentMouseLeave"
                >{{ pt.text }}</span><span v-else :class="pt.className">{{ pt.text }}</span></template></pre>
              </div>

              <!-- Existing GitHub Review Threads -->
              <div
                v-for="thread in threadsForLine(line)"
                :key="thread.id"
                class="my-1.5 mx-3 rounded-lg border border-border bg-canvas-subtle p-3 font-sans"
              >
                <div
                  v-for="comment in thread.comments"
                  :key="comment.id"
                  class="space-y-1"
                >
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="font-semibold text-slate-200">@{{ comment.author.login }}</span>
                    <span class="text-slate-500">
                      {{ new Date(comment.createdAt).toLocaleString() }}
                    </span>
                  </div>
                  <p class="whitespace-pre-wrap text-xs text-slate-300">{{ comment.body }}</p>
                </div>
              </div>

              <!-- Local Pending Draft Comments -->
              <div
                v-for="draft in draftsForLine(line)"
                :key="draft.id"
                class="animate-pop-in my-1.5 mx-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 font-sans"
              >
                <div class="flex items-center justify-between text-[11px]">
                  <span class="font-semibold text-amber-300">
                    Pending Draft ({{
                      draft.startLine && draft.startLine !== draft.line
                        ? `Lines ${draft.startLine}–${draft.line}`
                        : `Line ${draft.line}`
                    }})
                  </span>
                  <button
                    class="inline-flex items-center gap-1 text-slate-400 hover:text-rose-400"
                    title="Delete draft"
                    @click.stop="review.deleteDraftComment(draft.id)"
                  >
                    <Trash2 class="h-3 w-3" />
                    <span>Discard</span>
                  </button>
                </div>
                <p class="mt-1 whitespace-pre-wrap text-xs text-slate-200">{{ draft.body }}</p>
              </div>

              <!-- Inline Comment Composer -->
              <CommentComposer
                v-if="activeComposer?.key === line.key"
                :line="activeComposer.line"
                :side="activeComposer.side"
                :start-line="activeComposer.startLine"
                :start-side="activeComposer.startSide"
                @submit="handleCreateDraft"
                @cancel="activeComposer = null"
              />
            </template>
          </template>
        </template>
      </div>
    </div>

    <!-- Hover Context Popover -->
    <CodeHoverPopover
      v-if="hoverState"
      :info="hoverState.info"
      :replaced-lines="hoverState.replacedLines"
      :x="hoverState.x"
      :y="hoverState.y"
      @mouseenter="handlePopoverMouseEnter"
      @mouseleave="handlePopoverMouseLeave"
      @close="closePopoverImmediately"
      @jump-to-file="handleJumpFromPopover"
    />
  </div>
</template>
