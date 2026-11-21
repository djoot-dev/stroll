<script setup lang="ts">
import {
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  ListOrdered,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  SunMoon,
  Terminal,
} from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'
import { buildPRSymbolIndex, type PRSymbolIndex } from '@/services/codeContext'
import { localBranchForPR } from '@/services/localCheckout'
import { openExternalUrl } from '@/services/native'
import { useCheckoutStore } from '@/stores/checkout'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const review = useReviewStore()
const checkout = useCheckoutStore()
const settings = useSettingsStore()
const query = ref('')
const selectedIdx = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

interface PaletteItem {
  id: string
  kind: 'file' | 'symbol' | 'thread' | 'overview' | 'checkout' | 'action' | 'line'
  title: string
  subtitle: string
  path?: string
  line?: number
  run?: () => void
}

function parseLineJumpQuery(raw: string): { fileQuery: string; line: number } | null {
  const trimmed = raw.trim()
  const match = trimmed.match(/^(.*?):(\d+)$/)
  if (!match) return null
  const line = Number(match[2])
  if (!Number.isFinite(line) || line < 1) return null
  return { fileQuery: match[1].trim().toLowerCase(), line }
}

const symbolIndex = computed<PRSymbolIndex>(() => {
  if (!review.pr) return new Map()
  return buildPRSymbolIndex(review.pr.files)
})

const actionItems = computed<PaletteItem[]>(() => {
  const actions: PaletteItem[] = []
  const nextThemeLabel = settings.resolvedTheme === 'dark' ? 'Warm Parchment (Light)' : 'Dark'
  actions.push({
    id: 'action:toggle-theme',
    kind: 'action',
    title: 'Action: Toggle theme',
    subtitle: `Switch to ${nextThemeLabel}`,
    run: () => void settings.toggleTheme(),
  })

  if (review.pr) {
    const nextOrder = review.tourDirection === 'bottom-up' ? 'top-down' : 'bottom-up'
    actions.push({
      id: 'action:toggle-order',
      kind: 'action',
      title: `Action: Switch reading order to ${nextOrder}`,
      subtitle: `Currently ${review.tourDirection}`,
      run: () => review.setTourDirection(nextOrder),
    })

    if (review.currentStep) {
      const stepPath = review.currentStep.file.path
      const isReviewed = review.isStepReviewed(stepPath)
      actions.push({
        id: 'action:toggle-reviewed',
        kind: 'action',
        title: isReviewed ? 'Action: Unmark current file reviewed' : 'Action: Mark current file reviewed',
        subtitle: stepPath,
        run: () => void review.toggleReviewed(stepPath),
      })
    }

    actions.push({
      id: 'action:finish-review',
      kind: 'action',
      title: 'Action: Finish review',
      subtitle: 'Open review summary & submit modal',
      run: () => {
        review.showFinishModal = true
      },
    })

    if (!review.pr.isMock) {
      actions.push({
        id: 'action:refresh-pr',
        kind: 'action',
        title: 'Action: Refresh PR',
        subtitle: `Reload ${review.pr.owner}/${review.pr.repo}#${review.pr.number} from GitHub`,
        run: () => void review.refreshCurrentPR(),
      })
    }

    actions.push({
      id: 'action:open-github',
      kind: 'action',
      title: 'Action: Open in GitHub',
      subtitle: review.pr.url,
      run: () => void openExternalUrl(review.pr!.url),
    })
  }

  actions.push({
    id: 'action:load-pr',
    kind: 'action',
    title: 'Action: Load Pull Request',
    subtitle: 'Open PR Loader modal',
    run: () => {
      review.showLoaderModal = true
    },
  })

  actions.push({
    id: 'action:open-settings',
    kind: 'action',
    title: 'Action: Open Settings',
    subtitle: 'Configure Tour, Diff & Code, GitHub, and Local & Git',
    run: () => settings.openSettings(),
  })

  return actions
})

const items = computed<PaletteItem[]>(() => {
  const raw = query.value.trim()
  const q = raw.toLowerCase()
  const results: PaletteItem[] = []

  const lineJump = parseLineJumpQuery(raw)
  if (lineJump && review.pr) {
    if (!lineJump.fileQuery && review.currentStep) {
      results.push({
        id: `line:current:${lineJump.line}`,
        kind: 'line',
        title: `Jump to line ${lineJump.line}`,
        subtitle: review.currentStep.file.path,
        path: review.currentStep.file.path,
        line: lineJump.line,
      })
    }
    for (const step of review.tourSteps) {
      if (!lineJump.fileQuery || step.file.path.toLowerCase().includes(lineJump.fileQuery)) {
        results.push({
          id: `line:${step.file.path}:${lineJump.line}`,
          kind: 'line',
          title: `${step.file.path.split('/').pop() ?? step.file.path}:${lineJump.line}`,
          subtitle: `Jump to line ${lineJump.line} in ${step.file.path}`,
          path: step.file.path,
          line: lineJump.line,
        })
      }
    }
    return results.slice(0, 20)
  }

  if (review.pr) {
    if (!q || 'overview'.includes(q)) {
      results.push({
        id: 'overview',
        kind: 'overview',
        title: 'PR Overview',
        subtitle: 'Description, checks, commits & conversation',
      })
    }

    const pr = review.pr
    if (
      pr.state === 'OPEN' &&
      !pr.isMock &&
      checkout.isAvailable() &&
      checkout.isLinked(pr.owner, pr.repo) &&
      (!q || 'check out checkout branch git'.includes(q) || pr.headRefName.toLowerCase().includes(q))
    ) {
      const branch = localBranchForPR(pr)
      results.push({
        id: 'checkout',
        kind: 'checkout',
        title: `Check out ${branch}`,
        subtitle: `Fetch and switch ${checkout.repoPathFor(pr.owner, pr.repo)} to this PR`,
      })
    }

    for (const step of review.tourSteps) {
      if (!q || step.file.path.toLowerCase().includes(q)) {
        results.push({
          id: `file:${step.file.path}`,
          kind: 'file',
          title: step.file.path.split('/').pop() ?? step.file.path,
          subtitle: `Step ${step.stepIndex + 1} · ${step.file.path}`,
          path: step.file.path,
        })
      }
    }

    if (q.length >= 2) {
      for (const [name, decls] of symbolIndex.value.entries()) {
        if (!name.toLowerCase().includes(q)) continue
        for (const decl of decls.slice(0, 3)) {
          results.push({
            id: `sym:${decl.path}:${decl.line}:${name}`,
            kind: 'symbol',
            title: name,
            subtitle: `${decl.kind} in ${decl.path}:${decl.line}`,
            path: decl.path,
            line: decl.line,
          })
        }
      }

      for (const thread of review.pr.threads) {
        if (thread.isResolved) continue
        const body = thread.comments[0]?.body ?? ''
        if (thread.path.toLowerCase().includes(q) || body.toLowerCase().includes(q)) {
          results.push({
            id: `thread:${thread.id}`,
            kind: 'thread',
            title: thread.subjectType === 'FILE' ? `${thread.path} (file)` : `${thread.path}:${thread.line}`,
            subtitle: body.slice(0, 90),
            path: thread.path,
            line: thread.subjectType === 'FILE' ? undefined : thread.line,
          })
        }
      }
    }
  }

  for (const action of actionItems.value) {
    if (
      !q ||
      action.title.toLowerCase().includes(q) ||
      action.subtitle.toLowerCase().includes(q)
    ) {
      results.push(action)
    }
  }

  return results.slice(0, 20)
})

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      query.value = ''
      selectedIdx.value = 0
      await nextTick()
      inputRef.value?.focus()
    }
  },
)

watch(items, () => {
  selectedIdx.value = 0
})

function selectItem(item: PaletteItem) {
  if (item.kind === 'action' && item.run) {
    emit('close')
    item.run()
    return
  }
  if (item.kind === 'overview') {
    review.openOverview()
  } else if (item.kind === 'checkout' && review.pr) {
    const pr = review.pr
    // The overview's checkout panel shows progress and the outcome.
    review.openOverview()
    void checkout.checkout({
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      headRefName: pr.headRefName,
      isCrossRepository: pr.isCrossRepository,
      headRefOid: pr.headRefOid,
    })
  } else if (item.path && item.line) {
    review.goToFileLine(item.path, item.line)
  } else if (item.path) {
    review.goToFile(item.path)
  }
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (items.value.length > 0) {
      selectedIdx.value = (selectedIdx.value + 1) % items.value.length
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (items.value.length > 0) {
      selectedIdx.value = (selectedIdx.value - 1 + items.value.length) % items.value.length
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = items.value[selectedIdx.value]
    if (item) selectItem(item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] px-4 backdrop-blur-[1px]"
      @click.self="emit('close')"
    >
      <div
        class="animate-pop-in w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-canvas-subtle shadow-2xl"
        @keydown="handleKeydown"
      >
        <div class="flex items-center gap-2.5 border-b border-border-muted px-4 py-3">
          <Search class="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            placeholder="Jump to file, :line, symbol, thread, or run action…"
            class="w-full bg-transparent text-sm text-ink placeholder-ink-faint focus:outline-none"
          />
          <kbd class="rounded border border-border bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            ESC
          </kbd>
        </div>

        <div class="max-h-80 overflow-y-auto p-2">
          <div v-if="items.length === 0" class="px-3 py-6 text-center text-xs text-ink-faint">
            No matching files, symbols, threads, or actions.
          </div>

          <button
            v-for="(item, idx) in items"
            :key="item.id"
            type="button"
            class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
            :class="idx === selectedIdx ? 'bg-terra-soft text-ink' : 'hover:bg-canvas-elevated/60'"
            @mouseenter="selectedIdx = idx"
            @click="selectItem(item)"
          >
            <FileCode2
              v-if="item.kind === 'file' || item.kind === 'overview' || item.kind === 'line'"
              class="h-4 w-4 shrink-0 text-ink-muted"
            />
            <GitBranch v-else-if="item.kind === 'checkout'" class="h-4 w-4 shrink-0 text-pine-text" />
            <Sparkles v-else-if="item.kind === 'symbol'" class="h-4 w-4 shrink-0 text-terra-text" />
            <MessageSquare v-else-if="item.kind === 'thread'" class="h-4 w-4 shrink-0 text-ochre-text" />
            <SunMoon v-else-if="item.id === 'action:toggle-theme'" class="h-4 w-4 shrink-0 text-terra-text" />
            <ListOrdered v-else-if="item.id === 'action:toggle-order'" class="h-4 w-4 shrink-0 text-terra-text" />
            <CheckCircle2 v-else-if="item.id === 'action:toggle-reviewed'" class="h-4 w-4 shrink-0 text-pine-text" />
            <Send v-else-if="item.id === 'action:finish-review'" class="h-4 w-4 shrink-0 text-pine-text" />
            <RefreshCw v-else-if="item.id === 'action:refresh-pr'" class="h-4 w-4 shrink-0 text-ink-muted" />
            <ExternalLink v-else-if="item.id === 'action:open-github'" class="h-4 w-4 shrink-0 text-ink-muted" />
            <FolderGit2 v-else-if="item.id === 'action:load-pr'" class="h-4 w-4 shrink-0 text-terra-text" />
            <Settings v-else-if="item.id === 'action:open-settings'" class="h-4 w-4 shrink-0 text-ink-muted" />
            <Terminal v-else class="h-4 w-4 shrink-0 text-ink-muted" />

            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-semibold text-ink">{{ item.title }}</div>
              <div class="truncate text-[11px] text-ink-muted">{{ item.subtitle }}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
