<script setup lang="ts">
import {
  ArrowDown,
  ArrowUp,
  Check,
  EyeOff,
  FileText,
  GitCommitHorizontal,
  Loader2,
  MessageSquare,
  Pin,
  RotateCcw,
} from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isLockfile, LAYER_META } from '@/services/readingOrder'
import { computeRevealScrollTop } from '@/services/scrollReveal'
import { useReviewStore } from '@/stores/review'
import {
  DEFAULT_APP_SETTINGS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSettingsStore,
} from '@/stores/settings'

const review = useReviewStore()
const settings = useSettingsStore()
const stepListRef = ref<HTMLElement | null>(null)

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
      class="relative flex shrink-0 flex-col border-r border-border bg-canvas-subtle"
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
        <div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
          <span class="shrink-0 whitespace-nowrap">
            {{ review.reviewedCount }} / {{ review.tourSteps.length }} reviewed
          </span>
          <span class="truncate font-mono text-[10.5px] text-ink-faint">
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

        <!-- Commit / Scope Filter -->
        <div v-if="review.pr.commits.length > 0" class="mt-2.5 flex items-center gap-1.5">
          <GitCommitHorizontal class="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <select
            :value="review.commitFilter"
            :disabled="review.isLoadingCommitFilter"
            :aria-busy="review.isLoadingCommitFilter"
            class="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] text-ink-secondary focus:border-terra-border focus:outline-none disabled:opacity-50"
            @change="review.setCommitFilter(($event.target as HTMLSelectElement).value)"
          >
            <option value="all">All commits ({{ review.pr.commits.length }})</option>
            <option v-if="review.lastReviewedCommitOid" value="since-last-review">
              Since my last review
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
          class="group flex w-full items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left transition-all"
          :class="
            review.activeView === 'overview'
              ? 'stroll-card border-terra-border bg-terra-soft'
              : 'border-transparent hover:border-border-muted hover:bg-canvas-elevated/60'
          "
          title="PR Overview (0 or O)"
          @click="review.openOverview()"
        >
          <div class="flex min-w-0 items-center gap-2.5">
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
            <div class="min-w-0">
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

          <div class="flex shrink-0 items-center gap-1.5">
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
      </div>

      <!-- Ordered Tour Steps — Connected Stepping-Stone Trail -->
      <div ref="stepListRef" class="relative flex-1 overflow-y-auto px-2.5 py-2.5">
        <div class="relative space-y-1">
          <!-- Subtle vertical trail rail connecting the stepping stones -->
          <div
            v-if="review.tourSteps.length > 1"
            class="pointer-events-none absolute top-5 bottom-5 left-[17px] w-px bg-border"
          />

          <button
            v-for="step in review.tourSteps"
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
              <div class="flex items-center justify-between gap-1.5">
                <div class="flex min-w-0 items-center gap-1.5">
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
                    class="truncate font-mono text-xs font-medium"
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

              <div class="flex items-center justify-between gap-2 text-[10px] text-ink-faint">
                <span class="truncate">{{ dirOnly(step.file.path) || '.' }}</span>
                <div class="flex shrink-0 items-center gap-1">
                  <div
                    class="hidden items-center gap-0.5 group-hover:flex"
                    @click.stop
                  >
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
                    class="h-2.5 w-2.5 text-terra-text group-hover:hidden"
                  />
                  <span class="font-mono">
                    <span class="text-pine-text">+{{ step.file.additions }}</span>
                    <span class="mx-0.5 text-ink-faint">/</span>
                    <span class="text-crimson-text">-{{ step.file.deletions }}</span>
                  </span>
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Tour Customization Reset Footer -->
      <div
        v-if="review.hiddenPaths.size > 0 || review.customOrderPaths.length > 0 || review.pinnedPaths.size > 0"
        class="flex items-center justify-between border-t border-border-muted bg-canvas px-3 py-2 text-[11px] text-ink-muted"
      >
        <span>
          <template v-if="review.hiddenPaths.size > 0">
            {{ review.hiddenPaths.size }} hidden
          </template>
          <template v-else>Custom tour order</template>
        </span>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-terra-text transition-colors hover:bg-terra-soft"
          @click="review.resetTourCustomization()"
        >
          <RotateCcw class="h-2.5 w-2.5" />
          <span>Reset</span>
        </button>
      </div>
    </aside>
  </Transition>
</template>
