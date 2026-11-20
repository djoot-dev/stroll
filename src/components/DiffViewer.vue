<script setup lang="ts">
import {
  ArrowDown,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  CheckCircle2,
  ChevronsUpDown,
  ChevronRight,
  Code2,
  Eye,
  FileArchive,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquarePlus,
  Search,
  Sparkles,
  Trash2,
  X,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  buildPRSymbolIndex,
  extractImportedSymbolNames,
  getEnclosingScope,
  getReplacedLinesForAddedLine,
  resolveHoverSymbolWithRepoFallback,
  type HoverSymbolInfo,
} from '@/services/codeContext'
import { isCSharpPath, loadCSharpTypeIndex, type CSharpTypeIndex } from '@/services/csharpIndex'
import { buildDiffSegments, isPureRename, type DiffLine } from '@/services/diffParser'
import {
  fetchFileBlobDataUrl,
  isBinaryFilePath,
  isImageFilePath,
} from '@/services/github'
import { highlightLinesWithCodeMirror, type HighlightSpan } from '@/services/highlighter'
import { buildLineTokenParts, type DiffTokenPart } from '@/services/inlineDiff'
import { gitBlameLine, isTauriRuntime, type GitBlameInfo } from '@/services/native'
import { isLockfile, LAYER_META } from '@/services/readingOrder'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import type { DiffSide, DraftComment, ReviewThread, TourStep } from '@/types/pr'
import CodeHoverPopover from './CodeHoverPopover.vue'
import CommentComposer from './CommentComposer.vue'
import MarkdownContent from './MarkdownContent.vue'
import ReferencedContextCard from './ReferencedContextCard.vue'
import ReviewThreadCard from './ReviewThreadCard.vue'

const props = defineProps<{
  step: TourStep
}>()

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()

const expandedGaps = ref<Set<string>>(new Set())
const isGeneratedExpanded = ref(false)
const showSvgSource = ref(false)
const showMarkdownPreview = ref(false)
const baseImageSrc = ref<string | null>(null)
const headImageSrc = ref<string | null>(null)
const isLoadingImages = ref(false)
const imageLoadError = ref<string | null>(null)
const baseImageDims = ref<{ width: number; height: number } | null>(null)
const headImageDims = ref<{ width: number; height: number } | null>(null)
const imageDataUrlCache = new Map<string, string | null>()
let imageLoadSeq = 0

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
const activeScopes = ref<string[]>([])
const activeReplacedCount = ref(0)
const hoverState = ref<{
  info: HoverSymbolInfo | null
  blame: GitBlameInfo | null
  replacedLines: string[]
  x: number
  y: number
} | null>(null)

const blameCache = new Map<string, GitBlameInfo | null>()
let hoverRequestSeq = 0

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

const isGeneratedStep = computed(() =>
  Boolean(props.step.isGenerated || props.step.file.isGenerated),
)

const isCollapsedGenerated = computed(() => isGeneratedStep.value && !isGeneratedExpanded.value)

const isPureRenameFile = computed(() => isPureRename(props.step.file))

const isImageFile = computed(() =>
  Boolean(props.step.file.isImage || isImageFilePath(props.step.file.path)),
)

const isSvgFile = computed(() => props.step.file.path.toLowerCase().endsWith('.svg'))

const isMarkdownFile = computed(() => /\.(md|markdown)$/i.test(props.step.file.path))

const markdownPreviewSource = computed(() => {
  if (!isMarkdownFile.value) return null
  if (props.step.file.status === 'deleted') {
    return props.step.file.baseContent ?? null
  }
  return props.step.file.headContent ?? props.step.file.baseContent ?? null
})

const canPreviewMarkdown = computed(
  () => isMarkdownFile.value && Boolean(markdownPreviewSource.value?.trim()),
)

const isNonImageBinary = computed(
  () =>
    !isImageFile.value &&
    !isPureRenameFile.value &&
    Boolean(props.step.file.isBinary || isBinaryFilePath(props.step.file.path)),
)

const fileExtensionBadge = computed(() => {
  const name = props.step.file.path.split('/').pop() ?? ''
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1).toUpperCase() : 'BIN'
})

function svgTextToDataUrl(svg: string | null): string | null {
  if (!svg) return null
  try {
    const bytes = new TextEncoder().encode(svg)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return `data:image/svg+xml;base64,${btoa(binary)}`
  } catch {
    return null
  }
}

async function loadImageDiffAssets() {
  const file = props.step.file
  baseImageSrc.value = null
  headImageSrc.value = null
  baseImageDims.value = null
  headImageDims.value = null
  imageLoadError.value = null

  if (!isImageFile.value) return

  // Use preloaded data URLs or inline SVG content when already available
  if (file.baseImageDataUrl !== undefined) {
    baseImageSrc.value = file.baseImageDataUrl
  } else if (isSvgFile.value && file.baseContent) {
    baseImageSrc.value = svgTextToDataUrl(file.baseContent)
  }

  if (file.headImageDataUrl !== undefined) {
    headImageSrc.value = file.headImageDataUrl
  } else if (isSvgFile.value && file.headContent) {
    headImageSrc.value = svgTextToDataUrl(file.headContent)
  }

  const pr = review.pr
  if (!pr || pr.isMock || !auth.pat) return

  const needBase = file.status !== 'added' && !baseImageSrc.value
  const needHead = file.status !== 'deleted' && !headImageSrc.value
  if (!needBase && !needHead) return

  const reqId = ++imageLoadSeq
  isLoadingImages.value = true

  try {
    const fetchCached = async (
      path: string,
      refOid: string,
      sha?: string,
    ): Promise<string | null> => {
      const cacheKey = `${pr.owner}/${pr.repo}:${refOid}:${path}`
      if (imageDataUrlCache.has(cacheKey)) {
        return imageDataUrlCache.get(cacheKey) ?? null
      }
      const url = await fetchFileBlobDataUrl(auth.pat, pr.owner, pr.repo, path, refOid, sha)
      imageDataUrlCache.set(cacheKey, url)
      return url
    }

    const [baseUrl, headUrl] = await Promise.all([
      needBase
        ? fetchCached(file.previousPath ?? file.path, pr.baseRefOid)
        : Promise.resolve(baseImageSrc.value),
      needHead
        ? fetchCached(file.path, pr.headRefOid, file.sha)
        : Promise.resolve(headImageSrc.value),
    ])

    if (reqId !== imageLoadSeq) return
    baseImageSrc.value = baseUrl
    headImageSrc.value = headUrl
  } catch (err) {
    if (reqId !== imageLoadSeq) return
    imageLoadError.value = err instanceof Error ? err.message : 'Failed to load image preview'
  } finally {
    if (reqId === imageLoadSeq) {
      isLoadingImages.value = false
    }
  }
}

function handleBaseImageLoad(e: Event) {
  const img = e.target as HTMLImageElement | null
  if (img && img.naturalWidth && img.naturalHeight) {
    baseImageDims.value = { width: img.naturalWidth, height: img.naturalHeight }
  }
}

function handleHeadImageLoad(e: Event) {
  const img = e.target as HTMLImageElement | null
  if (img && img.naturalWidth && img.naturalHeight) {
    headImageDims.value = { width: img.naturalWidth, height: img.naturalHeight }
  }
}

watch(
  () => props.step.file.path,
  () => {
    expandedGaps.value = new Set()
    isGeneratedExpanded.value = false
    showSvgSource.value = false
    showMarkdownPreview.value = false
    activeComposer.value = null
    activeScopes.value = []
    activeReplacedCount.value = 0
    closePopoverImmediately()
    void loadImageDiffAssets()
  },
  { immediate: true },
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

const csharpTypeIndex = shallowRef<CSharpTypeIndex | null>(null)
watch(
  () =>
    [
      review.currentRepoPath,
      isCSharpPath(props.step.file.path),
      review.pr?.headRefOid ?? '',
    ] as const,
  async ([repoPath, isCSharp, version]) => {
    csharpTypeIndex.value = null
    if (!repoPath || !isCSharp || !isTauriRuntime()) return
    const loaded = await loadCSharpTypeIndex(repoPath, version)
    if (
      review.currentRepoPath === repoPath &&
      isCSharpPath(props.step.file.path) &&
      (review.pr?.headRefOid ?? '') === version
    ) {
      csharpTypeIndex.value = loaded
    }
  },
  { immediate: true },
)

const hoverableSymbols = computed<ReadonlyMap<string, unknown>>(() => {
  const base = symbolIndex.value
  if (!review.currentRepoPath || !isTauriRuntime()) return base

  const content = props.step.file.headContent ?? props.step.file.baseContent
  const imported = extractImportedSymbolNames(content)
  const csharpTypes = csharpTypeIndex.value
  if (imported.size === 0 && !csharpTypes) return base

  const merged = new Map<string, unknown>(base)
  for (const name of imported) {
    if (!merged.has(name)) merged.set(name, true)
  }
  // C# `using` imports namespaces, so any type declared anywhere in the repo may be in scope.
  if (csharpTypes) {
    for (const name of csharpTypes.keys()) {
      if (!merged.has(name)) merged.set(name, true)
    }
  }
  return merged
})


const segments = computed(() =>
  buildDiffSegments(props.step.file, { ignoreWhitespace: review.ignoreWhitespace }),
)

const searchOpen = ref(false)
const searchQuery = ref('')
const activeMatchIdx = ref(0)
const searchInputRef = ref<HTMLInputElement | null>(null)

const searchMatches = computed<string[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  const keys: string[] = []
  for (const seg of segments.value) {
    if (seg.kind === 'gap' && !expandedGaps.value.has(seg.id)) continue
    for (const line of seg.lines) {
      if (line.content.toLowerCase().includes(q)) {
        keys.push(line.key)
      }
    }
  }
  return keys
})

const searchMatchSet = computed(() => new Set(searchMatches.value))
const activeMatchKey = computed(() => searchMatches.value[activeMatchIdx.value] ?? null)

function scrollToMatch(key: string | null) {
  if (!key) return
  nextTick(() => {
    const el = document.querySelector(`[data-diff-line-key="${CSS.escape(key)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

watch(searchMatches, (matches) => {
  activeMatchIdx.value = 0
  if (matches.length > 0) scrollToMatch(matches[0])
})

function stepSearchMatch(delta: -1 | 1) {
  if (searchMatches.value.length === 0) return
  activeMatchIdx.value =
    (activeMatchIdx.value + delta + searchMatches.value.length) % searchMatches.value.length
  scrollToMatch(activeMatchKey.value)
}

async function openDiffSearch() {
  searchOpen.value = true
  await nextTick()
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
}

function handleDiffKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    void openDiffSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleDiffKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleDiffKeydown)
})

const showImagePreview = computed(
  () => isImageFile.value && (!isSvgFile.value || !showSvgSource.value),
)

const visibleLines = computed<DiffLine[]>(() => {
  if (
    isCollapsedGenerated.value ||
    showImagePreview.value ||
    isNonImageBinary.value ||
    (showMarkdownPreview.value && canPreviewMarkdown.value)
  ) {
    return []
  }
  const list: DiffLine[] = []
  for (const seg of segments.value) {
    if (seg.kind === 'gap' && !expandedGaps.value.has(seg.id)) continue
    list.push(...seg.lines)
  }
  return list
})

const selectedRange = computed<{
  keys: Set<string>
  startKey: string | null
  endKey: string | null
}>(() => {
  const keys = (() => {
    if (isDraggingSelection.value && dragAnchorKey.value && dragFocusKey.value) {
      const lines = visibleLines.value
      const idxA = lines.findIndex((l) => l.key === dragAnchorKey.value)
      const idxB = lines.findIndex((l) => l.key === dragFocusKey.value)
      if (idxA !== -1 && idxB !== -1) {
        const lo = Math.min(idxA, idxB)
        const hi = Math.max(idxA, idxB)
        return lines.slice(lo, hi + 1).map((l) => l.key)
      }
    }
    return Array.from(activeComposer.value?.selectedKeys ?? [])
  })()

  return {
    keys: new Set(keys),
    startKey: keys[0] ?? null,
    endKey: keys[keys.length - 1] ?? null,
  }
})

function selectionRowClass(key: string): string {
  const { keys, startKey, endKey } = selectedRange.value
  if (!keys.has(key)) return ''
  const classes = ['stroll-diff-selected']
  if (key === startKey) classes.push('border-t border-t-terra-border')
  if (key === endKey) classes.push('border-b border-b-terra-border')
  return classes.join(' ')
}

/**
 * Pre-computes CodeMirror 6 highlight spans, intra-line word diff ranges,
 * and resolvable PR identifier parts for every DiffLine key in the current file.
 * Skipped when a generated/lockfile diff is collapsed or when viewing binary/image previews.
 */
const tokenizedByKey = computed(() => {
  const partMap = new Map<string, DiffTokenPart[]>()
  if (
    isCollapsedGenerated.value ||
    isPureRenameFile.value ||
    showImagePreview.value ||
    isNonImageBinary.value
  ) {
    return partMap
  }

  const allLines: DiffLine[] = []
  for (const seg of segments.value) {
    allLines.push(...seg.lines)
  }

  const tokenized = highlightLinesWithCodeMirror(
    allLines.map((l) => l.content),
    props.step.file.language,
  )

  const index = hoverableSymbols.value

  allLines.forEach((line, idx) => {
    const spans: HighlightSpan[] = tokenized[idx] ?? [{ text: line.content || ' ', className: '' }]
    partMap.set(line.key, buildLineTokenParts(spans, index, line.inlineChanges))
  })

  return partMap
})

function inlineChangeClass(pt: DiffTokenPart, lineType: DiffLine['type']): string {
  if (!pt.changed) return ''
  const classes = [lineType === 'add' ? 'bg-diff-add-word' : 'bg-diff-del-word']
  if (pt.changeStart) classes.push('rounded-l-[3px]')
  if (pt.changeEnd) classes.push('rounded-r-[3px]')
  return classes.join(' ')
}

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

async function fetchBlameForLine(line: DiffLine): Promise<GitBlameInfo | null> {
  const repoPath = review.currentRepoPath
  if (!repoPath || !isTauriRuntime() || line.type !== 'context' || line.oldLineNumber == null) {
    return null
  }
  const filePath = props.step.file.previousPath ?? props.step.file.path
  const refOid = review.pr?.baseRefOid ?? ''
  const cacheKey = `${repoPath}:${filePath}:${refOid}:${line.oldLineNumber}`
  if (blameCache.has(cacheKey)) {
    return blameCache.get(cacheKey) ?? null
  }
  const info = await gitBlameLine({
    repoPath,
    filePath,
    line: line.oldLineNumber,
    refOid: refOid || undefined,
  })
  blameCache.set(cacheKey, info)
  return info
}

function handleIdentMouseEnter(
  event: MouseEvent,
  ident: string,
  hunkLines: DiffLine[],
  lineIdx: number,
  line: DiffLine,
) {
  if (settings.requireAltForHover && !event.altKey) return

  clearHoverTimers()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const replacedLines = getReplacedLinesForAddedLine(hunkLines, lineIdx)
  const reqId = ++hoverRequestSeq

  hoverOpenTimer = window.setTimeout(async () => {
    const [info, blame] = await Promise.all([
      resolveHoverSymbolWithRepoFallback(
        ident,
        props.step.file,
        review.pr?.files ?? [],
        symbolIndex.value,
        review.currentRepoPath,
        csharpTypeIndex.value,
      ),
      fetchBlameForLine(line),
    ])
    if (reqId !== hoverRequestSeq) return
    if (!info && !blame) return
    hoverState.value = {
      info,
      blame,
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

function getOriginalLinesForRange(
  line: number,
  side: DiffSide,
  startLine?: number,
): string[] | undefined {
  const content = side === 'LEFT' ? props.step.file.baseContent : props.step.file.headContent
  if (!content) return undefined
  const all = content.split('\n')
  const start = Math.max(1, startLine ?? line)
  const end = Math.min(all.length, line)
  if (start > end) return undefined
  return all.slice(start - 1, end)
}

function getOriginalCodeForRange(
  line: number,
  side: DiffSide,
  startLine?: number,
): string | undefined {
  const lines = getOriginalLinesForRange(line, side, startLine)
  return lines ? lines.join('\n') : undefined
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
      return 'border-pine-border bg-pine-soft text-pine-text'
    case 'deleted':
      return 'border-crimson-border bg-crimson-soft text-crimson-text'
    case 'renamed':
      return 'border-ochre-border bg-ochre-soft text-ochre-text'
    default:
      return 'border-terra-border bg-terra-soft text-terra-text'
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4 p-5 pb-16">
    <!-- Step Header -->
    <div class="stroll-card rounded-2xl border border-border bg-canvas-subtle p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span
              v-if="isGeneratedStep"
              class="rounded-md border border-border bg-canvas-elevated px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-muted"
            >
              {{ isLockfile(step.file.path) ? 'LOCKFILE' : 'GENERATED' }}
            </span>
            <span
              v-else
              class="rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
              :class="LAYER_META[step.layer].badgeClass"
            >
              {{ LAYER_META[step.layer].shortLabel }}
            </span>
            <span
              class="rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase"
              :class="statusBadgeClass(step.file.status)"
            >
              {{ step.file.status }}
            </span>
            <h1 class="truncate font-mono text-sm font-semibold text-ink">
              {{ step.file.path }}
            </h1>
          </div>

          <div
            v-if="step.file.status === 'renamed' && step.file.previousPath"
            class="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ochre-text"
          >
            <span class="font-sans text-ink-muted">Renamed from</span>
            <span class="rounded bg-ochre-soft px-1.5 py-0.5">{{ step.file.previousPath }}</span>
            <ArrowRight class="h-3 w-3 shrink-0 text-ink-faint" />
            <span class="rounded bg-canvas-elevated px-1.5 py-0.5 text-ink">{{ step.file.path }}</span>
          </div>

          <p class="text-xs text-ink-muted">
            {{ step.reason }}
          </p>
        </div>

        <div class="flex items-center gap-2.5">
          <div class="font-mono text-xs">
            <span class="text-pine-text">+{{ step.file.additions }}</span>
            <span class="mx-1 text-ink-faint">/</span>
            <span class="text-crimson-text">-{{ step.file.deletions }}</span>
          </div>

          <button
            type="button"
            title="Search in diff (Cmd+F)"
            class="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              searchOpen
                ? 'border-terra-border bg-terra-soft text-terra-text'
                : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="searchOpen ? (searchOpen = false) : openDiffSearch()"
          >
            <Search class="h-3 w-3" />
          </button>

          <button
            type="button"
            title="Hide whitespace-only changes"
            class="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              review.ignoreWhitespace
                ? 'border-terra-border bg-terra-soft text-terra-text'
                : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="review.toggleIgnoreWhitespace()"
          >
            <span class="font-mono text-[10px]">-w</span>
            <span class="hidden sm:inline">Ignore WS</span>
          </button>

          <button
            class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              review.isStepReviewed(step.file.path)
                ? 'border-pine-border bg-pine-soft text-pine-text'
                : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated'
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
    <div class="stroll-card relative overflow-hidden rounded-2xl border border-border bg-code">
      <!-- Floating In-Diff Search Bar -->
      <div
        v-if="searchOpen"
        class="animate-pop-in sticky top-2 z-20 mx-3 mt-2 flex items-center gap-2 rounded-xl border border-terra-border bg-canvas-subtle px-3 py-1.5 shadow-lg"
      >
        <Search class="h-3.5 w-3.5 shrink-0 text-ink-muted" />
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          placeholder="Find in diff…"
          class="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder-ink-faint focus:outline-none"
          @keydown.enter.exact.prevent="stepSearchMatch(1)"
          @keydown.shift.enter.prevent="stepSearchMatch(-1)"
          @keydown.esc.prevent="searchOpen = false; searchQuery = ''"
        />
        <span v-if="searchQuery.trim()" class="font-mono text-[10.5px] text-ink-muted">
          {{ searchMatches.length > 0 ? `${activeMatchIdx + 1}/${searchMatches.length}` : '0/0' }}
        </span>
        <button
          type="button"
          class="rounded p-0.5 text-ink-muted hover:bg-canvas-elevated hover:text-ink"
          title="Previous match"
          @click="stepSearchMatch(-1)"
        >
          <ArrowUp class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="rounded p-0.5 text-ink-muted hover:bg-canvas-elevated hover:text-ink"
          title="Next match"
          @click="stepSearchMatch(1)"
        >
          <ArrowDown class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="rounded p-0.5 text-ink-muted hover:bg-canvas-elevated hover:text-ink"
          title="Close search"
          @click="searchOpen = false; searchQuery = ''"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
      <!-- Collapsed Generated / Lockfile Banner -->
      <div
        v-if="isCollapsedGenerated"
        class="flex flex-col items-center justify-center gap-3 bg-canvas-subtle/60 px-6 py-10 text-center"
      >
        <div class="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-canvas-elevated text-ink-muted">
          <FileCode2 class="h-5 w-5" />
        </div>
        <div class="space-y-1">
          <p class="text-xs font-medium text-ink">
            Generated / lockfile diff hidden to reduce noise
            <span class="ml-1 font-mono">
              (<span class="text-pine-text">+{{ step.file.additions }}</span> /
              <span class="text-crimson-text">-{{ step.file.deletions }}</span>)
            </span>
          </p>
          <p class="text-[11px] text-ink-muted">
            Syntax highlighting is deferred until you expand this file.
          </p>
        </div>
        <button
          class="inline-flex items-center gap-1.5 rounded-xl border border-border bg-canvas px-3.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-terra-border hover:bg-terra-soft hover:text-terra-text"
          @click="isGeneratedExpanded = true"
        >
          <Eye class="h-3.5 w-3.5" />
          <span>Load Diff</span>
        </button>
      </div>

      <!-- Pure Rename (No Content Changes) -->
      <div
        v-else-if="isPureRenameFile"
        class="flex flex-col items-center justify-center gap-3 bg-canvas-subtle/60 px-6 py-10 text-center"
      >
        <div class="flex h-10 w-10 items-center justify-center rounded-xl border border-ochre-border bg-ochre-soft text-ochre-text">
          <ArrowRightLeft class="h-5 w-5" />
        </div>
        <div class="space-y-1">
          <p class="text-xs font-semibold text-ink">
            File renamed without content changes
          </p>
          <p
            v-if="step.file.previousPath"
            class="flex flex-wrap items-center justify-center gap-1.5 font-mono text-[11px] text-ink-muted"
          >
            <span>{{ step.file.previousPath }}</span>
            <ArrowRight class="h-3 w-3 text-ochre-text" />
            <span class="text-ink">{{ step.file.path }}</span>
          </p>
        </div>
      </div>

      <!-- Image Diff Preview -->
      <template v-else-if="showImagePreview">
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-canvas-subtle/95 px-3.5 py-1.5 text-[11px] text-ink-muted"
        >
          <div class="flex items-center gap-2">
            <ImageIcon class="h-3.5 w-3.5 text-terra" />
            <span>Image diff preview</span>
          </div>
          <button
            v-if="isSvgFile && segments.length > 0"
            class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
            @click="showSvgSource = true"
          >
            <Code2 class="h-3 w-3" />
            <span>View Source Diff</span>
          </button>
        </div>

        <div class="p-6">
          <div
            v-if="isLoadingImages"
            class="flex items-center justify-center gap-2 py-10 text-xs text-ink-muted"
          >
            <Loader2 class="h-4 w-4 animate-spin text-terra" />
            <span>Loading image preview…</span>
          </div>

          <div
            v-else-if="imageLoadError"
            class="rounded-xl border border-crimson-border bg-crimson-soft p-4 text-center text-xs text-crimson-text"
          >
            {{ imageLoadError }}
          </div>

          <!-- Added Image -->
          <div
            v-else-if="step.file.status === 'added'"
            class="mx-auto max-w-2xl overflow-hidden rounded-xl border border-pine-border bg-canvas-subtle"
          >
            <div class="flex items-center justify-between border-b border-pine-border bg-pine-soft px-3.5 py-2 text-xs">
              <span class="font-semibold text-pine-text">Added Image</span>
              <span v-if="headImageDims" class="font-mono text-[11px] text-pine-text">
                {{ headImageDims.width }} × {{ headImageDims.height }} px
              </span>
            </div>
            <div class="flex items-center justify-center bg-canvas-inset p-6">
              <img
                v-if="headImageSrc"
                :src="headImageSrc"
                :alt="step.file.path"
                class="max-h-[420px] max-w-full rounded-lg border border-border object-contain shadow-xs"
                @load="handleHeadImageLoad"
              />
              <span v-else class="text-xs text-ink-muted">Image preview unavailable</span>
            </div>
          </div>

          <!-- Deleted Image -->
          <div
            v-else-if="step.file.status === 'deleted'"
            class="mx-auto max-w-2xl overflow-hidden rounded-xl border border-crimson-border bg-canvas-subtle"
          >
            <div class="flex items-center justify-between border-b border-crimson-border bg-crimson-soft px-3.5 py-2 text-xs">
              <span class="font-semibold text-crimson-text">Deleted Image</span>
              <span v-if="baseImageDims" class="font-mono text-[11px] text-crimson-text">
                {{ baseImageDims.width }} × {{ baseImageDims.height }} px
              </span>
            </div>
            <div class="flex items-center justify-center bg-canvas-inset p-6">
              <img
                v-if="baseImageSrc"
                :src="baseImageSrc"
                :alt="step.file.path"
                class="max-h-[420px] max-w-full rounded-lg border border-crimson-border object-contain opacity-65 shadow-xs"
                @load="handleBaseImageLoad"
              />
              <span v-else class="text-xs text-ink-muted">Image preview unavailable</span>
            </div>
          </div>

          <!-- Modified / Renamed Image: Side-by-Side Comparison -->
          <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="overflow-hidden rounded-xl border border-crimson-border bg-canvas-subtle">
              <div class="flex items-center justify-between border-b border-crimson-border bg-crimson-soft px-3.5 py-2 text-xs">
                <span class="font-semibold text-crimson-text">Before (Base)</span>
                <span v-if="baseImageDims" class="font-mono text-[11px] text-crimson-text">
                  {{ baseImageDims.width }} × {{ baseImageDims.height }} px
                </span>
              </div>
              <div class="flex min-h-[180px] items-center justify-center bg-canvas-inset p-5">
                <img
                  v-if="baseImageSrc"
                  :src="baseImageSrc"
                  :alt="`Base ${step.file.path}`"
                  class="max-h-[360px] max-w-full rounded-lg border border-border object-contain shadow-xs"
                  @load="handleBaseImageLoad"
                />
                <span v-else class="text-xs text-ink-muted">Base preview unavailable</span>
              </div>
            </div>

            <div class="overflow-hidden rounded-xl border border-pine-border bg-canvas-subtle">
              <div class="flex items-center justify-between border-b border-pine-border bg-pine-soft px-3.5 py-2 text-xs">
                <span class="font-semibold text-pine-text">After (Head)</span>
                <span v-if="headImageDims" class="font-mono text-[11px] text-pine-text">
                  {{ headImageDims.width }} × {{ headImageDims.height }} px
                </span>
              </div>
              <div class="flex min-h-[180px] items-center justify-center bg-canvas-inset p-5">
                <img
                  v-if="headImageSrc"
                  :src="headImageSrc"
                  :alt="`Head ${step.file.path}`"
                  class="max-h-[360px] max-w-full rounded-lg border border-border object-contain shadow-xs"
                  @load="handleHeadImageLoad"
                />
                <span v-else class="text-xs text-ink-muted">Head preview unavailable</span>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Non-Image Binary File Card -->
      <div
        v-else-if="isNonImageBinary"
        class="flex flex-col items-center justify-center gap-3 bg-canvas-subtle/60 px-6 py-10 text-center"
      >
        <div class="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-canvas-elevated text-ink-muted">
          <FileArchive class="h-5 w-5" />
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-center gap-2">
            <span class="rounded-md border border-border bg-canvas-elevated px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-secondary">
              {{ fileExtensionBadge }}
            </span>
            <span
              class="rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase"
              :class="statusBadgeClass(step.file.status)"
            >
              {{ step.file.status }}
            </span>
          </div>
          <p class="text-xs font-semibold text-ink">
            Binary file ({{ step.file.status }})
          </p>
          <p class="text-[11px] text-ink-muted">
            Binary assets cannot be displayed as a textual diff.
          </p>
        </div>
      </div>

      <!-- Rendered Markdown File Preview -->
      <template v-else-if="showMarkdownPreview && canPreviewMarkdown">
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-canvas-subtle/95 px-3.5 py-1.5 text-[11px] text-ink-muted"
        >
          <div class="flex items-center gap-2">
            <FileText class="h-3.5 w-3.5 text-terra" />
            <span>
              Markdown preview ({{ step.file.status === 'deleted' ? 'Before / Base' : 'After / Head' }})
            </span>
          </div>
          <button
            class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
            @click="showMarkdownPreview = false"
          >
            <Code2 class="h-3 w-3" />
            <span>View Source Diff</span>
          </button>
        </div>

        <div class="bg-canvas p-6">
          <MarkdownContent
            :content="markdownPreviewSource ?? ''"
            class="mx-auto max-w-3xl text-[13px] leading-relaxed text-ink-secondary"
          />
        </div>
      </template>

      <!-- Standard Textual Diff -->
      <template v-else>
        <!-- Sticky Diff Context Toolbar (Enclosing Scope Breadcrumb + Hover Guardrail Toggle) -->
        <div
          class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-canvas-subtle/95 px-3.5 py-1.5 text-[11px] text-ink-muted backdrop-blur-sm"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span class="shrink-0 text-ink-muted">Click or drag lines to comment</span>
            <template v-if="activeScopes.length > 0">
              <span class="text-ink-faint">·</span>
              <div class="flex min-w-0 items-center gap-1 font-mono text-[11px] text-terra-text">
                <template v-for="(sc, idx) in activeScopes" :key="sc">
                  <ChevronRight v-if="idx > 0" class="h-3 w-3 shrink-0 text-ink-faint" />
                  <span class="truncate">{{ sc }}</span>
                </template>
              </div>
            </template>
            <span
              v-if="activeReplacedCount > 0"
              class="shrink-0 rounded border border-crimson-border bg-crimson-soft px-1.5 py-0.2 font-mono text-[10px] text-crimson-text"
            >
              Replaces -{{ activeReplacedCount }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <button
              v-if="isSvgFile"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="showSvgSource = false"
            >
              <ImageIcon class="h-3 w-3" />
              <span>Image Preview</span>
            </button>

            <button
              v-if="canPreviewMarkdown"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="showMarkdownPreview = true"
            >
              <FileText class="h-3 w-3" />
              <span>Preview Markdown</span>
            </button>

            <button
              v-if="isGeneratedStep && isGeneratedExpanded"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="isGeneratedExpanded = false"
            >
              <span>Collapse Generated</span>
            </button>

            <button
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] transition-colors"
              :class="
                !settings.requireAltForHover
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated'
              "
              title="Toggle whether symbol hover popovers open automatically (250ms delay) or only when holding Option/Alt"
              @click="settings.setRequireAltForHover(!settings.requireAltForHover)"
            >
              <Sparkles class="h-3 w-3" />
              <span>{{ settings.requireAltForHover ? 'Hover: ⌥ + Hover' : 'Hover: Auto' }}</span>
            </button>
          </div>
        </div>

        <div v-if="segments.length === 0" class="p-8 text-center text-xs text-ink-muted">
          No textual diff available for this file (binary or empty change).
        </div>

        <div
          v-else
          class="overflow-x-auto font-mono leading-[1.55]"
          :class="{ 'select-none': isDraggingSelection }"
          :style="{ fontSize: `${settings.codeFontSize}px` }"
        >
          <template v-for="seg in segments" :key="seg.id">
          <!-- Collapsed Unchanged Gap -->
          <template v-if="seg.kind === 'gap'">
            <button
              v-if="!expandedGaps.has(seg.id)"
              class="flex w-full items-center gap-2 border-y border-border-muted bg-canvas-subtle px-4 py-1 text-left font-sans text-[11px] text-ink-secondary transition-colors hover:bg-terra-soft hover:text-terra-text"
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
                class="flex items-center justify-between border-y border-border-muted bg-canvas-subtle/80 px-4 py-0.5 font-sans text-[10px] text-ink-muted"
              >
                <span>Expanded unchanged context ({{ seg.lineCount }} lines)</span>
                <button class="hover:text-ink" @click="toggleGap(seg.id)">Collapse</button>
              </div>
              <template v-for="(line, lIdx) in seg.lines" :key="line.key">
                <div
                  class="group flex cursor-pointer items-stretch border-l-2 border-l-transparent"
                  :class="
                    selectedRange.keys.has(line.key)
                      ? selectionRowClass(line.key)
                      : 'hover:bg-diff-hover'
                  "
                  @mousedown.left="startLineDrag(line)"
                  @mouseenter="handleLineMouseEnter(line, seg.lines, lIdx)"
                >
                  <span class="w-12 shrink-0 select-none px-2 text-right text-[11px] text-code-gutter-text">
                    {{ line.oldLineNumber ?? '' }}
                  </span>
                  <span class="w-12 shrink-0 select-none border-r border-border-muted px-2 text-right text-[11px] text-code-gutter-text">
                    {{ line.newLineNumber ?? '' }}
                  </span>
                  <span class="w-6 shrink-0 select-none text-center text-code-gutter-text">
                    <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-terra group-hover:block" />
                  </span>
                  <pre class="flex-1 whitespace-pre pr-4 text-ink"><template
                    v-for="(pt, pIdx) in tokenizedByKey.get(line.key)"
                    :key="pIdx"
                  ><span
                    v-if="pt.ident"
                    :class="[pt.className, 'cursor-help hover:underline hover:decoration-terra hover:decoration-dotted']"
                    @mouseenter="handleIdentMouseEnter($event, pt.ident, seg.lines, lIdx, line)"
                    @mouseleave="handleIdentMouseLeave"
                  >{{ pt.text }}</span><span v-else :class="pt.className">{{ pt.text }}</span></template></pre>
                </div>

                <!-- Existing GitHub Review Threads -->
                <ReviewThreadCard
                  v-for="thread in threadsForLine(line)"
                  :key="thread.id"
                  :thread="thread"
                />

                <!-- Inline Composer -->
                <CommentComposer
                  v-if="activeComposer?.key === line.key"
                  :line="activeComposer.line"
                  :side="activeComposer.side"
                  :start-line="activeComposer.startLine"
                  :start-side="activeComposer.startSide"
                  :original-code="
                    getOriginalCodeForRange(
                      activeComposer.line,
                      activeComposer.side,
                      activeComposer.startLine,
                    )
                  "
                  @submit="handleCreateDraft"
                  @cancel="activeComposer = null"
                />
              </template>
            </template>
          </template>

          <!-- Diff Hunk Block -->
          <template v-else>
            <div
              class="border-y border-border-muted bg-sage-soft px-4 py-1 text-[11px] font-medium text-sage-text"
            >
              {{ seg.header }}
            </div>

            <template v-for="(line, lIdx) in seg.lines" :key="line.key">
              <div
                :data-diff-line-key="line.key"
                class="group flex cursor-pointer items-stretch border-l-2"
                :class="[
                  selectedRange.keys.has(line.key)
                    ? ['border-l-transparent', selectionRowClass(line.key)]
                    : {
                        'border-l-pine bg-diff-add hover:bg-diff-add-hover': line.type === 'add',
                        'border-l-crimson bg-diff-del hover:bg-diff-del-hover': line.type === 'del',
                        'border-l-transparent hover:bg-diff-hover': line.type === 'context',
                      },
                  activeMatchKey === line.key
                    ? 'ring-1 ring-inset ring-terra bg-terra-soft/30'
                    : searchMatchSet.has(line.key)
                      ? 'bg-ochre-soft/20'
                      : '',
                ]"
                @mousedown.left="startLineDrag(line)"
                @mouseenter="handleLineMouseEnter(line, seg.lines, lIdx)"
              >
                <span class="w-12 shrink-0 select-none px-2 text-right text-[11px] text-code-gutter-text">
                  {{ line.oldLineNumber ?? '' }}
                </span>
                <span class="w-12 shrink-0 select-none border-r border-border-muted px-2 text-right text-[11px] text-code-gutter-text">
                  {{ line.newLineNumber ?? '' }}
                </span>
                <span
                  class="w-6 shrink-0 select-none text-center font-bold"
                  :class="{
                    'text-pine-text': line.type === 'add',
                    'text-crimson-text': line.type === 'del',
                    'text-code-gutter-text': line.type === 'context',
                  }"
                >
                  <span class="group-hover:hidden">
                    {{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}
                  </span>
                  <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-terra group-hover:block" />
                </span>
                <pre class="flex-1 whitespace-pre pr-4 text-ink"><template
                  v-for="(pt, pIdx) in tokenizedByKey.get(line.key)"
                  :key="pIdx"
                ><span
                  v-if="pt.ident"
                  :class="[
                    pt.className,
                    inlineChangeClass(pt, line.type),
                    'cursor-help hover:underline hover:decoration-terra hover:decoration-dotted',
                  ]"
                  @mouseenter="handleIdentMouseEnter($event, pt.ident, seg.lines, lIdx, line)"
                  @mouseleave="handleIdentMouseLeave"
                >{{ pt.text }}</span><span
                  v-else
                  :class="[pt.className, inlineChangeClass(pt, line.type)]"
                >{{ pt.text }}</span></template></pre>
              </div>

              <!-- Existing GitHub Review Threads -->
              <ReviewThreadCard
                v-for="thread in threadsForLine(line)"
                :key="thread.id"
                :thread="thread"
              />

              <!-- Local Pending Draft Comments -->
              <div
                v-for="draft in draftsForLine(line)"
                :key="draft.id"
                class="animate-pop-in my-1.5 mx-3 rounded-xl border border-ochre-border bg-ochre-soft p-3 font-sans"
              >
                <div class="flex items-center justify-between text-[11px]">
                  <span class="font-semibold text-ochre-text">
                    Pending Draft ({{
                      draft.startLine && draft.startLine !== draft.line
                        ? `Lines ${draft.startLine}–${draft.line}`
                        : `Line ${draft.line}`
                    }})
                  </span>
                  <button
                    class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                    title="Delete draft"
                    @click.stop="review.deleteDraftComment(draft.id)"
                  >
                    <Trash2 class="h-3 w-3" />
                    <span>Discard</span>
                  </button>
                </div>
                <MarkdownContent
                  :content="draft.body"
                  :original-lines="
                    getOriginalLinesForRange(draft.line, draft.side, draft.startLine)
                  "
                  class="mt-1 text-xs leading-relaxed text-ink"
                />
              </div>

              <!-- Inline Comment Composer -->
              <CommentComposer
                v-if="activeComposer?.key === line.key"
                :line="activeComposer.line"
                :side="activeComposer.side"
                :start-line="activeComposer.startLine"
                :start-side="activeComposer.startSide"
                :original-code="
                  getOriginalCodeForRange(
                    activeComposer.line,
                    activeComposer.side,
                    activeComposer.startLine,
                  )
                "
                @submit="handleCreateDraft"
                @cancel="activeComposer = null"
              />
            </template>
          </template>
        </template>
      </div>
      </template>
    </div>

    <!-- Hover Context Popover -->
    <CodeHoverPopover
      v-if="hoverState"
      :info="hoverState.info"
      :blame="hoverState.blame"
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
