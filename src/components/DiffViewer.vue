<script setup lang="ts">
import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ChevronRight,
  Code2,
  Columns2,
  Copy,
  ExternalLink,
  Eye,
  FileArchive,
  FileCode2,
  FileDiff,
  FileText,
  Filter,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  Pencil,
  Rows2,
  Search,
  Send,
  Sparkles,
  Trash2,
  WrapText,
  X,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  buildPRSymbolIndex,
  createHoverableSymbols,
  expandDeclarationSnippets,
  extractImportedSymbolNames,
  getEnclosingScope,
  getReplacedLinesForAddedLine,
  resolveHoverSymbolWithRepoFallback,
  type HoverableSymbols,
  type HoverSymbolInfo,
  type SymbolUsage,
} from '@/services/codeContext'
import { isCSharpPath, loadCSharpTypeIndex, type CSharpTypeIndex } from '@/services/csharpIndex'
import { buildDiffSegments, isPureRename, type DiffLine, type DiffSegment } from '@/services/diffParser'
import {
  buildMarkdownDiffBlocks,
  type MarkdownDiffBlock,
  type MarkdownDiffLineAnchor,
} from '@/services/markdownDiff'
import { formatMovedBadgeLabel, type MovedLineInfo } from '@/services/movedCode'
import {
  applySearchMatchRanges,
  computeCenteredRevealDelta,
  findDiffMatches,
  findLineMatchRanges,
  pickStartMatchIndex,
  type SearchMatchRange,
  type SearchTokenPart,
} from '@/services/diffSearch'
import {
  fetchFileBlobDataUrl,
  isBinaryFilePath,
  isImageFilePath,
} from '@/services/github'
import { highlightLinesWithCodeMirror, type HighlightSpan } from '@/services/highlighter'
import { buildLineTokenParts, type DiffTokenPart } from '@/services/inlineDiff'
import {
  buildExternalEditorUrl,
  gitBlameLine,
  isTauriRuntime,
  openFileInEditor,
  openInExternalEditor,
  type GitBlameInfo,
} from '@/services/native'
import { isLockfile, LAYER_META } from '@/services/readingOrder'
import { altKeyLabel, altKeyName, formatShortcut, isModKey } from '@/services/shortcuts'
import { buildSplitDiffRows, type SplitDiffRow } from '@/services/splitDiff'
import { buildGitHubPermalink } from '@/services/suggestions'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'
import type { DiffSide, DraftComment, ReviewThread, TourStep } from '@/types/pr'
import CodeHoverPopover from './CodeHoverPopover.vue'
import CommentComposer from './CommentComposer.vue'
import DiffSearchPalette from './DiffSearchPalette.vue'
import FileCommitsBar from './FileCommitsBar.vue'
import ImageDiffViewer from './ImageDiffViewer.vue'
import MarkdownContent from './MarkdownContent.vue'
import MarkdownDiffPreview from './MarkdownDiffPreview.vue'
import ReferencedContextCard from './ReferencedContextCard.vue'
import ReviewThreadCard from './ReviewThreadCard.vue'

const props = defineProps<{
  step: TourStep
}>()

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()
const modF = formatShortcut('Mod+F')
const altLabel = altKeyLabel()
const altName = altKeyName()

const expandedGaps = ref<Set<string>>(new Set())
const isGeneratedExpanded = ref(false)
const showSvgSource = ref(false)
const showMarkdownPreview = ref(false)
const showMarkdownChanges = ref(true)
const activePreviewComposer = ref<{
  blockId: string
  line: number
  side: DiffSide
} | null>(null)
const flashPreviewBlockId = ref<string | null>(null)
let flashPreviewTimer: ReturnType<typeof setTimeout> | null = null
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

// File-level (not line-anchored) comment composer
const fileComposerOpen = ref(false)

// Pending draft currently being edited in place, and any error from saving it
const editingDraftId = ref<string | null>(null)
const draftEditError = ref<string | null>(null)

// Draft briefly highlighted after jumping to it from the Finish Review modal
const flashDraftId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

// Drag-to-select multiline comment state
const isDraggingSelection = ref(false)
const dragAnchorKey = ref<string | null>(null)
const dragFocusKey = ref<string | null>(null)

// Hover context & UX guardrails state
const activeScopes = ref<string[]>([])
const activeReplacedCount = ref(0)
const activeLineNumber = ref<number | null>(null)
const copiedState = ref<'path' | 'permalink' | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

// Compact sticky step header state
const stepHeaderRef = ref<HTMLElement | null>(null)
const compactHeaderRef = ref<HTMLElement | null>(null)
const isHeaderScrolledOut = ref(false)
const compactHeaderHeight = ref(0)
let headerScrollEl: HTMLElement | null = null
let compactHeaderResizeObserver: ResizeObserver | null = null
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

/** Line (in this file) of the "Used in" popover entry under the pointer. */
const hoveredUsageLine = ref<number | null>(null)

function handleUsageHover(usage: SymbolUsage | null) {
  hoveredUsageLine.value = usage && usage.path === props.step.file.path ? usage.line : null
}

watch(hoverState, (state) => {
  if (!state) hoveredUsageLine.value = null
})

/** Usage line numbers refer to head content, or base content for deleted files. */
function isHoveredUsageLine(line: { newLineNumber?: number | null; oldLineNumber?: number | null }) {
  const target = hoveredUsageLine.value
  if (target === null) return false
  return props.step.file.headContent != null
    ? line.newLineNumber === target
    : line.oldLineNumber === target
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
    activePreviewComposer.value = null
    flashPreviewBlockId.value = null
    fileComposerOpen.value = false
    activeScopes.value = []
    activeReplacedCount.value = 0
    activeLineNumber.value = null
    copiedState.value = null
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

const hoverableSymbols = computed<HoverableSymbols>(() => {
  const index = symbolIndex.value
  const currentPath = props.step.file.path
  if (!review.currentRepoPath || !isTauriRuntime()) {
    return createHoverableSymbols({ index, currentPath })
  }

  const content = props.step.file.headContent ?? props.step.file.baseContent
  const repoNames = new Set(extractImportedSymbolNames(content))
  // C# `using` imports namespaces, so any type declared anywhere in the repo may be in scope.
  const csharpTypes = csharpTypeIndex.value
  if (csharpTypes) {
    for (const name of csharpTypes.keys()) repoNames.add(name)
  }
  return createHoverableSymbols({ index, currentPath, repoNames })
})


const segments = computed(() =>
  buildDiffSegments(props.step.file, {
    ignoreWhitespace: review.ignoreWhitespace,
    movedCode: review.movedCodeIndex,
  }),
)

const markdownDiffBlocks = computed<MarkdownDiffBlock[]>(() => {
  if (!canPreviewMarkdown.value) return []
  return buildMarkdownDiffBlocks({
    baseContent: props.step.file.baseContent,
    headContent: props.step.file.headContent,
    status: props.step.file.status,
    segments: segments.value,
    repoContext: review.pr ? { owner: review.pr.owner, repo: review.pr.repo } : undefined,
  })
})

const gapSegments = computed(() => segments.value.filter((seg) => seg.kind === 'gap'))

const allGapsExpanded = computed(
  () =>
    gapSegments.value.length > 0 &&
    gapSegments.value.every((seg) => expandedGaps.value.has(seg.id)),
)

function toggleViewFullFile() {
  if (allGapsExpanded.value) {
    expandedGaps.value = new Set()
  } else {
    expandedGaps.value = new Set(gapSegments.value.map((seg) => seg.id))
  }
}

const splitRowsBySegmentId = computed(() => {
  const map = new Map<string, SplitDiffRow[]>()
  if (settings.diffViewMode !== 'split') return map
  for (const seg of segments.value) {
    map.set(seg.id, buildSplitDiffRows(seg.lines))
  }
  return map
})

// ── Split-view synchronized horizontal scroll ───────────────────────────────
// Each split row is its own `grid-cols-2` so left/right lines stay vertically
// aligned across wrapped lines and full-width comment cards. Instead of giving
// every `<pre>` its own scrollbar, `<pre>` uses `overflow-x-hidden` and all
// lines on each side share one synchronized `scrollLeft` driven by a single
// sticky-bottom scrollbar per side and horizontal wheel/trackpad gestures.
const splitLeftTrackRef = ref<HTMLElement | null>(null)
const splitRightTrackRef = ref<HTMLElement | null>(null)
const splitScrollWidth = ref({ left: 0, right: 0 })
const splitScrollLeft = ref({ left: 0, right: 0 })
let splitResizeObserver: ResizeObserver | null = null

function syncSplitSideScroll(side: 'left' | 'right', scrollLeft: number) {
  splitScrollLeft.value[side] = scrollLeft
  const pres = diffSurfaceRef.value?.querySelectorAll<HTMLPreElement>(
    `pre[data-split-side="${side}"]`,
  )
  if (!pres) return
  for (const pre of pres) {
    if (pre.scrollLeft !== scrollLeft) {
      pre.scrollLeft = scrollLeft
    }
  }
}

function handleSplitTrackScroll(side: 'left' | 'right') {
  const track = side === 'left' ? splitLeftTrackRef.value : splitRightTrackRef.value
  if (!track) return
  syncSplitSideScroll(side, track.scrollLeft)
}

function handleSplitCellWheel(event: WheelEvent, side: 'left' | 'right') {
  if (settings.diffViewMode !== 'split' || settings.wrapLines) return
  const dx =
    event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX
  if (dx === 0 || (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))) {
    return
  }
  const track = side === 'left' ? splitLeftTrackRef.value : splitRightTrackRef.value
  if (!track || track.scrollWidth <= track.clientWidth) return

  event.preventDefault()
  const maxScroll = track.scrollWidth - track.clientWidth
  const nextLeft = Math.max(0, Math.min(maxScroll, track.scrollLeft + dx))
  if (track.scrollLeft !== nextLeft) {
    track.scrollLeft = nextLeft
  }
  syncSplitSideScroll(side, nextLeft)
}

function measureSplitOverflow() {
  if (settings.diffViewMode !== 'split' || settings.wrapLines || !diffSurfaceRef.value) {
    splitScrollWidth.value = { left: 0, right: 0 }
    splitScrollLeft.value = { left: 0, right: 0 }
    return
  }

  const nextWidths = { left: 0, right: 0 }
  for (const side of ['left', 'right'] as const) {
    const pres = diffSurfaceRef.value.querySelectorAll<HTMLPreElement>(
      `pre[data-split-side="${side}"]`,
    )
    let maxScrollWidth = 0
    let clientWidth = 0
    for (const pre of pres) {
      if (pre.clientWidth > 0) clientWidth = pre.clientWidth
      if (pre.scrollWidth > maxScrollWidth) maxScrollWidth = pre.scrollWidth
    }
    const overflows = clientWidth > 0 && maxScrollWidth > clientWidth + 1
    nextWidths[side] = overflows ? maxScrollWidth : 0
    const clamped = overflows
      ? Math.min(splitScrollLeft.value[side], maxScrollWidth - clientWidth)
      : 0
    syncSplitSideScroll(side, clamped)
  }

  splitScrollWidth.value = nextWidths
  void nextTick(() => {
    if (splitLeftTrackRef.value) {
      splitLeftTrackRef.value.scrollLeft = splitScrollLeft.value.left
    }
    if (splitRightTrackRef.value) {
      splitRightTrackRef.value.scrollLeft = splitScrollLeft.value.right
    }
  })
}

// ── Find-in-file palette ────────────────────────────────────────────────────
// Searches every line of the file (collapsed gaps included). Opening it never
// moves the page: the first match is the one nearest the reader's position,
// and the diff only scrolls when the active match is off-screen.
const diffSurfaceRef = ref<HTMLElement | null>(null)
const unifiedScrollRef = ref<HTMLElement | null>(null)
const searchPaletteRef = ref<InstanceType<typeof DiffSearchPalette> | null>(null)
const searchOpen = ref(false)
const searchQuery = ref('')
const activeMatchIdx = ref(0)
const lingerMatchKey = ref<string | null>(null)
let lingerTimer: ReturnType<typeof setTimeout> | null = null

interface SearchSession {
  scroller: HTMLElement
  scrollTop: number
  anchorLineIdx: number
  expandedGaps: Set<string>
  generatedExpanded: boolean
  markdownPreview: boolean
  svgSource: boolean
}
let searchSession: SearchSession | null = null

const allDiffLines = computed<DiffLine[]>(() => segments.value.flatMap((seg) => seg.lines))

const lineIndexByKey = computed(() => {
  const map = new Map<string, number>()
  allDiffLines.value.forEach((line, idx) => map.set(line.key, idx))
  return map
})

const gapIdByLineKey = computed(() => {
  const map = new Map<string, string>()
  for (const seg of segments.value) {
    if (seg.kind !== 'gap') continue
    for (const line of seg.lines) map.set(line.key, seg.id)
  }
  return map
})

const searchMatches = computed(() =>
  searchOpen.value ? findDiffMatches(allDiffLines.value, searchQuery.value) : [],
)
const searchMatchSet = computed(() => new Set(searchMatches.value.map((m) => m.line.key)))
const activeMatchKey = computed(
  () => searchMatches.value[activeMatchIdx.value]?.line.key ?? lingerMatchKey.value,
)

function getScrollParent(el: HTMLElement | null): HTMLElement {
  let node = el?.parentElement ?? null
  while (node) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement
}

function scrollerBounds(scroller: HTMLElement) {
  if (scroller === document.scrollingElement) return { top: 0, bottom: window.innerHeight }
  const rect = scroller.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom }
}

function findLineRow(key: string): HTMLElement | null {
  return (
    diffSurfaceRef.value?.querySelector<HTMLElement>(`[data-diff-line-key="${CSS.escape(key)}"]`) ??
    null
  )
}

/** Index (in display order) of the first line row visible at the top of the viewport. */
function findAnchorLineIdx(scroller: HTMLElement): number {
  const rows = diffSurfaceRef.value?.querySelectorAll<HTMLElement>('[data-diff-line-key]') ?? []
  const { top } = scrollerBounds(scroller)
  for (const row of rows) {
    if (row.getBoundingClientRect().bottom > top) {
      return lineIndexByKey.value.get(row.dataset.diffLineKey ?? '') ?? 0
    }
  }
  // Scrolled past every row (or nothing rendered): wrap to the start.
  return rows.length > 0 ? Number.POSITIVE_INFINITY : 0
}

/** Switch views / unfold the gap needed for a line to be rendered as a diff row. */
function ensureLineRendered(key: string) {
  if (isCollapsedGenerated.value) isGeneratedExpanded.value = true
  if (showMarkdownPreview.value) showMarkdownPreview.value = false
  if (isSvgFile.value && !showSvgSource.value) showSvgSource.value = true
  const gapId = gapIdByLineKey.value.get(key)
  if (gapId && !expandedGaps.value.has(gapId)) {
    expandedGaps.value = new Set([...expandedGaps.value, gapId])
  }
}

async function revealActiveMatch() {
  const key = activeMatchKey.value
  if (!key || !searchSession) return
  ensureLineRendered(key)
  await nextTick()
  const row = findLineRow(key)
  if (!row) return
  const bounds = scrollerBounds(searchSession.scroller)
  const paletteBottom =
    document.querySelector('[data-diff-search-palette]')?.getBoundingClientRect().bottom ?? bounds.top
  let visibleTop = Math.max(bounds.top, paletteBottom) + 12
  let visibleBottom = bounds.bottom - 12
  if (visibleBottom - visibleTop < 60) {
    visibleTop = bounds.top
    visibleBottom = bounds.bottom
  }
  const rect = row.getBoundingClientRect()
  const delta = computeCenteredRevealDelta({
    itemTop: rect.top,
    itemBottom: rect.bottom,
    visibleTop,
    visibleBottom,
  })
  if (delta !== 0) searchSession.scroller.scrollBy({ top: delta, behavior: 'smooth' })

  if (!settings.wrapLines) {
    const matchEl = row.querySelector<HTMLElement>('[data-search-match]')
    if (matchEl) {
      const matchRect = matchEl.getBoundingClientRect()
      const pre = row.querySelector<HTMLPreElement>('pre[data-split-side]')
      if (pre) {
        const side = pre.dataset.splitSide as 'left' | 'right'
        const preRect = pre.getBoundingClientRect()
        const dx = computeCenteredRevealDelta({
          itemTop: matchRect.left,
          itemBottom: matchRect.right,
          visibleTop: preRect.left + 12,
          visibleBottom: preRect.right - 12,
        })
        if (dx !== 0 && pre.scrollWidth > pre.clientWidth) {
          const nextLeft = Math.max(0, Math.min(pre.scrollWidth - pre.clientWidth, pre.scrollLeft + dx))
          const track = side === 'left' ? splitLeftTrackRef.value : splitRightTrackRef.value
          if (track) track.scrollLeft = nextLeft
          syncSplitSideScroll(side, nextLeft)
        }
      } else if (unifiedScrollRef.value) {
        const scrollerRect = unifiedScrollRef.value.getBoundingClientRect()
        const dx = computeCenteredRevealDelta({
          itemTop: matchRect.left,
          itemBottom: matchRect.right,
          visibleTop: scrollerRect.left + 16,
          visibleBottom: scrollerRect.right - 16,
        })
        if (dx !== 0) unifiedScrollRef.value.scrollBy({ left: dx, behavior: 'smooth' })
      }
    }
  }
}

watch(searchMatches, (matches) => {
  if (!searchSession || matches.length === 0) {
    activeMatchIdx.value = 0
    return
  }
  activeMatchIdx.value = pickStartMatchIndex(
    matches.map((m) => lineIndexByKey.value.get(m.line.key) ?? 0),
    searchSession.anchorLineIdx,
  )
})

watch(activeMatchKey, (key) => {
  if (searchOpen.value && key) void revealActiveMatch()
})

function selectedTextInDiff(): string {
  const sel = window.getSelection()
  const text = sel?.toString().trim() ?? ''
  if (!text || text.includes('\n') || text.length > 200) return ''
  const anchor = sel?.anchorNode ?? null
  return anchor && diffSurfaceRef.value?.contains(anchor) ? text : ''
}

function openDiffSearch() {
  if (searchOpen.value) {
    searchPaletteRef.value?.focusInput()
    return
  }
  const prefill = selectedTextInDiff()
  if (prefill) searchQuery.value = prefill

  const scroller = getScrollParent(diffSurfaceRef.value)
  searchSession = {
    scroller,
    scrollTop: scroller.scrollTop,
    anchorLineIdx: findAnchorLineIdx(scroller),
    expandedGaps: new Set(expandedGaps.value),
    generatedExpanded: isGeneratedExpanded.value,
    markdownPreview: showMarkdownPreview.value,
    svgSource: showSvgSource.value,
  }
  if (lingerTimer) clearTimeout(lingerTimer)
  lingerMatchKey.value = null
  searchOpen.value = true
}

/**
 * confirm: stay at the active match (briefly keep it highlighted).
 * dismiss: close where you are.
 * cancel: undo every unfold/view switch and return to the original scroll position.
 */
async function closeDiffSearch(mode: 'confirm' | 'dismiss' | 'cancel') {
  const session = searchSession
  if (!session) return
  const keepKey = mode === 'cancel' ? null : (activeMatchKey.value ?? null)
  const keepGap = keepKey ? gapIdByLineKey.value.get(keepKey) : undefined
  const keepRow = keepKey ? findLineRow(keepKey) : null
  const keepTopBefore = keepRow?.getBoundingClientRect().top ?? null

  searchOpen.value = false
  searchSession = null

  // Fold back the gaps that were only opened to preview other matches.
  const gaps = new Set(session.expandedGaps)
  if (keepGap) gaps.add(keepGap)
  expandedGaps.value = gaps
  if (!keepKey) {
    isGeneratedExpanded.value = session.generatedExpanded
    showMarkdownPreview.value = session.markdownPreview
    showSvgSource.value = session.svgSource
  }

  await nextTick()
  if (mode === 'cancel') {
    session.scroller.scrollTo({ top: session.scrollTop })
    return
  }
  // Collapsing gaps above the kept match shifts it; compensate so it stays put.
  if (keepKey && keepTopBefore !== null) {
    const keepTopAfter = findLineRow(keepKey)?.getBoundingClientRect().top
    if (keepTopAfter !== undefined && keepTopAfter !== keepTopBefore) {
      session.scroller.scrollBy({ top: keepTopAfter - keepTopBefore })
    }
  }
  if (mode === 'confirm' && keepKey) {
    lingerMatchKey.value = keepKey
    lingerTimer = setTimeout(() => {
      lingerMatchKey.value = null
    }, 1500)
  }
}

function handleDiffKeydown(e: KeyboardEvent) {
  if (isModKey(e) && !e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    openDiffSearch()
  }
}

watch(
  [
    () => settings.diffViewMode,
    () => settings.wrapLines,
    () => settings.codeFontSize,
    () => settings.tabSize,
    () => props.step.file.path,
    () => expandedGaps.value.size,
    isGeneratedExpanded,
    showSvgSource,
    showMarkdownPreview,
  ],
  () => {
    void nextTick(measureSplitOverflow)
  },
)

onMounted(() => {
  window.addEventListener('keydown', handleDiffKeydown)
  if (typeof ResizeObserver !== 'undefined' && diffSurfaceRef.value) {
    splitResizeObserver = new ResizeObserver(() => {
      measureSplitOverflow()
    })
    splitResizeObserver.observe(diffSurfaceRef.value)
  }
  void nextTick(measureSplitOverflow)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleDiffKeydown)
  if (lingerTimer) clearTimeout(lingerTimer)
  if (flashPreviewTimer) clearTimeout(flashPreviewTimer)
  splitResizeObserver?.disconnect()
  splitResizeObserver = null
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

function inlineChangeClass(
  pt: DiffTokenPart | SearchTokenPart,
  lineType: DiffLine['type'],
): string {
  if (!pt.changed || ('searchMatch' in pt && pt.searchMatch)) return ''
  const classes = [lineType === 'add' ? 'bg-diff-add-word' : 'bg-diff-del-word']
  if (pt.changeStart) classes.push('rounded-l-[3px]')
  if (pt.changeEnd) classes.push('rounded-r-[3px]')
  return classes.join(' ')
}

const searchMatchRangesByKey = computed(() => {
  const map = new Map<string, SearchMatchRange[]>()
  const q = searchQuery.value.trim()
  if (!q || (!searchOpen.value && !lingerMatchKey.value)) return map
  if (searchOpen.value) {
    for (const m of searchMatches.value) {
      const ranges = findLineMatchRanges(m.line.content, q)
      if (ranges.length > 0) map.set(m.line.key, ranges)
    }
  } else if (lingerMatchKey.value) {
    const line = allDiffLines.value.find((l) => l.key === lingerMatchKey.value)
    if (line) {
      const ranges = findLineMatchRanges(line.content, q)
      if (ranges.length > 0) map.set(line.key, ranges)
    }
  }
  return map
})

function lineTokenParts(line: DiffLine): readonly (DiffTokenPart | SearchTokenPart)[] {
  const parts = tokenizedByKey.value.get(line.key) ?? []
  const ranges = searchMatchRangesByKey.value.get(line.key)
  if (!ranges || ranges.length === 0) return parts
  return applySearchMatchRanges(parts, ranges)
}

function searchMatchClass(pt: DiffTokenPart | SearchTokenPart, lineKey: string): string {
  if (!('searchMatch' in pt) || !pt.searchMatch) return ''
  const isActive = activeMatchKey.value === lineKey
  const classes = [isActive ? 'bg-terra/30 text-ink' : 'bg-ochre-border text-ink']
  if (pt.matchStart) classes.push('rounded-l-[2px]')
  if (pt.matchEnd) classes.push('rounded-r-[2px]')
  return classes.join(' ')
}

function diffLineSurfaceClass(line: DiffLine): string {
  if (line.moved) return 'border-l-diff-move-border bg-diff-move hover:bg-diff-move-hover'
  if (line.type === 'add') return 'border-l-diff-add-border bg-diff-add hover:bg-diff-add-hover'
  if (line.type === 'del') return 'border-l-diff-del-border bg-diff-del hover:bg-diff-del-hover'
  return 'border-l-transparent hover:bg-diff-hover'
}

function diffLineSignClass(line: DiffLine): string {
  if (line.moved) return 'text-diff-move-text'
  if (line.type === 'add') return 'text-diff-add-text'
  if (line.type === 'del') return 'text-diff-del-text'
  return 'text-code-gutter-text'
}

function movedBadgeLabel(line: DiffLine): string {
  if (!line.moved || (line.type !== 'add' && line.type !== 'del')) return ''
  return formatMovedBadgeLabel(props.step.file.path, line.type, line.moved)
}

function movedBadgeTitle(line: DiffLine): string {
  if (!line.moved) return ''
  const verb = line.type === 'add' ? 'Moved from' : 'Moved to'
  return `${verb} ${line.moved.peerPath}:${line.moved.peerStartLine} (${line.moved.blockLength} lines) — Click to jump`
}

function jumpToMovedPeer(moved: MovedLineInfo): void {
  review.goToFileLine(moved.peerPath, moved.peerStartLine, moved.peerSide)
}

const fileThreads = computed<ReviewThread[]>(() =>
  (review.pr?.threads ?? []).filter(
    (t) => t.path === props.step.file.path && t.subjectType !== 'FILE',
  ),
)

const fileDrafts = computed<DraftComment[]>(() =>
  review.draftComments.filter(
    (d) => d.path === props.step.file.path && d.subjectType !== 'FILE',
  ),
)

/** Threads and drafts that target the file as a whole rather than a line. */
const allFileLevelThreads = computed<ReviewThread[]>(() =>
  (review.pr?.threads ?? []).filter(
    (t) => t.path === props.step.file.path && t.subjectType === 'FILE',
  ),
)

const fileLevelThreads = computed<ReviewThread[]>(() =>
  review.showUnresolvedOnly
    ? allFileLevelThreads.value.filter((t) => !t.isResolved)
    : allFileLevelThreads.value,
)

const totalFileThreadCount = computed(
  () => fileThreads.value.length + allFileLevelThreads.value.length,
)

const resolvedFileThreadCount = computed(
  () =>
    fileThreads.value.filter((t) => t.isResolved).length +
    allFileLevelThreads.value.filter((t) => t.isResolved).length,
)

const fileLevelDrafts = computed<DraftComment[]>(() =>
  review.draftComments.filter(
    (d) => d.path === props.step.file.path && d.subjectType === 'FILE',
  ),
)

const hasFileLevelSection = computed(
  () =>
    fileComposerOpen.value ||
    fileLevelThreads.value.length > 0 ||
    fileLevelDrafts.value.length > 0,
)

function threadsForLine(line: DiffLine): ReviewThread[] {
  return fileThreads.value.filter(
    (t) =>
      t.line === line.commentLine &&
      t.side === line.commentSide &&
      (!review.showUnresolvedOnly || !t.isResolved),
  )
}

function splitRowThreads(row: SplitDiffRow): ReviewThread[] {
  const threads: ReviewThread[] = []
  if (row.left && row.left.type === 'del') {
    threads.push(...threadsForLine(row.left))
  }
  if (row.right) {
    threads.push(...threadsForLine(row.right))
  }
  return threads
}

function splitRowDrafts(row: SplitDiffRow): DraftComment[] {
  const drafts: DraftComment[] = []
  if (row.left && row.left.type === 'del') {
    drafts.push(...draftsForLine(row.left))
  }
  if (row.right) {
    drafts.push(...draftsForLine(row.right))
  }
  return drafts
}

function splitRowActiveComposer(row: SplitDiffRow) {
  if (!activeComposer.value) return null
  if (row.left && row.left.type === 'del' && activeComposer.value.key === row.left.key) {
    return activeComposer.value
  }
  if (row.right && activeComposer.value.key === row.right.key) {
    return activeComposer.value
  }
  return null
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
  activeLineNumber.value = targetLine
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

function handleExpandSnippet(maxLines: number) {
  const state = hoverState.value
  if (!state?.info) return
  hoverState.value = {
    ...state,
    info: {
      ...state.info,
      declaration: expandDeclarationSnippets(
        state.info.declaration,
        maxLines,
        review.pr?.files ?? [],
      ),
    },
  }
}

function handleJumpFromPopover(path: string, line?: number) {
  closePopoverImmediately()
  if (line != null && line > 0) {
    review.goToFileLine(path, line)
  } else {
    review.goToFile(path)
  }
}

function getOriginalLinesForRange(
  line: number,
  side: DiffSide,
  startLine?: number,
): string[] | undefined {
  const content = side === 'LEFT' ? props.step.file.baseContent : props.step.file.headContent
  if (content) {
    const all = content.split('\n')
    const start = Math.max(1, startLine ?? line)
    const end = Math.min(all.length, line)
    if (start <= end) return all.slice(start - 1, end)
  }

  // Fallback to rendered diff lines when full file content is unavailable (e.g. large files)
  if (activeComposer.value && activeComposer.value.line === line && activeComposer.value.side === side) {
    const keys = activeComposer.value.selectedKeys
    const matched = allDiffLines.value.filter((l) => keys.has(l.key)).map((l) => l.content)
    if (matched.length > 0) return matched
  }
  return undefined
}

const editorLabel = computed(() => {
  if (settings.externalEditor === 'custom') return 'Editor'
  switch (settings.externalEditor) {
    case 'cursor':
      return 'Cursor'
    case 'zed':
      return 'Zed'
    default:
      switch (settings.localEditor) {
        case 'cursor':
          return 'Cursor'
        case 'zed':
          return 'Zed'
        default:
          return 'VS Code'
      }
  }
})

function setCopiedFeedback(kind: 'path' | 'permalink') {
  copiedState.value = kind
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedState.value = null
  }, 1500)
}

async function copyFilePath() {
  try {
    await navigator.clipboard.writeText(props.step.file.path)
    setCopiedFeedback('path')
  } catch {
    // Ignore clipboard errors in restricted contexts
  }
}

async function copyPermalink() {
  const pr = review.pr
  if (!pr) return
  const line = activeComposer.value?.line ?? activeLineNumber.value
  const url = buildGitHubPermalink(
    settings.githubHost,
    pr.owner,
    pr.repo,
    pr.headRefOid,
    props.step.file.path,
    line,
  )
  try {
    await navigator.clipboard.writeText(url)
    setCopiedFeedback('permalink')
  } catch {
    // Ignore clipboard errors in restricted contexts
  }
}

async function openInLocalEditor() {
  const repoPath = review.currentRepoPath
  if (!repoPath) return
  const line = activeComposer.value?.line ?? activeLineNumber.value ?? 1
  if (settings.externalEditor === 'custom' && settings.externalEditorCustomCommand.trim()) {
    await openStepInEditor(line)
    return
  }
  const editor =
    settings.externalEditor === 'cursor' || settings.externalEditor === 'zed'
      ? settings.externalEditor
      : settings.localEditor
  await openFileInEditor(repoPath, props.step.file.path, line, editor)
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

function openFileComposer() {
  activeComposer.value = null
  fileComposerOpen.value = true
}

async function handleCreateFileDraft(body: string) {
  await review.addFileDraftComment(props.step.file.path, body)
  fileComposerOpen.value = false
}

function startEditingDraft(id: string) {
  activeComposer.value = null
  fileComposerOpen.value = false
  draftEditError.value = null
  editingDraftId.value = id
}

function cancelEditingDraft() {
  editingDraftId.value = null
  draftEditError.value = null
}

async function handleUpdateDraft(id: string, body: string) {
  draftEditError.value = null
  try {
    await review.updateDraftComment(id, body)
    editingDraftId.value = null
  } catch (err) {
    draftEditError.value = err instanceof Error ? err.message : 'Failed to update pending comment'
  }
}

function findDraftCard(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-draft-id="${CSS.escape(id)}"]`)
}

/**
 * Scrolls to the draft requested via `review.focusDraftComment` once it is
 * rendered. Unfolds the gap / switches views its line needs, and gives up if
 * the loaded diff has no matching line.
 */
async function revealFocusedDraft() {
  const id = review.focusedDraftId
  if (!id) return
  const draft = review.draftComments.find((d) => d.id === id)
  if (!draft || draft.path !== props.step.file.path) return

  if (draft.subjectType !== 'FILE') {
    if (allDiffLines.value.length === 0) return // diff not loaded yet; retry when it is
    const line = allDiffLines.value.find(
      (l) => l.commentLine === draft.line && l.commentSide === draft.side,
    )
    if (!line) {
      review.focusedDraftId = null
      return
    }
    ensureLineRendered(line.key)
  }

  await nextTick()
  const card = findDraftCard(id)
  if (!card || review.focusedDraftId !== id) return
  review.focusedDraftId = null
  card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  flashDraftId.value = id
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashDraftId.value = null
  }, 1600)
}

watch(
  () => [review.focusedDraftId, allDiffLines.value] as const,
  () => void revealFocusedDraft(),
  { immediate: true, flush: 'post' },
)

const flashLineKey = ref<string | null>(null)
let flashLineTimer: ReturnType<typeof setTimeout> | null = null

function openPreviewComment(blockId: string, anchor: MarkdownDiffLineAnchor) {
  fileComposerOpen.value = false
  editingDraftId.value = null
  activePreviewComposer.value = {
    blockId,
    line: anchor.line,
    side: anchor.side,
  }
}

async function handleCreatePreviewDraft(body: string) {
  if (!activePreviewComposer.value) return
  await review.addDraftComment(
    props.step.file.path,
    activePreviewComposer.value.line,
    activePreviewComposer.value.side,
    body,
  )
  activePreviewComposer.value = null
}

async function scrollToSourceLine(targetLine: number, side?: DiffSide): Promise<boolean> {
  if (allDiffLines.value.length === 0) return false

  const line =
    side === 'LEFT'
      ? (allDiffLines.value.find((l) => l.oldLineNumber === targetLine && l.type === 'del') ??
         allDiffLines.value.find((l) => l.oldLineNumber === targetLine) ??
         allDiffLines.value.find((l) => l.newLineNumber === targetLine) ??
         allDiffLines.value.find((l) => l.commentLine === targetLine))
      : side === 'RIGHT'
        ? (allDiffLines.value.find((l) => l.newLineNumber === targetLine && l.type === 'add') ??
           allDiffLines.value.find((l) => l.newLineNumber === targetLine) ??
           allDiffLines.value.find((l) => l.commentLine === targetLine) ??
           allDiffLines.value.find((l) => l.oldLineNumber === targetLine))
        : (allDiffLines.value.find((l) => l.newLineNumber === targetLine) ??
           allDiffLines.value.find((l) => l.commentLine === targetLine) ??
           allDiffLines.value.find((l) => l.oldLineNumber === targetLine))
  if (!line) return false

  ensureLineRendered(line.key)
  await nextTick()
  const row = findLineRow(line.key)
  if (!row) return false
  row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  flashLineKey.value = line.key
  if (flashLineTimer) clearTimeout(flashLineTimer)
  flashLineTimer = setTimeout(() => {
    flashLineKey.value = null
  }, 1800)
  return true
}

async function jumpFromPreviewToSource(anchor: MarkdownDiffLineAnchor) {
  await scrollToSourceLine(anchor.line, anchor.side)
}

async function jumpFromHunkToPreview(seg: DiffSegment) {
  if (!canPreviewMarkdown.value) return
  const changedLines = seg.lines.filter((l) => l.type === 'add' || l.type === 'del')
  const probeLines = changedLines.length > 0 ? changedLines : seg.lines

  showMarkdownPreview.value = true
  showMarkdownChanges.value = true
  await nextTick()

  const match =
    markdownDiffBlocks.value.find((block) => {
      if (block.changeKind === 'unchanged') return false
      return probeLines.some((line) => {
        if (line.type === 'del' && line.oldLineNumber !== null && block.baseRange) {
          return (
            line.oldLineNumber >= block.baseRange.startLine &&
            line.oldLineNumber <= block.baseRange.endLine
          )
        }
        if (line.newLineNumber !== null && block.headRange) {
          return (
            line.newLineNumber >= block.headRange.startLine &&
            line.newLineNumber <= block.headRange.endLine
          )
        }
        return false
      })
    }) ?? markdownDiffBlocks.value.find((b) => b.changeKind !== 'unchanged')

  if (!match) return
  const el = diffSurfaceRef.value?.querySelector<HTMLElement>(
    `[data-md-block-id="${CSS.escape(match.id)}"]`,
  )
  if (!el) return
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  flashPreviewBlockId.value = match.id
  if (flashPreviewTimer) clearTimeout(flashPreviewTimer)
  flashPreviewTimer = setTimeout(() => {
    flashPreviewBlockId.value = null
  }, 1800)
}

async function revealFocusedLine() {
  const target = review.focusedLine
  if (!target || target.path !== props.step.file.path) return
  if (allDiffLines.value.length === 0 || !diffSurfaceRef.value) return

  const revealed = await scrollToSourceLine(target.line, target.side)
  if (!revealed || review.focusedLine?.path !== target.path) {
    if (!revealed) review.focusedLine = null
    return
  }
  review.focusedLine = null
}

watch(
  () => [review.focusedLine, allDiffLines.value] as const,
  () => void revealFocusedLine(),
  { immediate: true, flush: 'post' },
)

const linkedRepoPath = computed(() => {
  if (!review.pr) return null
  return review.repoPaths[`${review.pr.owner}/${review.pr.repo}`] ?? null
})

async function openStepInEditor(line = 1) {
  if (!linkedRepoPath.value) return
  const url = buildExternalEditorUrl(
    settings.externalEditor,
    settings.externalEditorCustomCommand,
    linkedRepoPath.value,
    props.step.file.path,
    line,
  )
  if (url) {
    await openInExternalEditor(url)
  }
}

function updateCompactHeaderHeight() {
  const height = compactHeaderRef.value?.getBoundingClientRect().height ?? 0
  // Subtract 1px so the z-10 sticky toolbar tucks cleanly under the z-20 compact header with no subpixel gap
  compactHeaderHeight.value = height > 1 ? Math.floor(height) - 1 : 0
}

function updateStickyHeaderState() {
  if (!stepHeaderRef.value) return
  const scrollerTop =
    headerScrollEl &&
    headerScrollEl !== document.documentElement &&
    headerScrollEl !== document.body
      ? headerScrollEl.getBoundingClientRect().top
      : 0

  const scrolledOut = stepHeaderRef.value.getBoundingClientRect().bottom <= scrollerTop + 1
  if (isHeaderScrolledOut.value !== scrolledOut) {
    isHeaderScrolledOut.value = scrolledOut
    if (scrolledOut) {
      nextTick(updateCompactHeaderHeight)
    }
  }
}

onMounted(() => {
  if (stepHeaderRef.value) {
    headerScrollEl = getScrollParent(stepHeaderRef.value)
    headerScrollEl.addEventListener('scroll', updateStickyHeaderState, { passive: true })
    updateStickyHeaderState()
  }

  if (typeof ResizeObserver !== 'undefined' && compactHeaderRef.value) {
    compactHeaderResizeObserver = new ResizeObserver(() => {
      updateCompactHeaderHeight()
      updateStickyHeaderState()
    })
    compactHeaderResizeObserver.observe(compactHeaderRef.value)
  }

  void revealFocusedLine()
})

onBeforeUnmount(() => {
  if (flashTimer) clearTimeout(flashTimer)
  if (flashLineTimer) clearTimeout(flashLineTimer)
  if (copiedTimer) clearTimeout(copiedTimer)
  headerScrollEl?.removeEventListener('scroll', updateStickyHeaderState)
  compactHeaderResizeObserver?.disconnect()
})

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
    <!-- Compact Sticky Step Header (appears when full Step Header scrolls out of view) -->
    <div class="sticky top-0 z-20 h-0 overflow-visible">
      <div
        v-show="isHeaderScrolledOut"
        ref="compactHeaderRef"
        class="-mx-5 bg-canvas px-5 pt-2 pb-1.5"
      >
        <div
          class="stroll-card flex flex-nowrap items-center justify-between gap-3 rounded-xl border border-border bg-canvas-subtle/95 px-3.5 py-1.5 shadow-sm"
        >
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span
              v-if="isGeneratedStep"
              class="shrink-0 rounded-md border border-border bg-canvas-elevated px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-muted"
            >
              {{ isLockfile(step.file.path) ? 'LOCKFILE' : 'GENERATED' }}
            </span>
            <span
              v-else
              class="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold"
              :class="LAYER_META[step.layer].badgeClass"
            >
              {{ LAYER_META[step.layer].shortLabel }}
            </span>
            <span
              class="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase"
              :class="statusBadgeClass(step.file.status)"
            >
              {{ step.file.status }}
            </span>
            <span class="truncate font-mono text-xs font-semibold text-ink" :title="step.file.path">
              {{ step.file.path }}
            </span>
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
              title="Copy file path"
              @click="copyFilePath"
            >
              <Check v-if="copiedState === 'path'" class="h-3 w-3 text-pine-text" />
              <Copy v-else class="h-3 w-3" />
            </button>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <div class="hidden font-mono text-[11px] sm:block">
              <span class="text-diff-add-text">+{{ step.file.additions }}</span>
              <span class="mx-1 text-ink-faint">/</span>
              <span class="text-diff-del-text">-{{ step.file.deletions }}</span>
            </div>

            <div
              class="inline-flex rounded-lg border border-border bg-canvas p-0.5 text-[10.5px]"
              role="group"
              aria-label="Diff layout"
            >
              <button
                type="button"
                title="Unified diff"
                class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors"
                :class="
                  settings.diffViewMode === 'unified'
                    ? 'bg-terra font-semibold text-white'
                    : 'text-ink-muted hover:text-ink'
                "
                @click="settings.setDiffViewMode('unified')"
              >
                <Rows2 class="h-3 w-3" />
              </button>
              <button
                type="button"
                title="Side-by-side split diff"
                class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors"
                :class="
                  settings.diffViewMode === 'split'
                    ? 'bg-terra font-semibold text-white'
                    : 'text-ink-muted hover:text-ink'
                "
                @click="settings.setDiffViewMode('split')"
              >
                <Columns2 class="h-3 w-3" />
              </button>
            </div>

            <button
              type="button"
              :title="
                review.isStepReviewed(step.file.path)
                  ? 'Mark as unreviewed (M)'
                  : 'Mark as reviewed (M)'
              "
              class="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors"
              :class="
                review.isStepReviewed(step.file.path)
                  ? 'border-pine-border bg-pine-soft text-pine-text'
                  : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated'
              "
              @click="review.toggleReviewed(step.file.path)"
            >
              <CheckCircle2 class="h-3 w-3" />
              <span>{{ review.isStepReviewed(step.file.path) ? 'Reviewed' : 'Mark Reviewed' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Step Header -->
    <div
      ref="stepHeaderRef"
      class="stroll-card !mt-0 rounded-2xl border border-border bg-canvas-subtle p-4"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1 basis-80 space-y-1">
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
            <h1 class="truncate font-mono text-sm font-semibold text-ink" :title="step.file.path">
              {{ step.file.path }}
            </h1>
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
              title="Copy file path"
              @click="copyFilePath"
            >
              <Check v-if="copiedState === 'path'" class="h-3 w-3 text-pine-text" />
              <Copy v-else class="h-3 w-3" />
              <span v-if="copiedState === 'path'" class="text-pine-text">Copied</span>
            </button>
            <button
              v-if="review.pr"
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
              :title="
                activeLineNumber
                  ? `Copy GitHub permalink (line ${activeLineNumber})`
                  : 'Copy GitHub file permalink'
              "
              @click="copyPermalink"
            >
              <Check v-if="copiedState === 'permalink'" class="h-3 w-3 text-pine-text" />
              <Link2 v-else class="h-3 w-3" />
              <span v-if="copiedState === 'permalink'" class="text-pine-text">Copied</span>
            </button>
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

          <FileCommitsBar :path="step.file.path" :step-index="step.stepIndex" />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="font-mono text-xs">
            <span class="text-diff-add-text">+{{ step.file.additions }}</span>
            <span class="mx-1 text-ink-faint">/</span>
            <span class="text-diff-del-text">-{{ step.file.deletions }}</span>
          </div>

          <div
            class="inline-flex rounded-lg border border-border bg-canvas p-0.5 text-[11px]"
            role="group"
            aria-label="Diff layout"
          >
            <button
              type="button"
              title="Unified diff"
              class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors"
              :class="
                settings.diffViewMode === 'unified'
                  ? 'bg-terra font-semibold text-white'
                  : 'text-ink-muted hover:text-ink'
              "
              @click="settings.setDiffViewMode('unified')"
            >
              <Rows2 class="h-3 w-3" />
              <span class="hidden md:inline">Unified</span>
            </button>
            <button
              type="button"
              title="Side-by-side split diff"
              class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors"
              :class="
                settings.diffViewMode === 'split'
                  ? 'bg-terra font-semibold text-white'
                  : 'text-ink-muted hover:text-ink'
              "
              @click="settings.setDiffViewMode('split')"
            >
              <Columns2 class="h-3 w-3" />
              <span class="hidden md:inline">Split</span>
            </button>
          </div>

          <button
            v-if="review.currentRepoPath"
            type="button"
            :title="`Open in ${editorLabel}${activeLineNumber ? ` at line ${activeLineNumber}` : ''}`"
            class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            @click="openInLocalEditor"
          >
            <ExternalLink class="h-3 w-3" />
            <span class="hidden lg:inline">{{ editorLabel }}</span>
          </button>

          <button
            type="button"
            :title="`Find in file (${modF})`"
            data-diff-search-toggle
            class="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              searchOpen
                ? 'border-terra-border bg-terra-soft text-terra-text'
                : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="searchOpen ? closeDiffSearch('dismiss') : openDiffSearch()"
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
            type="button"
            title="Comment on this file as a whole"
            class="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors"
            :class="
              fileComposerOpen
                ? 'border-terra-border bg-terra-soft text-terra-text'
                : 'border-border bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="fileComposerOpen ? (fileComposerOpen = false) : openFileComposer()"
          >
            <MessageSquarePlus class="h-3 w-3" />
            <span class="hidden sm:inline">File comment</span>
          </button>

          <button
            type="button"
            :title="
              review.isStepReviewed(step.file.path)
                ? 'Mark as unreviewed (M)'
                : 'Mark as reviewed (M)'
            "
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

    <!-- Tour Complete Wrap-Up Banner -->
    <div
      v-if="review.showTourCompleteBanner"
      role="status"
      data-testid="tour-complete-banner"
      class="stroll-card animate-pop-in flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-pine-border bg-pine-soft/75 px-4 py-3"
    >
      <div class="flex min-w-0 items-center gap-3">
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-pine/15 text-pine-text"
        >
          <Sparkles class="h-4 w-4" />
        </div>
        <div class="min-w-0">
          <p class="text-xs font-semibold text-ink">
            You've walked through every file — ready to finish your review?
          </p>
          <p class="text-[11px] text-pine-text">
            All {{ review.tourSteps.length }}
            {{ review.tourSteps.length === 1 ? 'file' : 'files' }} reviewed
            <template v-if="review.draftComments.length > 0">
              · {{ review.draftComments.length }} pending
              {{ review.draftComments.length === 1 ? 'draft' : 'drafts' }}
            </template>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-xl bg-pine px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-pine-hover active:scale-[0.98]"
          title="Finish & Submit Review (R)"
          @click="review.openFinishReview()"
        >
          <Send class="h-3.5 w-3.5" />
          <span>Finish Review</span>
          <kbd
            class="rounded border border-white/25 bg-white/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-white"
          >
            R
          </kbd>
        </button>
        <button
          type="button"
          class="rounded-lg p-1.5 text-pine-text/70 transition-colors hover:bg-pine/10 hover:text-pine-text"
          title="Dismiss"
          aria-label="Dismiss tour complete banner"
          @click="review.dismissTourCompleteBanner()"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Referenced PR Context Cards -->
    <div v-if="step.referencedContexts.length > 0" class="space-y-2">
      <ReferencedContextCard
        v-for="ctx in step.referencedContexts"
        :key="ctx.sourcePath"
        :context="ctx"
        @jump-to-file="(p, line) => (line ? review.goToFileLine(p, line) : review.goToFile(p))"
      />
    </div>

    <!-- File-level Comments (threads + drafts + composer) -->
    <div
      v-if="hasFileLevelSection"
      class="stroll-card overflow-hidden rounded-2xl border border-border bg-canvas py-1"
      data-testid="file-level-comments"
    >
      <div class="flex items-center gap-1.5 px-4 pt-2 text-[11px] font-medium text-ink-muted">
        <MessageSquare class="h-3 w-3" />
        <span>Comments on this file</span>
      </div>

      <ReviewThreadCard
        v-for="thread in fileLevelThreads"
        :key="thread.id"
        :thread="thread"
      />

      <div v-for="draft in fileLevelDrafts" :key="draft.id" class="py-1.5" :data-draft-id="draft.id">
        <template v-if="editingDraftId === draft.id">
          <CommentComposer
            :line="0"
            side="RIGHT"
            file-level
            :initial-body="draft.body"
            @submit="(body) => handleUpdateDraft(draft.id, body)"
            @cancel="cancelEditingDraft"
          />
          <p v-if="draftEditError" class="mx-3 text-[11px] text-crimson-text">{{ draftEditError }}</p>
        </template>
        <div
          v-else
          class="animate-pop-in mx-3 rounded-xl border border-ochre-border bg-ochre-soft p-3 font-sans transition-shadow"
          :class="flashDraftId === draft.id ? 'ring-2 ring-ochre-text' : ''"
        >
          <div class="flex items-center justify-between text-[11px]">
            <span class="font-semibold text-ochre-text">Pending Draft (File)</span>
            <div class="flex items-center gap-3">
              <button
                class="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                title="Edit draft"
                @click.stop="startEditingDraft(draft.id)"
              >
                <Pencil class="h-3 w-3" />
                <span>Edit</span>
              </button>
              <button
                class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                title="Delete draft"
                @click.stop="review.deleteDraftComment(draft.id)"
              >
                <Trash2 class="h-3 w-3" />
                <span>Discard</span>
              </button>
            </div>
          </div>
          <MarkdownContent :content="draft.body" class="mt-1 text-xs leading-relaxed text-ink" />
        </div>
      </div>

      <CommentComposer
        v-if="fileComposerOpen"
        :line="0"
        side="RIGHT"
        file-level
        @submit="handleCreateFileDraft"
        @cancel="fileComposerOpen = false"
      />

      <button
        v-else
        type="button"
        class="mx-3 my-2 inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-1 text-[11px] text-ink-secondary transition-colors hover:border-terra-border hover:text-terra-text"
        @click="openFileComposer"
      >
        <MessageSquarePlus class="h-3 w-3" />
        <span>Add file comment</span>
      </button>
    </div>

    <!-- Isolated Diff Surface -->
    <!-- Find-in-file palette (teleported, floats over the diff) -->
    <DiffSearchPalette
      ref="searchPaletteRef"
      v-model:query="searchQuery"
      v-model:active-index="activeMatchIdx"
      :open="searchOpen"
      :matches="searchMatches"
      @confirm="closeDiffSearch('confirm')"
      @dismiss="closeDiffSearch('dismiss')"
      @cancel="closeDiffSearch('cancel')"
    />

    <div
      ref="diffSurfaceRef"
      class="relative"
      :class="
        isCollapsedGenerated ||
        isPureRenameFile ||
        showImagePreview ||
        isNonImageBinary ||
        (showMarkdownPreview && canPreviewMarkdown)
          ? 'stroll-card overflow-hidden rounded-2xl border border-border bg-code'
          : ''
      "
    >
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
              (<span class="text-diff-add-text">+{{ step.file.additions }}</span> /
              <span class="text-diff-del-text">-{{ step.file.deletions }}</span>)
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

        <ImageDiffViewer
          :file="step.file"
          :base-src="baseImageSrc"
          :head-src="headImageSrc"
          :is-loading="isLoadingImages"
          :load-error="imageLoadError"
          :base-dims="baseImageDims"
          :head-dims="headImageDims"
          @base-load="handleBaseImageLoad"
          @head-load="handleHeadImageLoad"
        />
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
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              data-toggle-markdown-changes
              class="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] transition-colors"
              :class="
                showMarkdownChanges
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated hover:text-ink'
              "
              :aria-pressed="showMarkdownChanges"
              title="Toggle inline diff highlights in markdown preview"
              @click="showMarkdownChanges = !showMarkdownChanges"
            >
              <FileDiff class="h-3 w-3" />
              <span>Show changes</span>
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-0.5 text-[10.5px] text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="showMarkdownPreview = false"
            >
              <Code2 class="h-3 w-3" />
              <span>View Source Diff</span>
            </button>
          </div>
        </div>

        <div class="bg-canvas p-6">
          <MarkdownDiffPreview
            :blocks="markdownDiffBlocks"
            :plain-source="markdownPreviewSource ?? ''"
            :show-changes="showMarkdownChanges"
            :threads="fileThreads"
            :drafts="fileDrafts"
            :show-unresolved-only="review.showUnresolvedOnly"
            :editing-draft-id="editingDraftId"
            :draft-edit-error="draftEditError"
            :flash-draft-id="flashDraftId"
            :active-composer="activePreviewComposer"
            :flash-block-id="flashPreviewBlockId"
            :get-original-code="getOriginalCodeForRange"
            :get-original-lines="getOriginalLinesForRange"
            @jump-to-source="jumpFromPreviewToSource"
            @open-comment="openPreviewComment"
            @submit-comment="handleCreatePreviewDraft"
            @cancel-comment="activePreviewComposer = null"
            @start-edit-draft="startEditingDraft"
            @update-draft="handleUpdateDraft"
            @cancel-edit-draft="cancelEditingDraft"
            @delete-draft="review.deleteDraftComment"
          />
        </div>
      </template>

      <!-- Standard Textual Diff -->
      <template v-else>
        <!-- Sticky Diff Context Toolbar (Enclosing Scope Breadcrumb + Hover Guardrail Toggle) -->
        <div
          class="sticky z-10 bg-canvas"
          :style="{ top: isHeaderScrolledOut ? `${compactHeaderHeight}px` : '0px' }"
        >
          <div
            class="flex flex-nowrap items-center justify-between gap-2 rounded-t-2xl border border-border bg-canvas-subtle/95 px-3.5 py-1.5 text-[11px] text-ink-muted backdrop-blur-sm"
          >
          <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span class="shrink-0 text-ink-muted">Click or drag line numbers to comment</span>
            <template v-if="activeScopes.length > 0">
              <span class="shrink-0 text-ink-faint">·</span>
              <div class="flex min-w-0 items-center gap-1 overflow-hidden font-mono text-[11px] text-terra-text">
                <template v-for="(sc, idx) in activeScopes" :key="sc">
                  <ChevronRight v-if="idx > 0" class="h-3 w-3 shrink-0 text-ink-faint" />
                  <span class="truncate" :title="sc">{{ sc }}</span>
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

          <div class="flex shrink-0 items-center gap-2">
            <button
              v-if="gapSegments.length > 0"
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] transition-colors"
              :class="
                allGapsExpanded
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated hover:text-ink'
              "
              :aria-pressed="allGapsExpanded"
              @click="toggleViewFullFile"
            >
              <Minimize2 v-if="allGapsExpanded" class="h-3 w-3" />
              <Maximize2 v-else class="h-3 w-3" />
              <span>{{ allGapsExpanded ? 'Hunks only' : 'View full file' }}</span>
            </button>

            <button
              v-if="totalFileThreadCount > 0"
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] transition-colors"
              :class="
                review.showUnresolvedOnly
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated hover:text-ink'
              "
              :aria-pressed="review.showUnresolvedOnly"
              title="Filter inline and file-level threads to show unresolved threads only"
              @click="review.toggleShowUnresolvedOnly()"
            >
              <Filter class="h-3 w-3" />
              <span>
                {{
                  review.showUnresolvedOnly && resolvedFileThreadCount > 0
                    ? `Unresolved only (${resolvedFileThreadCount} hidden)`
                    : 'Unresolved only'
                }}
              </span>
            </button>

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
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] transition-colors"
              :class="
                !settings.requireAltForHover
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated'
              "
              :aria-pressed="!settings.requireAltForHover"
              :title="`Toggle whether symbol hover popovers open automatically (250ms delay) or only when holding ${altName}`"
              @click="settings.setRequireAltForHover(!settings.requireAltForHover)"
            >
              <Sparkles class="h-3 w-3" />
              <span>{{ settings.requireAltForHover ? `Hover: ${altLabel} + Hover` : 'Hover: Auto' }}</span>
            </button>

            <button
              class="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10.5px] transition-colors"
              :class="
                settings.wrapLines
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border bg-canvas text-ink-secondary hover:bg-canvas-elevated'
              "
              :title="
                settings.wrapLines
                  ? 'Long lines wrap to fit. Click to scroll horizontally instead'
                  : 'Long lines scroll horizontally. Click to wrap them'
              "
              :aria-pressed="settings.wrapLines"
              @click="settings.setWrapLines(!settings.wrapLines)"
            >
              <WrapText class="h-3 w-3" />
              <span>{{ settings.wrapLines ? 'Wrap: On' : 'Wrap: Off' }}</span>
            </button>
          </div>
          </div>
        </div>

        <div class="stroll-card overflow-clip rounded-b-2xl border-x border-b border-border bg-code">
        <div v-if="segments.length === 0" class="p-8 text-center text-xs text-ink-muted">
          No textual diff available for this file (binary or empty change).
        </div>

        <div
          v-else
          ref="unifiedScrollRef"
          class="@container font-mono leading-[1.55]"
          :class="[
            settings.wrapLines || settings.diffViewMode === 'split'
              ? 'overflow-x-clip'
              : 'overflow-x-auto',
            { 'select-none': isDraggingSelection },
          ]"
          :style="{ fontSize: `${settings.codeFontSize}px`, tabSize: settings.tabSize }"
        >
          <!--
            Rows share a track as wide as the longest line (never narrower than
            the viewport) so add/del backgrounds extend when scrolling
            horizontally. Cards stay pinned to the visible width (100cqw).
            With line wrapping on, the track is exactly the viewport width and
            long lines soft-wrap within their row instead.
          -->
          <div :class="settings.diffViewMode === 'split' || settings.wrapLines ? 'w-full' : 'w-max min-w-full'">
          <template v-for="seg in segments" :key="seg.id">
          <!-- Collapsed Unchanged Gap -->
          <template v-if="seg.kind === 'gap'">
            <button
              v-if="!expandedGaps.has(seg.id)"
              class="sticky left-0 flex w-[100cqw] items-center gap-2 border-y border-border-muted bg-canvas-subtle px-4 py-1 text-left font-sans text-[11px] text-ink-secondary transition-colors hover:bg-terra-soft hover:text-terra-text"
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
                class="sticky left-0 flex w-[100cqw] items-center justify-between border-y border-border-muted bg-canvas-subtle/80 px-4 py-0.5 font-sans text-[10px] text-ink-muted"
              >
                <span>Expanded unchanged context ({{ seg.lineCount }} lines)</span>
                <button class="hover:text-ink" @click="toggleGap(seg.id)">Collapse</button>
              </div>
              <template v-if="settings.diffViewMode === 'split'">
                <template v-for="row in splitRowsBySegmentId.get(seg.id) ?? []" :key="row.key">
                  <div class="grid grid-cols-2 divide-x divide-border-muted">
                    <div
                      v-for="(cellLine, sideIdx) in [row.left, row.right]"
                      :key="sideIdx"
                      :data-diff-line-key="cellLine?.key"
                      class="group flex min-w-0 items-stretch"
                      :class="
                        cellLine
                          ? [
                              selectedRange.keys.has(cellLine.key)
                                ? selectionRowClass(cellLine.key)
                                : 'hover:bg-diff-hover',
                              flashLineKey === cellLine.key
                                ? 'ring-2 ring-inset ring-terra bg-terra-soft/40'
                                : activeMatchKey === cellLine.key
                                  ? 'ring-1 ring-inset ring-terra bg-terra-soft/30'
                                  : searchMatchSet.has(cellLine.key)
                                    ? 'bg-ochre-soft/20'
                                    : '',
                              isHoveredUsageLine(cellLine)
                                ? 'inset-ring-1 inset-ring-plum-border shadow-[inset_0_0_0_9999px_var(--color-plum-soft)]'
                                : '',
                            ]
                          : 'bg-canvas-subtle/40'
                      "
                      @mouseenter="cellLine && handleLineMouseEnter(cellLine, seg.lines, 0)"
                      @wheel="handleSplitCellWheel($event, sideIdx === 0 ? 'left' : 'right')"
                    >
                      <template v-if="cellLine">
                        <span
                          class="w-11 shrink-0 cursor-pointer select-none border-r border-border-muted px-2 text-right text-[11px] text-code-gutter-text"
                          @mousedown.left="startLineDrag(cellLine)"
                        >
                          {{ sideIdx === 0 ? (cellLine.oldLineNumber ?? '') : (cellLine.newLineNumber ?? '') }}
                        </span>
                        <span
                          class="w-5 shrink-0 cursor-pointer select-none text-center text-code-gutter-text"
                          @mousedown.left="startLineDrag(cellLine)"
                        >
                          <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-terra group-hover:block" />
                        </span>
                        <pre
                          :data-split-side="sideIdx === 0 ? 'left' : 'right'"
                          class="min-w-0 flex-1 pr-3 text-ink"
                          :class="
                            settings.wrapLines
                              ? 'whitespace-pre-wrap [overflow-wrap:anywhere]'
                              : 'overflow-x-hidden whitespace-pre'
                          "
                        ><template
                          v-for="(pt, pIdx) in lineTokenParts(cellLine)"
                          :key="pIdx"
                        ><span
                          v-if="pt.ident"
                          :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined"
                          :class="[pt.className, searchMatchClass(pt, cellLine.key), 'cursor-help hover:underline hover:decoration-terra hover:decoration-dotted']"
                          @mouseenter="handleIdentMouseEnter($event, pt.ident, seg.lines, 0, cellLine)"
                          @mouseleave="handleIdentMouseLeave"
                        >{{ pt.text }}</span><span v-else :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined" :class="[pt.className, searchMatchClass(pt, cellLine.key)]">{{ pt.text }}</span></template></pre>
                      </template>
                    </div>
                  </div>
                  <div
                    v-for="thread in splitRowThreads(row)"
                    :key="thread.id"
                    class="w-full"
                  >
                    <ReviewThreadCard :thread="thread" />
                  </div>
                  <div
                    v-for="draft in splitRowDrafts(row)"
                    :key="draft.id"
                    class="w-full py-1.5"
                    :data-draft-id="draft.id"
                  >
                    <template v-if="editingDraftId === draft.id">
                      <CommentComposer
                        :line="draft.line"
                        :side="draft.side"
                        :start-line="draft.startLine"
                        :start-side="draft.startSide"
                        :original-code="getOriginalCodeForRange(draft.line, draft.side, draft.startLine)"
                        :initial-body="draft.body"
                        @submit="(body) => handleUpdateDraft(draft.id, body)"
                        @cancel="cancelEditingDraft"
                      />
                      <p v-if="draftEditError" class="mx-3 font-sans text-[11px] text-crimson-text">
                        {{ draftEditError }}
                      </p>
                    </template>
                    <div
                      v-else
                      class="animate-pop-in mx-3 rounded-xl border border-ochre-border bg-ochre-soft p-3 font-sans transition-shadow"
                      :class="flashDraftId === draft.id ? 'ring-2 ring-ochre-text' : ''"
                    >
                      <div class="flex items-center justify-between text-[11px]">
                        <span class="font-semibold text-ochre-text">
                          Pending Draft ({{
                            draft.startLine && draft.startLine !== draft.line
                              ? `Lines ${draft.startLine}–${draft.line}`
                              : `Line ${draft.line}`
                          }} · {{ draft.side === 'LEFT' ? 'Base' : 'Head' }})
                        </span>
                        <div class="flex items-center gap-3">
                          <button
                            class="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                            title="Edit draft"
                            @click.stop="startEditingDraft(draft.id)"
                          >
                            <Pencil class="h-3 w-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                            title="Delete draft"
                            @click.stop="review.deleteDraftComment(draft.id)"
                          >
                            <Trash2 class="h-3 w-3" />
                            <span>Discard</span>
                          </button>
                        </div>
                      </div>
                      <MarkdownContent
                        :content="draft.body"
                        :original-lines="
                          getOriginalLinesForRange(draft.line, draft.side, draft.startLine)
                        "
                        class="mt-1 text-xs leading-relaxed text-ink"
                      />
                    </div>
                  </div>
                  <div
                    v-if="splitRowActiveComposer(row)"
                    class="w-full"
                  >
                    <CommentComposer
                      :line="splitRowActiveComposer(row)!.line"
                      :side="splitRowActiveComposer(row)!.side"
                      :start-line="splitRowActiveComposer(row)!.startLine"
                      :start-side="splitRowActiveComposer(row)!.startSide"
                      :original-code="
                        getOriginalCodeForRange(
                          splitRowActiveComposer(row)!.line,
                          splitRowActiveComposer(row)!.side,
                          splitRowActiveComposer(row)!.startLine,
                        )
                      "
                      @submit="handleCreateDraft"
                      @cancel="activeComposer = null"
                    />
                  </div>
                </template>
              </template>
              <template v-else v-for="(line, lIdx) in seg.lines" :key="line.key">
                <div
                  :data-diff-line-key="line.key"
                  class="group flex items-stretch border-l-2 border-l-transparent"
                  :class="[
                    selectedRange.keys.has(line.key)
                      ? selectionRowClass(line.key)
                      : 'hover:bg-diff-hover',
                    flashLineKey === line.key
                      ? 'ring-2 ring-inset ring-terra bg-terra-soft/40'
                      : activeMatchKey === line.key
                        ? 'ring-1 ring-inset ring-terra bg-terra-soft/30'
                        : searchMatchSet.has(line.key)
                          ? 'bg-ochre-soft/20'
                          : '',
                    isHoveredUsageLine(line)
                      ? 'inset-ring-1 inset-ring-plum-border shadow-[inset_0_0_0_9999px_var(--color-plum-soft)]'
                      : '',
                  ]"
                  @mouseenter="handleLineMouseEnter(line, seg.lines, lIdx)"
                >
                  <span
                    class="w-12 shrink-0 cursor-pointer select-none px-2 text-right text-[11px] text-code-gutter-text"
                    @mousedown.left="startLineDrag(line)"
                  >
                    {{ line.oldLineNumber ?? '' }}
                  </span>
                  <span
                    class="w-12 shrink-0 cursor-pointer select-none border-r border-border-muted px-2 text-right text-[11px] text-code-gutter-text"
                    @mousedown.left="startLineDrag(line)"
                  >
                    {{ line.newLineNumber ?? '' }}
                  </span>
                  <span
                    class="w-6 shrink-0 cursor-pointer select-none text-center text-code-gutter-text"
                    @mousedown.left="startLineDrag(line)"
                  >
                    <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-terra group-hover:block" />
                  </span>
                  <pre
                    class="flex-1 pr-4 text-ink"
                    :class="settings.wrapLines ? 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'"
                  ><template
                    v-for="(pt, pIdx) in lineTokenParts(line)"
                    :key="pIdx"
                  ><span
                    v-if="pt.ident"
                    :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined"
                    :class="[pt.className, searchMatchClass(pt, line.key), 'cursor-help hover:underline hover:decoration-terra hover:decoration-dotted']"
                    @mouseenter="handleIdentMouseEnter($event, pt.ident, seg.lines, lIdx, line)"
                    @mouseleave="handleIdentMouseLeave"
                  >{{ pt.text }}</span><span v-else :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined" :class="[pt.className, searchMatchClass(pt, line.key)]">{{ pt.text }}</span></template></pre>
                </div>

                <!-- Existing GitHub Review Threads -->
                <div
                  v-for="thread in threadsForLine(line)"
                  :key="thread.id"
                  class="sticky left-0 w-[100cqw]"
                >
                  <ReviewThreadCard :thread="thread" />
                </div>

                <!-- Local Pending Draft Comments -->
                <div
                  v-for="draft in draftsForLine(line)"
                  :key="draft.id"
                  class="sticky left-0 w-[100cqw] py-1.5"
                  :data-draft-id="draft.id"
                >
                  <template v-if="editingDraftId === draft.id">
                    <CommentComposer
                      :line="draft.line"
                      :side="draft.side"
                      :start-line="draft.startLine"
                      :start-side="draft.startSide"
                      :original-code="getOriginalCodeForRange(draft.line, draft.side, draft.startLine)"
                      :initial-body="draft.body"
                      @submit="(body) => handleUpdateDraft(draft.id, body)"
                      @cancel="cancelEditingDraft"
                    />
                    <p v-if="draftEditError" class="mx-3 font-sans text-[11px] text-crimson-text">
                      {{ draftEditError }}
                    </p>
                  </template>
                  <div
                    v-else
                    class="animate-pop-in mx-3 rounded-xl border border-ochre-border bg-ochre-soft p-3 font-sans transition-shadow"
                    :class="flashDraftId === draft.id ? 'ring-2 ring-ochre-text' : ''"
                  >
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-semibold text-ochre-text">
                        Pending Draft ({{
                          draft.startLine && draft.startLine !== draft.line
                            ? `Lines ${draft.startLine}–${draft.line}`
                            : `Line ${draft.line}`
                        }} · {{ draft.side === 'LEFT' ? 'Base' : 'Head' }})
                      </span>
                      <div class="flex items-center gap-3">
                        <button
                          class="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                          title="Edit draft"
                          @click.stop="startEditingDraft(draft.id)"
                        >
                          <Pencil class="h-3 w-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                          title="Delete draft"
                          @click.stop="review.deleteDraftComment(draft.id)"
                        >
                          <Trash2 class="h-3 w-3" />
                          <span>Discard</span>
                        </button>
                      </div>
                    </div>
                    <MarkdownContent
                      :content="draft.body"
                      :original-lines="
                        getOriginalLinesForRange(draft.line, draft.side, draft.startLine)
                      "
                      class="mt-1 text-xs leading-relaxed text-ink"
                    />
                  </div>
                </div>

                <!-- Inline Composer -->
                <div
                  v-if="activeComposer?.key === line.key"
                  class="sticky left-0 w-[100cqw]"
                >
                  <CommentComposer
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
                </div>
              </template>
            </template>
          </template>

          <!-- Diff Hunk Block -->
          <template v-else>
            <div
              class="sticky left-0 flex w-[100cqw] items-center justify-between gap-2 border-y border-border-muted bg-sage-soft px-4 py-1 text-[11px] font-medium text-sage-text"
            >
              <span class="truncate">{{ seg.header }}</span>
              <button
                v-if="canPreviewMarkdown"
                type="button"
                data-hunk-jump-preview
                class="inline-flex shrink-0 items-center gap-1 rounded border border-sage-border bg-canvas/90 px-2 py-0.5 font-sans text-[10.5px] font-normal text-sage-text transition-colors hover:bg-canvas hover:text-ink"
                title="Jump to matching section in Markdown preview"
                @click="jumpFromHunkToPreview(seg)"
              >
                <FileText class="h-3 w-3" />
                <span>Jump to preview</span>
              </button>
            </div>

            <template v-if="settings.diffViewMode === 'split'">
              <template v-for="row in splitRowsBySegmentId.get(seg.id) ?? []" :key="row.key">
                <div class="grid grid-cols-2 divide-x divide-border-muted">
                  <div
                    v-for="(cellLine, sideIdx) in [row.left, row.right]"
                    :key="sideIdx"
                    :data-diff-line-key="cellLine?.key"
                    class="group flex min-w-0 items-stretch border-l-2"
                    :class="
                      cellLine
                        ? [
                            selectedRange.keys.has(cellLine.key)
                              ? ['border-l-transparent', selectionRowClass(cellLine.key)]
                              : diffLineSurfaceClass(cellLine),
                            flashLineKey === cellLine.key
                              ? 'ring-2 ring-inset ring-terra bg-terra-soft/40'
                              : activeMatchKey === cellLine.key
                                ? 'ring-1 ring-inset ring-terra bg-terra-soft/30'
                                : searchMatchSet.has(cellLine.key)
                                  ? 'bg-ochre-soft/20'
                                  : '',
                            isHoveredUsageLine(cellLine)
                              ? 'inset-ring-1 inset-ring-plum-border shadow-[inset_0_0_0_9999px_var(--color-plum-soft)]'
                              : '',
                          ]
                        : 'border-l-transparent bg-canvas-subtle/40'
                    "
                    @mouseenter="
                      cellLine &&
                        handleLineMouseEnter(
                          cellLine,
                          seg.lines,
                          seg.lines.indexOf(cellLine),
                        )
                    "
                    @wheel="handleSplitCellWheel($event, sideIdx === 0 ? 'left' : 'right')"
                  >
                    <template v-if="cellLine">
                      <span
                        class="w-11 shrink-0 cursor-pointer select-none border-r border-border-muted px-2 text-right text-[11px] text-code-gutter-text"
                        @mousedown.left="startLineDrag(cellLine)"
                      >
                        {{ sideIdx === 0 ? (cellLine.oldLineNumber ?? '') : (cellLine.newLineNumber ?? '') }}
                      </span>
                      <span
                        class="w-5 shrink-0 cursor-pointer select-none text-center font-bold"
                        :class="diffLineSignClass(cellLine)"
                        @mousedown.left="startLineDrag(cellLine)"
                      >
                        <span class="group-hover:hidden">
                          {{ cellLine.type === 'add' ? '+' : cellLine.type === 'del' ? '-' : ' ' }}
                        </span>
                        <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-terra group-hover:block" />
                      </span>
                      <pre
                        :data-split-side="sideIdx === 0 ? 'left' : 'right'"
                        class="min-w-0 flex-1 pr-3 text-ink"
                        :class="
                          settings.wrapLines
                            ? 'whitespace-pre-wrap [overflow-wrap:anywhere]'
                            : 'overflow-x-hidden whitespace-pre'
                        "
                      ><template
                        v-for="(pt, pIdx) in lineTokenParts(cellLine)"
                        :key="pIdx"
                      ><span
                        v-if="pt.ident"
                        :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined"
                        :class="[
                          pt.className,
                          inlineChangeClass(pt, cellLine.type),
                          searchMatchClass(pt, cellLine.key),
                          'cursor-help hover:underline hover:decoration-terra hover:decoration-dotted',
                        ]"
                        @mouseenter="
                          handleIdentMouseEnter(
                            $event,
                            pt.ident,
                            seg.lines,
                            seg.lines.indexOf(cellLine),
                            cellLine,
                          )
                        "
                        @mouseleave="handleIdentMouseLeave"
                      >{{ pt.text }}</span><span
                        v-else
                        :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined"
                        :class="[
                          pt.className,
                          inlineChangeClass(pt, cellLine.type),
                          searchMatchClass(pt, cellLine.key),
                        ]"
                      >{{ pt.text }}</span></template></pre>
                      <button
                        v-if="cellLine.moved?.isBlockStart && (cellLine.type === 'add' || cellLine.type === 'del')"
                        type="button"
                        :title="movedBadgeTitle(cellLine)"
                        data-moved-badge
                        class="my-0.5 ml-2 mr-2 inline-flex shrink-0 items-center gap-1 self-center rounded-full border border-diff-move-badge-border bg-diff-move-badge-bg px-2 py-0.5 font-sans text-[10px] font-medium text-diff-move-text transition-opacity hover:opacity-85"
                        @click.stop="jumpToMovedPeer(cellLine.moved)"
                      >
                        <ArrowRightLeft class="h-2.5 w-2.5 shrink-0" />
                        <span>{{ movedBadgeLabel(cellLine) }}</span>
                      </button>
                    </template>
                  </div>
                </div>

                <!-- Existing GitHub Review Threads -->
                <div
                  v-for="thread in splitRowThreads(row)"
                  :key="thread.id"
                  class="w-full"
                >
                  <ReviewThreadCard :thread="thread" />
                </div>

                <!-- Local Pending Draft Comments -->
                <div
                  v-for="draft in splitRowDrafts(row)"
                  :key="draft.id"
                  class="w-full py-1.5"
                  :data-draft-id="draft.id"
                >
                  <template v-if="editingDraftId === draft.id">
                    <CommentComposer
                      :line="draft.line"
                      :side="draft.side"
                      :start-line="draft.startLine"
                      :start-side="draft.startSide"
                      :original-code="getOriginalCodeForRange(draft.line, draft.side, draft.startLine)"
                      :initial-body="draft.body"
                      @submit="(body) => handleUpdateDraft(draft.id, body)"
                      @cancel="cancelEditingDraft"
                    />
                    <p v-if="draftEditError" class="mx-3 font-sans text-[11px] text-crimson-text">
                      {{ draftEditError }}
                    </p>
                  </template>
                  <div
                    v-else
                    class="animate-pop-in mx-3 rounded-xl border border-ochre-border bg-ochre-soft p-3 font-sans transition-shadow"
                    :class="flashDraftId === draft.id ? 'ring-2 ring-ochre-text' : ''"
                  >
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="font-semibold text-ochre-text">
                        Pending Draft ({{
                          draft.startLine && draft.startLine !== draft.line
                            ? `Lines ${draft.startLine}–${draft.line}`
                            : `Line ${draft.line}`
                        }} · {{ draft.side === 'LEFT' ? 'Base' : 'Head' }})
                      </span>
                      <div class="flex items-center gap-3">
                        <button
                          class="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                          title="Edit draft"
                          @click.stop="startEditingDraft(draft.id)"
                        >
                          <Pencil class="h-3 w-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                          title="Delete draft"
                          @click.stop="review.deleteDraftComment(draft.id)"
                        >
                          <Trash2 class="h-3 w-3" />
                          <span>Discard</span>
                        </button>
                      </div>
                    </div>
                    <MarkdownContent
                      :content="draft.body"
                      :original-lines="
                        getOriginalLinesForRange(draft.line, draft.side, draft.startLine)
                      "
                      class="mt-1 text-xs leading-relaxed text-ink"
                    />
                  </div>
                </div>

                <!-- Inline Comment Composer -->
                <div
                  v-if="splitRowActiveComposer(row)"
                  class="w-full"
                >
                  <CommentComposer
                    :line="splitRowActiveComposer(row)!.line"
                    :side="splitRowActiveComposer(row)!.side"
                    :start-line="splitRowActiveComposer(row)!.startLine"
                    :start-side="splitRowActiveComposer(row)!.startSide"
                    :original-code="
                      getOriginalCodeForRange(
                        splitRowActiveComposer(row)!.line,
                        splitRowActiveComposer(row)!.side,
                        splitRowActiveComposer(row)!.startLine,
                      )
                    "
                    @submit="handleCreateDraft"
                    @cancel="activeComposer = null"
                  />
                </div>
              </template>
            </template>

            <template v-else v-for="(line, lIdx) in seg.lines" :key="line.key">
              <div
                :data-diff-line-key="line.key"
                class="group flex items-stretch border-l-2"
                :class="[
                  selectedRange.keys.has(line.key)
                    ? ['border-l-transparent', selectionRowClass(line.key)]
                    : diffLineSurfaceClass(line),
                  flashLineKey === line.key
                    ? 'ring-2 ring-inset ring-terra bg-terra-soft/40'
                    : activeMatchKey === line.key
                      ? 'ring-1 ring-inset ring-terra bg-terra-soft/30'
                      : searchMatchSet.has(line.key)
                        ? 'bg-ochre-soft/20'
                        : '',
                  isHoveredUsageLine(line)
                    ? 'inset-ring-1 inset-ring-plum-border shadow-[inset_0_0_0_9999px_var(--color-plum-soft)]'
                    : '',
                ]"
                @mouseenter="handleLineMouseEnter(line, seg.lines, lIdx)"
              >
                <span
                  class="w-12 shrink-0 cursor-pointer select-none px-2 text-right text-[11px] text-code-gutter-text"
                  @mousedown.left="startLineDrag(line)"
                >
                  {{ line.oldLineNumber ?? '' }}
                </span>
                <span
                  class="w-12 shrink-0 cursor-pointer select-none border-r border-border-muted px-2 text-right text-[11px] text-code-gutter-text"
                  @mousedown.left="startLineDrag(line)"
                >
                  {{ line.newLineNumber ?? '' }}
                </span>
                <span
                  class="w-6 shrink-0 cursor-pointer select-none text-center font-bold"
                  :class="diffLineSignClass(line)"
                  @mousedown.left="startLineDrag(line)"
                >
                  <span class="group-hover:hidden">
                    {{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}
                  </span>
                  <MessageSquarePlus class="mx-auto mt-1 hidden h-3 w-3 text-terra group-hover:block" />
                </span>
                <pre
                  class="flex-1 pr-4 text-ink"
                  :class="settings.wrapLines ? 'min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'"
                ><template
                  v-for="(pt, pIdx) in lineTokenParts(line)"
                  :key="pIdx"
                ><span
                  v-if="pt.ident"
                  :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined"
                  :class="[
                    pt.className,
                    inlineChangeClass(pt, line.type),
                    searchMatchClass(pt, line.key),
                    'cursor-help hover:underline hover:decoration-terra hover:decoration-dotted',
                  ]"
                  @mouseenter="handleIdentMouseEnter($event, pt.ident, seg.lines, lIdx, line)"
                  @mouseleave="handleIdentMouseLeave"
                >{{ pt.text }}</span><span
                  v-else
                  :data-search-match="'searchMatch' in pt && pt.searchMatch ? '' : undefined"
                  :class="[
                    pt.className,
                    inlineChangeClass(pt, line.type),
                    searchMatchClass(pt, line.key),
                  ]"
                >{{ pt.text }}</span></template></pre>
                <button
                  v-if="line.moved?.isBlockStart && (line.type === 'add' || line.type === 'del')"
                  type="button"
                  :title="movedBadgeTitle(line)"
                  data-moved-badge
                  class="sticky right-3 my-0.5 ml-3 mr-3 inline-flex shrink-0 items-center gap-1 self-center rounded-full border border-diff-move-badge-border bg-diff-move-badge-bg px-2 py-0.5 font-sans text-[10px] font-medium text-diff-move-text transition-opacity hover:opacity-85"
                  @click.stop="jumpToMovedPeer(line.moved)"
                >
                  <ArrowRightLeft class="h-2.5 w-2.5 shrink-0" />
                  <span>{{ movedBadgeLabel(line) }}</span>
                </button>
              </div>

              <!-- Existing GitHub Review Threads -->
              <div
                v-for="thread in threadsForLine(line)"
                :key="thread.id"
                class="sticky left-0 w-[100cqw]"
              >
                <ReviewThreadCard :thread="thread" />
              </div>

              <!-- Local Pending Draft Comments -->
              <div
                v-for="draft in draftsForLine(line)"
                :key="draft.id"
                class="sticky left-0 w-[100cqw] py-1.5"
                :data-draft-id="draft.id"
              >
              <template v-if="editingDraftId === draft.id">
                <CommentComposer
                  :line="draft.line"
                  :side="draft.side"
                  :start-line="draft.startLine"
                  :start-side="draft.startSide"
                  :original-code="getOriginalCodeForRange(draft.line, draft.side, draft.startLine)"
                  :initial-body="draft.body"
                  @submit="(body) => handleUpdateDraft(draft.id, body)"
                  @cancel="cancelEditingDraft"
                />
                <p v-if="draftEditError" class="mx-3 font-sans text-[11px] text-crimson-text">
                  {{ draftEditError }}
                </p>
              </template>
              <div
                v-else
                class="animate-pop-in mx-3 rounded-xl border border-ochre-border bg-ochre-soft p-3 font-sans transition-shadow"
                :class="flashDraftId === draft.id ? 'ring-2 ring-ochre-text' : ''"
              >
                <div class="flex items-center justify-between text-[11px]">
                  <span class="font-semibold text-ochre-text">
                    Pending Draft ({{
                      draft.startLine && draft.startLine !== draft.line
                        ? `Lines ${draft.startLine}–${draft.line}`
                        : `Line ${draft.line}`
                    }})
                  </span>
                  <div class="flex items-center gap-3">
                    <button
                      class="inline-flex items-center gap-1 text-ink-muted hover:text-ink"
                      title="Edit draft"
                      @click.stop="startEditingDraft(draft.id)"
                    >
                      <Pencil class="h-3 w-3" />
                      <span>Edit</span>
                    </button>
                    <button
                      class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                      title="Delete draft"
                      @click.stop="review.deleteDraftComment(draft.id)"
                    >
                      <Trash2 class="h-3 w-3" />
                      <span>Discard</span>
                    </button>
                  </div>
                </div>
                <MarkdownContent
                  :content="draft.body"
                  :original-lines="
                    getOriginalLinesForRange(draft.line, draft.side, draft.startLine)
                  "
                  class="mt-1 text-xs leading-relaxed text-ink"
                />
              </div>
              </div>

              <!-- Inline Comment Composer -->
              <div
                v-if="activeComposer?.key === line.key"
                class="sticky left-0 w-[100cqw]"
              >
                <CommentComposer
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
              </div>
            </template>
          </template>
        </template>
          </div>
          <div
            v-if="
              settings.diffViewMode === 'split' &&
              !settings.wrapLines &&
              (splitScrollWidth.left > 0 || splitScrollWidth.right > 0)
            "
            data-split-scrollbar-bar
            class="sticky bottom-0 z-10 grid grid-cols-2 divide-x divide-border-muted border-t border-border-muted bg-canvas-subtle/95 backdrop-blur-xs"
          >
            <div class="flex min-w-0 items-center border-l-2 border-l-transparent">
              <div class="w-11 shrink-0 border-r border-border-muted" />
              <div class="w-5 shrink-0" />
              <div
                ref="splitLeftTrackRef"
                data-split-scroll-track="left"
                class="min-w-0 flex-1 overflow-x-auto"
                @scroll="handleSplitTrackScroll('left')"
              >
                <div
                  v-if="splitScrollWidth.left > 0"
                  :style="{ width: `${splitScrollWidth.left}px`, height: '1px' }"
                />
              </div>
            </div>
            <div class="flex min-w-0 items-center border-l-2 border-l-transparent">
              <div class="w-11 shrink-0 border-r border-border-muted" />
              <div class="w-5 shrink-0" />
              <div
                ref="splitRightTrackRef"
                data-split-scroll-track="right"
                class="min-w-0 flex-1 overflow-x-auto"
                @scroll="handleSplitTrackScroll('right')"
              >
                <div
                  v-if="splitScrollWidth.right > 0"
                  :style="{ width: `${splitScrollWidth.right}px`, height: '1px' }"
                />
              </div>
            </div>
          </div>
      </div>
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
      @expand-snippet="handleExpandSnippet"
      @usage-hover="handleUsageHover"
    />
  </div>
</template>
