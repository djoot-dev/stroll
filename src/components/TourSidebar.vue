<script setup lang="ts">
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  FileText,
  GitCommitHorizontal,
  GripVertical,
  Layers,
  Loader2,
  MessageSquare,
  Pin,
  RotateCcw,
  Sparkles,
  X,
} from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isLockfile, LAYER_META } from '@/services/readingOrder'
import type { PRStackCandidate } from '@/services/prStack'
import { computeRemainingReviewEstimate } from '@/services/reviewEstimate'
import { computeRevealScrollTop } from '@/services/scrollReveal'
import { useReviewStore } from '@/stores/review'
import {
  DEFAULT_APP_SETTINGS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSettingsStore,
} from '@/stores/settings'
import type { ArchitecturalLayer, TourStep } from '@/types/pr'

type StepStatusFilter = 'all' | 'unreviewed' | 'commented' | 'unresolved'

const review = useReviewStore()
const settings = useSettingsStore()
const stepListRef = ref<HTMLElement | null>(null)

const statusFilter = ref<StepStatusFilter>('all')
const hideReviewed = ref(false)
const groupByLayer = ref(false)

const prevStackNode = computed(() => {
  const ancestors = review.prStack?.ancestors
  return ancestors?.length ? ancestors[ancestors.length - 1] : null
})
const nextStackNode = computed(() => review.prStack?.descendants[0] ?? null)

function isOpeningStackNode(node: PRStackCandidate): boolean {
  return (
    review.isLoadingPR &&
    review.loadingPRKey === `${node.owner}/${node.repo}#${node.number}`
  )
}
const collapsedLayers = ref<Set<ArchitecturalLayer>>(new Set())
const showHiddenList = ref(false)
const draggedPath = ref<string | null>(null)
const dragOverPath = ref<string | null>(null)

// --- Resizing -------------------------------------------------------------
const isResizing = ref(false)
let dragStartX = 0
let dragStartWidth = 0

function onResizeMove(e: PointerEvent) {
  void settings.setSidebarWidth(dragStartWidth + (e.clientX - dragStartX), { persist: false })
}

function stopResize() {
  if (!isResizing.value) return
  isResizing.value = false
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
  document.body.classList.remove('is-resizing-sidebar')
  void settings.setSidebarWidth(settings.sidebarWidth)
}

function startResize(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  isResizing.value = true
  dragStartX = e.clientX
  dragStartWidth = settings.sidebarWidth
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
  document.body.classList.add('is-resizing-sidebar')
}

function resetWidth() {
  void settings.setSidebarWidth(DEFAULT_APP_SETTINGS.sidebarWidth)
}

function onResizeKey(e: KeyboardEvent) {
  const step = e.shiftKey ? 48 : 16
  if (e.key === 'ArrowLeft') void settings.setSidebarWidth(settings.sidebarWidth - step)
  else if (e.key === 'ArrowRight') void settings.setSidebarWidth(settings.sidebarWidth + step)
  else if (e.key === 'Home') void settings.setSidebarWidth(SIDEBAR_MIN_WIDTH)
  else if (e.key === 'End') void settings.setSidebarWidth(SIDEBAR_MAX_WIDTH)
  else return
  e.preventDefault()
  e.stopPropagation()
}

onBeforeUnmount(stopResize)

/**
 * Scrolls the step list so the active step — plus the step directly above and
 * below it — is visible. Only scrolls as much as needed.
 */
function revealActiveStep(behavior: ScrollBehavior) {
  const container = stepListRef.value
  if (!container || review.activeView !== 'step') return

  const idx = review.currentStepIndex
  const find = (i: number) => container.querySelector<HTMLElement>(`[data-step-index="${i}"]`)
  const active = find(idx)
  if (!active) return

  const containerTop = container.getBoundingClientRect().top - container.scrollTop
  const toContent = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top - containerTop, bottom: rect.bottom - containerTop }
  }

  const activeRect = toContent(active)
  const prev = find(idx - 1)
  const next = find(idx + 1)
  const target = computeRevealScrollTop({
    scrollTop: container.scrollTop,
    viewportHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
    activeTop: activeRect.top,
    activeBottom: activeRect.bottom,
    rangeTop: prev ? toContent(prev).top : undefined,
    rangeBottom: next ? toContent(next).bottom : undefined,
    margin: 8,
  })

  if (Math.abs(target - container.scrollTop) >= 1) {
    container.scrollTo({ top: target, behavior })
  }
}

// Navigating between steps: smooth-scroll the list to follow along.
watch(
  () => [review.currentStepIndex, review.activeView] as const,
  () => revealActiveStep('smooth'),
  { flush: 'post' },
)

// Sidebar (re)mounted or tour order changed: jump straight to the active step.
watch(
  () => [stepListRef.value, review.tourSteps.map((s) => s.file.path).join('\n')] as const,
  () => revealActiveStep('auto'),
  { flush: 'post' },
)

const overviewCommentCount = computed(() => {
  if (!review.pr) return 0
  const reviewBodies = review.pr.reviews.filter(
    (r) => r.state !== 'PENDING' && r.body.trim().length > 0,
  ).length
  return review.pr.issueComments.length + reviewBodies
})

function draftCountForFile(path: string): number {
  const drafts = review.draftComments.filter((d) => d.path === path).length
  const existing = review.pr?.threads.filter((t) => t.path === path).length ?? 0
  return drafts + existing
}

function unresolvedCountForFile(path: string): number {
  return review.pr?.threads.filter((t) => t.path === path && !t.isResolved).length ?? 0
}

const filterCounts = computed(() => {
  let unreviewed = 0
  let commented = 0
  let unresolved = 0
  for (const step of review.tourSteps) {
    if (!review.isStepReviewed(step.file.path)) unreviewed += 1
    if (draftCountForFile(step.file.path) > 0) commented += 1
    if (unresolvedCountForFile(step.file.path) > 0) unresolved += 1
  }
  return { unreviewed, commented, unresolved }
})

const hasGeneratedVisibleSteps = computed(() =>
  review.tourSteps.some((s) => s.isGenerated),
)

const remainingEstimate = computed(() =>
  computeRemainingReviewEstimate(review.tourSteps, review.isStepReviewed),
)

const filteredSteps = computed<TourStep[]>(() => {
  return review.tourSteps.filter((step) => {
    const path = step.file.path
    if (hideReviewed.value && review.isStepReviewed(path)) return false
    if (statusFilter.value === 'unreviewed') return !review.isStepReviewed(path)
    if (statusFilter.value === 'commented') return draftCountForFile(path) > 0
    if (statusFilter.value === 'unresolved') return unresolvedCountForFile(path) > 0
    return true
  })
})

interface LayerGroup {
  layer: ArchitecturalLayer
  label: string
  steps: TourStep[]
  reviewedCount: number
}

const groupedSteps = computed<LayerGroup[]>(() => {
  const groups = new Map<ArchitecturalLayer, TourStep[]>()
  for (const step of filteredSteps.value) {
    const list = groups.get(step.layer) ?? []
    list.push(step)
    groups.set(step.layer, list)
  }
  const result: LayerGroup[] = []
  for (const [layer, steps] of groups.entries()) {
    result.push({
      layer,
      label: LAYER_META[layer].label,
      steps,
      reviewedCount: steps.filter((s) => review.isStepReviewed(s.file.path)).length,
    })
  }
  return result
})

function toggleLayerCollapsed(layer: ArchitecturalLayer) {
  const next = new Set(collapsedLayers.value)
  if (next.has(layer)) next.delete(layer)
  else next.add(layer)
  collapsedLayers.value = next
}

watch(
  () => review.currentStep?.layer,
  (layer) => {
    if (groupByLayer.value && layer && collapsedLayers.value.has(layer)) {
      const next = new Set(collapsedLayers.value)
      next.delete(layer)
      collapsedLayers.value = next
    }
  },
)

function onStepDragStart(e: DragEvent, path: string) {
  if (groupByLayer.value) return
  draggedPath.value = path
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path)
  }
}

function onStepDragOver(e: DragEvent, path: string) {
  if (groupByLayer.value || !draggedPath.value || draggedPath.value === path) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverPath.value = path
}

function onStepDrop(e: DragEvent, targetPath: string) {
  e.preventDefault()
  const sourcePath = draggedPath.value
  draggedPath.value = null
  dragOverPath.value = null
  if (!sourcePath || sourcePath === targetPath || groupByLayer.value) return
  review.reorderStep(sourcePath, targetPath)
}

function onStepDragEnd() {
  draggedPath.value = null
  dragOverPath.value = null
}

function resetSidebarFilters() {
  statusFilter.value = 'all'
  hideReviewed.value = false
}

function fileNameOnly(path: string): string {
  return path.split('/').pop() ?? path
}

function dirOnly(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx > 0 ? path.slice(0, idx) : ''
}
</script>

<template>
  <Transition name="sidebar-slide">
    <aside
      v-if="review.sidebarOpen && review.pr"
      class="@container relative flex shrink-0 flex-col border-r border-border bg-canvas-subtle"
      :style="{ width: `${settings.sidebarWidth}px`, '--sidebar-width': `${settings.sidebarWidth}px` }"
    >
      <!-- Resize handle -->
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tour outline"
        :aria-valuenow="settings.sidebarWidth"
        :aria-valuemin="SIDEBAR_MIN_WIDTH"
        :aria-valuemax="SIDEBAR_MAX_WIDTH"
        tabindex="0"
        title="Drag to resize · double-click to reset"
        class="group/resize absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize outline-none"
        @pointerdown="startResize"
        @dblclick="resetWidth"
        @keydown="onResizeKey"
      >
        <div
          class="mx-auto h-full w-px transition-colors group-hover/resize:bg-terra-text group-focus-visible/resize:bg-terra-text"
          :class="isResizing ? 'bg-terra-text' : 'bg-transparent'"
        />
      </div>

      <!-- PR Summary Header -->
      <div class="border-b border-border p-3.5">
        <h2 class="line-clamp-2 text-xs font-semibold leading-snug text-ink">
          {{ review.pr.title }}
        </h2>
        <div class="mt-2 flex flex-col items-start gap-1 text-[11px] text-ink-muted @[260px]:flex-row @[260px]:items-center @[260px]:justify-between @[260px]:gap-2">
          <span class="shrink-0 whitespace-nowrap">
            {{ review.reviewedCount }} / {{ review.tourSteps.length }} reviewed
          </span>
          <span
            class="w-full truncate font-mono text-[10.5px] text-ink-faint @[260px]:w-auto"
            :title="`${review.pr.headRefName} → ${review.pr.baseRefName}`"
          >
            {{ review.pr.headRefName }} → {{ review.pr.baseRefName }}
          </span>
        </div>
        <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-canvas-elevated">
          <div
            class="h-full rounded-full bg-pine transition-all duration-300"
            :style="{
              width: review.tourSteps.length
                ? `${Math.round((review.reviewedCount / review.tourSteps.length) * 100)}%`
                : '0%',
            }"
          />
        </div>
        <p
          v-if="remainingEstimate"
          data-testid="tour-remaining-estimate"
          class="mt-1.5 flex items-center gap-1.5 text-[11px] leading-snug"
          :class="remainingEstimate.remainingFiles === 0 ? 'text-pine-text' : 'text-ink-muted'"
        >
          <Clock class="h-3 w-3 shrink-0 opacity-80" />
          <span>{{ remainingEstimate.summary }}</span>
        </p>

        <!-- Commit / Scope Filter -->
        <div v-if="review.pr.commits.length > 0" class="mt-2.5 flex items-center gap-1.5">
          <GitCommitHorizontal class="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <select
            aria-label="Filter tour by commit"
            :value="review.commitFilter"
            :disabled="review.isLoadingCommitFilter"
            :aria-busy="review.isLoadingCommitFilter"
            class="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink-secondary focus:border-terra-border focus:outline-none disabled:opacity-50"
            @change="review.setCommitFilter(($event.target as HTMLSelectElement).value)"
          >
            <option value="all">All commits ({{ review.pr.commits.length }})</option>
            <option v-if="review.lastReviewedCommitOid" value="since-last-review">
              Since last review ({{ review.lastReviewedCommitOid.slice(0, 7) }}..{{ review.pr.headRefOid.slice(0, 7) }})
            </option>
            <option
              v-for="commit in review.pr.commits"
              :key="commit.oid"
              :value="commit.oid"
            >
              {{ commit.shortOid }} · {{ commit.messageHeadline }}
            </option>
          </select>
          <Loader2
            v-if="review.isLoadingCommitFilter"
            class="h-3.5 w-3.5 shrink-0 animate-spin text-terra-text"
          />
        </div>
      </div>

      <!-- Pinned Step 0: PR Overview -->
      <div class="border-b border-border-muted px-2.5 py-2">
        <button
          class="group flex w-full flex-col items-start gap-1.5 rounded-xl border px-2.5 py-2 text-left transition-all @[260px]:flex-row @[260px]:items-center @[260px]:justify-between @[260px]:gap-2"
          :class="
            review.activeView === 'overview'
              ? 'stroll-card border-terra-border bg-terra-soft'
              : 'border-transparent hover:border-border-muted hover:bg-canvas-elevated/60'
          "
          title="PR Overview (0 or O)"
          @click="review.openOverview()"
        >
          <div class="flex w-full min-w-0 items-center gap-2.5 @[260px]:w-auto">
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors"
              :class="
                review.activeView === 'overview'
                  ? 'bg-terra text-white shadow-xs'
                  : 'border border-border bg-canvas-subtle text-ink-muted group-hover:border-terra-border group-hover:text-ink'
              "
            >
              <FileText class="h-3 w-3" />
            </span>
            <div class="min-w-0 flex-1">
              <div
                class="truncate text-xs font-semibold"
                :class="review.activeView === 'overview' ? 'text-ink' : 'text-ink-secondary group-hover:text-ink'"
              >
                Overview
              </div>
              <div class="truncate text-[10px] text-ink-faint">
                Description, checks &amp; discussion
              </div>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1.5 pl-[30px] @[260px]:pl-0">
            <span
              v-if="overviewCommentCount > 0"
              class="inline-flex items-center gap-0.5 rounded-md bg-canvas-elevated px-1.5 py-0.2 font-mono text-[10px] text-ink-muted"
            >
              <MessageSquare class="h-2.5 w-2.5" />
              {{ overviewCommentCount }}
            </span>
            <kbd class="rounded border border-border bg-canvas px-1 font-mono text-[9.5px] text-ink-faint">0</kbd>
          </div>
        </button>

        <div
          v-if="review.prStack"
          class="mt-1.5 flex items-center justify-between gap-2 rounded-lg border border-border-muted bg-canvas px-2.5 py-1.5 text-[10.5px] text-ink-muted"
        >
          <span class="truncate" :title="`PR stack ${review.prStack.currentPosition}/${review.prStack.totalCount} (base: ${review.pr?.baseRefName})`">
            Stack <strong class="font-mono text-ink">{{ review.prStack.currentPosition }}/{{ review.prStack.totalCount }}</strong>
            <template v-if="review.prStack.baseIsNotDefault">
              · vs <code class="font-mono text-ink-secondary">{{ review.pr?.baseRefName }}</code>
            </template>
          </span>
          <div class="flex shrink-0 items-center gap-1">
            <button
              v-if="prevStackNode"
              type="button"
              :disabled="review.isLoadingPR"
              :aria-busy="isOpeningStackNode(prevStackNode)"
              :title="`Previous in stack: #${prevStackNode.number}`"
              class="inline-flex items-center gap-1 rounded border border-border bg-canvas-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-secondary transition-colors"
              :class="
                review.isLoadingPR
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:border-terra-border hover:text-terra-text'
              "
              @click="review.openStackPR(prevStackNode)"
            >
              <Loader2 v-if="isOpeningStackNode(prevStackNode)" class="h-2.5 w-2.5 animate-spin" />
              <span>↑ #{{ prevStackNode.number }}</span>
            </button>
            <button
              v-if="nextStackNode"
              type="button"
              :disabled="review.isLoadingPR"
              :aria-busy="isOpeningStackNode(nextStackNode)"
              :title="`Next in stack: #${nextStackNode.number}`"
              class="inline-flex items-center gap-1 rounded border border-border bg-canvas-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-secondary transition-colors"
              :class="
                review.isLoadingPR
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:border-terra-border hover:text-terra-text'
              "
              @click="review.openStackPR(nextStackNode)"
            >
              <Loader2 v-if="isOpeningStackNode(nextStackNode)" class="h-2.5 w-2.5 animate-spin" />
              <span>↓ #{{ nextStackNode.number }}</span>
            </button>
          </div>
        </div>
        <div
          v-if="review.prStack && review.prError"
          role="alert"
          class="mt-1.5 flex items-start justify-between gap-1.5 rounded-lg border border-crimson-border bg-crimson-soft px-2.5 py-1.5 text-[10.5px] text-crimson-text"
        >
          <span class="min-w-0 break-words">{{ review.prError }}</span>
          <button
            type="button"
            class="shrink-0 rounded p-0.5 hover:bg-crimson/10"
            title="Dismiss error"
            aria-label="Dismiss error"
            @click="review.prError = null"
          >
            <X class="h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- Status Filters & Grouping Controls -->
      <div class="space-y-1.5 border-b border-border-muted px-2.5 py-2">
        <div class="flex flex-wrap items-center gap-1">
          <button
            type="button"
            :aria-pressed="statusFilter === 'all' && !hideReviewed"
            class="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors"
            :class="
              statusFilter === 'all' && !hideReviewed
                ? 'bg-terra-soft text-terra-text'
                : 'text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="
              statusFilter = 'all';
              hideReviewed = false
            "
          >
            All
          </button>
          <button
            type="button"
            :aria-pressed="statusFilter === 'unreviewed'"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors"
            :class="
              statusFilter === 'unreviewed'
                ? 'bg-terra-soft text-terra-text'
                : 'text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="statusFilter = statusFilter === 'unreviewed' ? 'all' : 'unreviewed'"
          >
            <span>Unreviewed</span>
            <span v-if="filterCounts.unreviewed > 0" class="font-mono text-[9.5px] opacity-80">
              {{ filterCounts.unreviewed }}
            </span>
          </button>
          <button
            type="button"
            :aria-pressed="statusFilter === 'commented'"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors"
            :class="
              statusFilter === 'commented'
                ? 'bg-terra-soft text-terra-text'
                : 'text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="statusFilter = statusFilter === 'commented' ? 'all' : 'commented'"
          >
            <span>Comments</span>
            <span v-if="filterCounts.commented > 0" class="font-mono text-[9.5px] opacity-80">
              {{ filterCounts.commented }}
            </span>
          </button>
          <button
            type="button"
            :aria-pressed="statusFilter === 'unresolved'"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors"
            :class="
              statusFilter === 'unresolved'
                ? 'bg-terra-soft text-terra-text'
                : 'text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            @click="statusFilter = statusFilter === 'unresolved' ? 'all' : 'unresolved'"
          >
            <span>Unresolved</span>
            <span v-if="filterCounts.unresolved > 0" class="font-mono text-[9.5px] opacity-80">
              {{ filterCounts.unresolved }}
            </span>
          </button>
          <button
            v-if="review.lastReviewedCommitOid"
            type="button"
            :aria-pressed="review.commitFilter === 'since-last-review'"
            :disabled="review.isLoadingCommitFilter"
            class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium transition-colors disabled:opacity-50"
            :class="
              review.commitFilter === 'since-last-review'
                ? 'border-ochre-border bg-ochre-soft text-ochre-text'
                : 'border-border-muted bg-canvas text-ink-muted hover:border-ochre-border hover:bg-ochre-soft/50 hover:text-ochre-text'
            "
            :title="`Show only files touched since ${review.lastReviewedCommitOid.slice(0, 7)}`"
            @click="
              review.setCommitFilter(
                review.commitFilter === 'since-last-review' ? 'all' : 'since-last-review',
              )
            "
          >
            <Sparkles class="h-2.5 w-2.5" />
            <span>Since last review</span>
            <span
              v-if="review.sinceLastReviewPaths !== null"
              class="font-mono text-[9.5px] opacity-80"
            >
              {{ review.sinceLastReviewPaths.size }}
            </span>
          </button>
        </div>

        <div class="flex flex-col items-start gap-1.5 @[260px]:flex-row @[260px]:flex-wrap @[260px]:items-center @[260px]:justify-between">
          <button
            type="button"
            :aria-pressed="hideReviewed"
            class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors"
            :class="
              hideReviewed
                ? 'border-pine-border bg-pine-soft text-pine-text'
                : 'border-border-muted bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
            "
            title="Hide reviewed files"
            @click="hideReviewed = !hideReviewed"
          >
            <CheckCheck class="h-3 w-3" />
            <span>Hide reviewed</span>
          </button>

          <div class="flex flex-wrap items-center gap-1">
            <button
              v-if="hasGeneratedVisibleSteps"
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-border-muted bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
              title="Hide generated files & lockfiles from tour"
              @click="review.hideGeneratedSteps()"
            >
              <Sparkles class="h-2.5 w-2.5" />
              <span>Mute gen</span>
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1 rounded-md border border-border-muted bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
              :aria-label="`Switch reading order (currently ${review.tourDirection})`"
              :title="`Reading order: ${review.tourDirection === 'bottom-up' ? 'Bottom-Up' : 'Top-Down'}. Click to switch.`"
              @click="review.setTourDirection(review.tourDirection === 'bottom-up' ? 'top-down' : 'bottom-up')"
            >
              <ArrowDownUp class="h-3 w-3 text-terra" />
              <span>{{ review.tourDirection === 'bottom-up' ? 'Bottom-Up' : 'Top-Down' }}</span>
            </button>

            <button
              type="button"
              :aria-pressed="groupByLayer"
              class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors"
              :class="
                groupByLayer
                  ? 'border-terra-border bg-terra-soft text-terra-text'
                  : 'border-border-muted bg-canvas text-ink-muted hover:bg-canvas-elevated hover:text-ink'
              "
              title="Group steps by architectural layer"
              @click="groupByLayer = !groupByLayer"
            >
              <Layers class="h-3 w-3" />
              <span>Layers</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Ordered Tour Steps — Connected Stepping-Stone Trail or Layer Groups -->
      <div ref="stepListRef" class="relative flex-1 overflow-y-auto px-2.5 py-2.5">
        <div
          v-if="filteredSteps.length === 0"
          class="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center text-xs text-ink-faint"
        >
          <span>No files match the current filter.</span>
          <button
            v-if="statusFilter !== 'all' || hideReviewed"
            type="button"
            class="rounded-md border border-border bg-canvas px-2 py-1 text-[11px] font-medium text-terra-text transition-colors hover:bg-terra-soft"
            @click="resetSidebarFilters"
          >
            Show all files
          </button>
        </div>

        <!-- Grouped by Layer -->
        <div v-else-if="groupByLayer" class="space-y-2.5">
          <div v-for="group in groupedSteps" :key="group.layer" class="space-y-1">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11px] font-semibold text-ink-secondary transition-colors hover:bg-canvas-elevated"
              @click="toggleLayerCollapsed(group.layer)"
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <ChevronRight v-if="collapsedLayers.has(group.layer)" class="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <ChevronDown v-else class="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <span
                  class="shrink-0 rounded border px-1 py-0.2 font-mono text-[9px] font-semibold"
                  :class="LAYER_META[group.layer].badgeClass"
                >
                  {{ LAYER_META[group.layer].shortLabel }}
                </span>
                <span class="truncate">{{ group.label }}</span>
              </span>
              <span class="shrink-0 font-mono text-[10px] text-ink-faint">
                {{ group.reviewedCount }}/{{ group.steps.length }}
              </span>
            </button>

            <div v-if="!collapsedLayers.has(group.layer)" class="space-y-1 pl-1">
              <button
                v-for="step in group.steps"
                :key="step.file.path"
                :data-step-index="step.stepIndex"
                class="group relative flex w-full items-start gap-2.5 rounded-xl border px-2 py-2 text-left transition-all"
                :class="
                  review.activeView === 'step' && step.stepIndex === review.currentStepIndex
                    ? 'stroll-card border-terra-border bg-terra-soft'
                    : 'border-transparent hover:border-border-muted hover:bg-canvas-elevated/60'
                "
                @click="review.goToStep(step.stepIndex)"
              >
                <span
                  class="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold transition-all"
                  :class="
                    review.isStepReviewed(step.file.path)
                      ? 'animate-check-pop bg-pine text-white shadow-xs'
                      : review.activeView === 'step' && step.stepIndex === review.currentStepIndex
                        ? 'bg-terra text-white ring-3 ring-terra-soft shadow-xs'
                        : 'border border-border bg-canvas-subtle text-ink-muted group-hover:border-terra-border group-hover:text-ink'
                  "
                  :title="review.isStepReviewed(step.file.path) ? 'Reviewed' : `Step ${step.stepIndex + 1}`"
                >
                  <Check v-if="review.isStepReviewed(step.file.path)" class="h-3 w-3" />
                  <template v-else>{{ step.stepIndex + 1 }}</template>
                </span>

                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex flex-col items-start gap-1 @[260px]:flex-row @[260px]:items-center @[260px]:justify-between @[260px]:gap-1.5">
                    <div class="flex w-full min-w-0 flex-col items-start gap-1 @[260px]:w-auto @[260px]:flex-row @[260px]:items-center @[260px]:gap-1.5">
                      <span
                        v-if="step.isGenerated"
                        class="shrink-0 rounded border border-border bg-canvas-elevated px-1 py-0.2 font-mono text-[9px] font-semibold text-ink-muted"
                      >
                        {{ isLockfile(step.file.path) ? 'LOCKFILE' : 'GENERATED' }}
                      </span>
                      <span
                        class="w-full truncate font-mono text-xs font-medium @[260px]:w-auto"
                        :class="
                          review.activeView === 'step' && step.stepIndex === review.currentStepIndex
                            ? 'text-ink'
                            : step.isGenerated
                              ? 'text-ink-muted group-hover:text-ink'
                              : 'text-ink-secondary group-hover:text-ink'
                        "
                      >
                        {{ fileNameOnly(step.file.path) }}
                      </span>
                    </div>

                    <span
                      v-if="draftCountForFile(step.file.path) > 0"
                      class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-terra-soft px-1.5 py-0.2 font-mono text-[10px] font-medium text-terra-text"
                    >
                      <MessageSquare class="h-2.5 w-2.5" />
                      {{ draftCountForFile(step.file.path) }}
                    </span>
                  </div>

                  <div class="flex flex-col items-start gap-1 text-[10px] text-ink-faint @[260px]:flex-row @[260px]:items-center @[260px]:justify-between @[260px]:gap-2">
                    <span class="w-full truncate @[260px]:w-auto">{{ dirOnly(step.file.path) || '.' }}</span>
                    <span class="shrink-0 font-mono">
                      <span class="text-pine-text">+{{ step.file.additions }}</span>
                      <span class="mx-0.5 text-ink-faint">/</span>
                      <span class="text-crimson-text">-{{ step.file.deletions }}</span>
                    </span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <!-- Flat Connected Stepping-Stone Trail (supports drag-and-drop) -->
        <div v-else class="relative space-y-1">
          <!-- Subtle vertical trail rail connecting the stepping stones -->
          <div
            v-if="filteredSteps.length > 1"
            class="pointer-events-none absolute top-5 bottom-5 left-[17px] w-px bg-border"
          />

          <div
            v-for="step in filteredSteps"
            :key="step.file.path"
            :data-step-index="step.stepIndex"
            role="button"
            tabindex="0"
            draggable="true"
            class="group relative flex w-full cursor-pointer items-start gap-2.5 rounded-xl border px-2 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra"
            :class="[
              review.activeView === 'step' && step.stepIndex === review.currentStepIndex
                ? 'stroll-card border-terra-border bg-terra-soft'
                : 'border-transparent hover:border-border-muted hover:bg-canvas-elevated/60',
              dragOverPath === step.file.path ? 'ring-1 ring-terra-border bg-terra-soft/40' : '',
              draggedPath === step.file.path ? 'opacity-50' : '',
            ]"
            @click="review.goToStep(step.stepIndex)"
            @keydown.enter.self.prevent="review.goToStep(step.stepIndex)"
            @keydown.space.self.prevent="review.goToStep(step.stepIndex)"
            @dragstart="onStepDragStart($event, step.file.path)"
            @dragover="onStepDragOver($event, step.file.path)"
            @drop="onStepDrop($event, step.file.path)"
            @dragend="onStepDragEnd"
          >
            <!-- Stepping-Stone Trail Node -->
            <span
              class="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold transition-all"
              :class="
                review.isStepReviewed(step.file.path)
                  ? 'animate-check-pop bg-pine text-white shadow-xs'
                  : review.activeView === 'step' && step.stepIndex === review.currentStepIndex
                    ? 'bg-terra text-white ring-3 ring-terra-soft shadow-xs'
                    : 'border border-border bg-canvas-subtle text-ink-muted group-hover:border-terra-border group-hover:text-ink'
              "
              :title="review.isStepReviewed(step.file.path) ? 'Reviewed' : `Step ${step.stepIndex + 1}`"
            >
              <Check v-if="review.isStepReviewed(step.file.path)" class="h-3 w-3" />
              <template v-else>{{ step.stepIndex + 1 }}</template>
            </span>

            <!-- Step File Metadata -->
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex flex-col items-start gap-1 @[260px]:flex-row @[260px]:items-center @[260px]:justify-between @[260px]:gap-1.5">
                <div class="flex w-full min-w-0 flex-col items-start gap-1 @[260px]:w-auto @[260px]:flex-row @[260px]:items-center @[260px]:gap-1.5">
                  <span
                    v-if="step.isGenerated"
                    class="shrink-0 rounded border border-border bg-canvas-elevated px-1 py-0.2 font-mono text-[9px] font-semibold text-ink-muted"
                  >
                    {{ isLockfile(step.file.path) ? 'LOCKFILE' : 'GENERATED' }}
                  </span>
                  <span
                    v-else
                    class="shrink-0 rounded border px-1 py-0.2 font-mono text-[9px] font-semibold"
                    :class="LAYER_META[step.layer].badgeClass"
                  >
                    {{ LAYER_META[step.layer].shortLabel }}
                  </span>
                  <span
                    class="w-full truncate font-mono text-xs font-medium @[260px]:w-auto"
                    :class="
                      review.activeView === 'step' && step.stepIndex === review.currentStepIndex
                        ? 'text-ink'
                        : step.isGenerated
                          ? 'text-ink-muted group-hover:text-ink'
                          : 'text-ink-secondary group-hover:text-ink'
                    "
                  >
                    {{ fileNameOnly(step.file.path) }}
                  </span>
                </div>

                <div class="flex shrink-0 items-center gap-1">
                  <span
                    v-if="
                      review.lastReviewedCommitOid &&
                      review.commitFilter !== 'since-last-review' &&
                      review.sinceLastReviewPaths?.has(step.file.path)
                    "
                    class="shrink-0 rounded border border-ochre-border bg-ochre-soft px-1 py-0.2 font-mono text-[9px] font-semibold text-ochre-text"
                    :title="`Touched since ${review.lastReviewedCommitOid.slice(0, 7)}`"
                  >
                    UPDATED
                  </span>
                  <span
                    v-if="unresolvedCountForFile(step.file.path) > 0"
                    class="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-ochre-border bg-ochre-soft px-1.5 py-0.2 font-mono text-[10px] font-semibold text-ochre-text"
                    :title="`${unresolvedCountForFile(step.file.path)} unresolved thread(s)`"
                  >
                    <MessageSquare class="h-2.5 w-2.5" />
                    {{ unresolvedCountForFile(step.file.path) }}
                  </span>
                  <span
                    v-else-if="draftCountForFile(step.file.path) > 0"
                    class="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-terra-soft px-1.5 py-0.2 font-mono text-[10px] font-medium text-terra-text"
                  >
                    <MessageSquare class="h-2.5 w-2.5" />
                    {{ draftCountForFile(step.file.path) }}
                  </span>
                </div>
              </div>

              <div class="flex flex-col items-start gap-1 text-[10px] text-ink-faint @[260px]:flex-row @[260px]:items-center @[260px]:justify-between @[260px]:gap-2">
                <span class="w-full truncate @[260px]:w-auto">{{ dirOnly(step.file.path) || '.' }}</span>
                <div class="flex w-full shrink-0 items-center justify-between gap-1 @[260px]:w-auto @[260px]:justify-end">
                  <div
                    class="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex"
                    @click.stop
                  >
                    <GripVertical
                      class="h-2.5 w-2.5 cursor-grab text-ink-faint"
                      title="Drag to reorder"
                    />
                    <button
                      type="button"
                      :title="review.pinnedPaths.has(step.file.path) ? 'Unpin step' : 'Pin step to top'"
                      class="rounded p-0.5 transition-colors hover:bg-canvas-elevated"
                      :class="review.pinnedPaths.has(step.file.path) ? 'text-terra-text' : 'text-ink-faint hover:text-ink'"
                      @click.stop="review.togglePinStep(step.file.path)"
                    >
                      <Pin class="h-2.5 w-2.5" />
                    </button>
                    <button
                      v-if="step.stepIndex > 0"
                      type="button"
                      title="Move up"
                      class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-ink"
                      @click.stop="review.moveStep(step.file.path, -1)"
                    >
                      <ArrowUp class="h-2.5 w-2.5" />
                    </button>
                    <button
                      v-if="step.stepIndex < review.tourSteps.length - 1"
                      type="button"
                      title="Move down"
                      class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-ink"
                      @click.stop="review.moveStep(step.file.path, 1)"
                    >
                      <ArrowDown class="h-2.5 w-2.5" />
                    </button>
                    <button
                      type="button"
                      title="Hide file from tour"
                      class="rounded p-0.5 text-ink-faint transition-colors hover:bg-canvas-elevated hover:text-crimson-text"
                      @click.stop="review.toggleHideStep(step.file.path)"
                    >
                      <EyeOff class="h-2.5 w-2.5" />
                    </button>
                  </div>
                  <Pin
                    v-if="review.pinnedPaths.has(step.file.path)"
                    class="h-2.5 w-2.5 text-terra-text group-hover:hidden group-focus-within:hidden"
                  />
                  <span class="font-mono">
                    <span class="text-pine-text">+{{ step.file.additions }}</span>
                    <span class="mx-0.5 text-ink-faint">/</span>
                    <span class="text-crimson-text">-{{ step.file.deletions }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tour Customization Reset Footer -->
      <div
        v-if="review.hiddenPaths.size > 0 || review.customOrderPaths.length > 0 || review.pinnedPaths.size > 0"
        class="border-t border-border-muted bg-canvas text-[11px] text-ink-muted"
      >
        <div class="flex flex-col items-start gap-1.5 px-3 py-2 @[260px]:flex-row @[260px]:items-center @[260px]:justify-between">
          <button
            v-if="review.hiddenPaths.size > 0"
            type="button"
            class="inline-flex items-center gap-1 rounded px-1 py-0.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            @click="showHiddenList = !showHiddenList"
          >
            <Eye class="h-3 w-3" />
            <span>{{ review.hiddenPaths.size }} hidden</span>
          </button>
          <span v-else>Custom tour order</span>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-terra-text transition-colors hover:bg-terra-soft"
            @click="review.resetTourCustomization()"
          >
            <RotateCcw class="h-2.5 w-2.5" />
            <span>Reset</span>
          </button>
        </div>

        <div
          v-if="showHiddenList && review.hiddenPaths.size > 0"
          class="max-h-32 space-y-1 overflow-y-auto border-t border-border-muted px-3 py-2"
        >
          <div
            v-for="path in Array.from(review.hiddenPaths)"
            :key="path"
            class="flex items-center justify-between gap-2 text-[10.5px]"
          >
            <span class="truncate font-mono text-ink-muted" :title="path">{{ path }}</span>
            <button
              type="button"
              class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-terra-text hover:bg-terra-soft"
              @click="review.toggleHideStep(path)"
            >
              Unhide
            </button>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>
