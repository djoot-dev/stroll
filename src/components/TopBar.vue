<script setup lang="ts">
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderGit2,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  KeyRound,
  Link2,
  Maximize2,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Send,
  Settings,
  SkipForward,
  Sun,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { copyToClipboard, openExternalUrl } from '@/services/native'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore } from '@/stores/settings'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)

const emit = defineEmits<{
  (e: 'openCommandPalette'): void
}>()

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()

const menuOpen = ref(false)
const menuContainerRef = ref<HTMLElement | null>(null)

function closeMenu() {
  menuOpen.value = false
}

function onDocumentPointerDown(e: PointerEvent) {
  if (!menuOpen.value) return
  if (menuContainerRef.value && !menuContainerRef.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}

function onDocumentKeyDown(e: KeyboardEvent) {
  if (menuOpen.value && e.key === 'Escape') {
    menuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeyDown)
})

const prStatePill = computed(() => {
  const pr = review.pr
  if (!pr) return null
  if (pr.state === 'MERGED') {
    return {
      label: 'Merged',
      class: 'border-plum-border bg-plum-soft text-plum-text',
      icon: GitMerge,
      title: 'Pull request is merged',
    }
  }
  if (pr.state === 'CLOSED') {
    return {
      label: 'Closed',
      class: 'border-crimson-border bg-crimson-soft text-crimson-text',
      icon: GitPullRequestClosed,
      title: 'Pull request is closed',
    }
  }
  if (pr.isDraft) {
    return {
      label: 'Draft',
      class: 'border-border bg-canvas-elevated text-ink-muted',
      icon: GitPullRequestDraft,
      title: 'Draft pull request',
    }
  }
  return null
})

const hasMergeConflicts = computed(
  () => review.pr?.state === 'OPEN' && review.pr.mergeable === 'CONFLICTING',
)

function toggleDirection() {
  const next = review.tourDirection === 'bottom-up' ? 'top-down' : 'bottom-up'
  void review.setTourDirection(next)
}

const copiedPRLink = ref(false)
let copyLinkTimer: ReturnType<typeof setTimeout> | null = null

async function handleCopyPRLink() {
  const url = review.pr?.url
  if (!url || review.pr?.isMock) return
  const ok = await copyToClipboard(url)
  if (!ok) return
  copiedPRLink.value = true
  if (copyLinkTimer) clearTimeout(copyLinkTimer)
  copyLinkTimer = setTimeout(() => {
    copiedPRLink.value = false
  }, 1500)
}

function handleOpenOnGitHub() {
  if (!review.pr?.url) return
  void openExternalUrl(review.pr.url)
}

function handleRefreshPR() {
  if (!review.pr || review.pr.isMock || review.isRefreshingPR) return
  void review.refreshCurrentPR()
}
</script>

<template>
  <header class="shrink-0 border-b border-border bg-canvas-subtle">
    <div class="flex h-12 items-center justify-between gap-3 px-4">
      <!-- Left: Back to PRs + Sidebar toggle + PR identity -->
      <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <button
          class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated"
          title="Back to PR Inbox"
          @click="review.backToInbox()"
        >
          <ArrowLeft class="h-3.5 w-3.5" />
          <span class="hidden sm:inline">PRs</span>
        </button>

        <button
          class="shrink-0 rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
          :aria-expanded="review.sidebarOpen"
          :aria-label="review.sidebarOpen ? 'Hide tour outline' : 'Show tour outline'"
          :title="review.sidebarOpen ? 'Hide tour outline ([)' : 'Show tour outline ([)'"
          @click="review.sidebarOpen = !review.sidebarOpen"
        >
          <PanelLeftClose v-if="review.sidebarOpen" class="h-4 w-4" />
          <PanelLeftOpen v-else class="h-4 w-4" />
        </button>

        <template v-if="review.pr">
          <span class="shrink-0 text-ink-faint">/</span>
          <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
            <span class="truncate text-xs font-medium text-ink-secondary">
              {{ review.pr.owner }}/{{ review.pr.repo }}
              <span class="text-ink-muted">#{{ review.pr.number }}</span>
            </span>
            <span
              v-if="review.pr.isMock"
              class="shrink-0 whitespace-nowrap rounded-md border border-ochre-border bg-ochre-soft px-1.5 py-0.5 text-[10px] font-medium text-ochre-text"
            >
              DEMO PR
            </span>
            <span
              v-if="prStatePill"
              class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              :class="prStatePill.class"
              :title="prStatePill.title"
            >
              <component :is="prStatePill.icon" class="h-3 w-3" />
              <span>{{ prStatePill.label }}</span>
            </span>
            <span
              v-if="hasMergeConflicts"
              class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-crimson-border bg-crimson-soft px-2 py-0.5 text-[10px] font-semibold text-crimson-text"
              title="This pull request has merge conflicts"
            >
              <AlertTriangle class="h-3 w-3" />
              <span class="hidden sm:inline">Conflicts</span>
            </span>
            <button
              v-if="!review.pr.isMock && review.pr.url"
              type="button"
              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-canvas px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:border-border-strong hover:text-ink"
              :title="copiedPRLink ? 'Copied!' : 'Copy PR link'"
              :aria-label="copiedPRLink ? 'Copied PR link' : 'Copy PR link'"
              @click="handleCopyPRLink"
            >
              <Check v-if="copiedPRLink" class="h-3 w-3 text-pine-text" />
              <Link2 v-else class="h-3 w-3" />
              <span v-if="copiedPRLink" class="text-[10px] font-medium text-pine-text">Copied!</span>
            </button>
          </div>
        </template>
      </div>

      <!-- Center: Step Progress -->
      <div v-if="review.tourSteps.length > 0" class="flex shrink-0 items-center gap-1.5">
        <button
          class="shrink-0 rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-40"
          :disabled="review.activeView === 'overview' || review.currentStepIndex === 0"
          aria-label="Previous step"
          title="Previous step (H or ←)"
          @click="review.prevStep()"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
        </button>

        <div class="flex shrink-0 items-center gap-2 px-1">
          <span class="whitespace-nowrap font-mono text-xs font-medium text-ink">
            <template v-if="review.activeView === 'overview'">Overview</template>
            <template v-else>Step {{ review.currentStepIndex + 1 }} of {{ review.tourSteps.length }}</template>
          </span>
          <div class="hidden h-1.5 w-24 overflow-hidden rounded-full bg-canvas-elevated lg:block">
            <div
              class="h-full rounded-full bg-terra transition-all duration-200"
              :style="{ width: review.activeView === 'overview' ? '0%' : `${review.progressPercent}%` }"
            />
          </div>
        </div>

        <button
          class="shrink-0 rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-40"
          :disabled="review.activeView === 'step' && review.currentStepIndex >= review.tourSteps.length - 1"
          :aria-label="review.activeView === 'overview' ? 'Enter Guided Tour' : 'Next step'"
          :title="review.activeView === 'overview' ? 'Enter Guided Tour (L or →)' : 'Next step (L or →)'"
          @click="review.nextStep()"
        >
          <ChevronRight class="h-3.5 w-3.5" />
        </button>

        <button
          class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-canvas px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated disabled:opacity-40"
          :disabled="!review.hasUnreviewedSteps"
          :title="review.hasUnreviewedSteps ? 'Next unreviewed step (N)' : 'All steps reviewed'"
          @click="review.nextUnreviewedStep()"
        >
          <SkipForward class="h-3.5 w-3.5 text-terra" />
          <span class="hidden xl:inline text-[11px]">Next unreviewed</span>
        </button>
      </div>

      <!-- Right: Command Palette, Overflow Menu, Finish Review -->
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="review.pr"
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-canvas px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-terra-border hover:bg-canvas-elevated hover:text-ink"
          :title="isMac ? 'Jump to file, symbol, or thread (⌘K)' : 'Jump to file, symbol, or thread (Ctrl+K)'"
          @click="emit('openCommandPalette')"
        >
          <Search class="h-3 w-3 shrink-0" />
          <span class="hidden md:inline text-[11px]">Jump…</span>
          <kbd class="rounded border border-border-muted bg-canvas-subtle px-1 font-mono text-[10px] text-ink-faint">
            {{ isMac ? '⌘K' : 'Ctrl+K' }}
          </kbd>
        </button>

        <button
          v-if="review.pr"
          type="button"
          class="inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:border-terra-border hover:bg-canvas-elevated hover:text-ink"
          aria-label="Enter Zen Mode"
          :aria-pressed="review.zenMode"
          title="Zen / Focus Mode (Z)"
          @click="review.toggleZenMode()"
        >
          <Maximize2 class="h-3.5 w-3.5" />
        </button>

        <div ref="menuContainerRef" class="relative shrink-0">
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-lg border border-border bg-canvas p-1.5 text-ink-muted transition-colors hover:bg-canvas-elevated hover:text-ink"
            aria-label="More PR & app actions"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            title="More actions"
            @click="menuOpen = !menuOpen"
          >
            <MoreHorizontal class="h-4 w-4" />
          </button>

          <div
            v-if="menuOpen"
            role="menu"
            class="absolute right-0 top-full z-40 mt-1.5 w-56 rounded-xl border border-border bg-canvas-subtle p-1.5 shadow-lg"
          >
            <template v-if="review.pr">
              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink disabled:opacity-40"
                :disabled="review.pr.isMock || review.isRefreshingPR"
                @click="
                  handleRefreshPR();
                  closeMenu()
                "
              >
                <RefreshCw class="h-3.5 w-3.5 shrink-0 text-ink-muted" :class="{ 'animate-spin text-terra': review.isRefreshingPR }" />
                <span>{{ review.isRefreshingPR ? 'Refreshing PR…' : 'Refresh Pull Request' }}</span>
              </button>

              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
                @click="
                  handleOpenOnGitHub();
                  closeMenu()
                "
              >
                <ExternalLink class="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <span>Open PR on GitHub</span>
              </button>

              <button
                v-if="review.pr && !review.pr.isMock && review.pr.url"
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
                @click="
                  handleCopyPRLink();
                  closeMenu()
                "
              >
                <Link2 class="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <span>Copy PR link</span>
              </button>

              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
                @click="
                  toggleDirection();
                  closeMenu()
                "
              >
                <span class="flex items-center gap-2.5">
                  <ArrowDownUp class="h-3.5 w-3.5 shrink-0 text-terra" />
                  <span>Reading order</span>
                </span>
                <span class="font-mono text-[10px] text-ink-muted">
                  {{ review.tourDirection === 'bottom-up' ? 'Bottom-Up' : 'Top-Down' }}
                </span>
              </button>

              <div class="my-1 border-t border-border-muted" />
            </template>

            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="
                review.showLoaderModal = true;
                closeMenu()
              "
            >
              <FolderGit2 class="h-3.5 w-3.5 shrink-0 text-ink-muted" />
              <span>Load Pull Request…</span>
            </button>

            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="
                settings.openSettings('github');
                closeMenu()
              "
            >
              <span class="flex items-center gap-2.5">
                <KeyRound class="h-3.5 w-3.5 shrink-0" :class="auth.isAuthenticated ? 'text-pine-text' : 'text-ink-muted'" />
                <span>{{ auth.viewer ? `@${auth.viewer.login}` : 'Connect GitHub' }}</span>
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="
                settings.toggleTheme();
                closeMenu()
              "
            >
              <Sun v-if="settings.resolvedTheme === 'dark'" class="h-3.5 w-3.5 shrink-0 text-terra" />
              <Moon v-else class="h-3.5 w-3.5 shrink-0 text-pine" />
              <span>{{ settings.resolvedTheme === 'dark' ? 'Switch to Warm Light' : 'Switch to Deep Pine Dark' }}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-secondary transition-colors hover:bg-canvas-elevated hover:text-ink"
              @click="
                settings.openSettings('general');
                closeMenu()
              "
            >
              <span class="flex items-center gap-2.5">
                <Settings class="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <span>Settings…</span>
              </span>
              <kbd class="rounded border border-border-muted bg-canvas px-1 font-mono text-[10px] text-ink-faint">
                {{ isMac ? '⌘,' : 'Ctrl+,' }}
              </kbd>
            </button>
          </div>
        </div>

        <button
          v-if="review.pr"
          class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-pine px-3 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-pine-hover"
          :title="
            review.draftComments.length > 0
              ? `Finish & Submit Review (R) · ${review.draftComments.length} pending draft comment${review.draftComments.length === 1 ? '' : 's'}`
              : 'Finish & Submit Review (R)'
          "
          @click="review.showFinishModal = true"
        >
          <Send class="h-3.5 w-3.5" />
          <span>Finish Review</span>
          <span
            v-if="review.draftComments.length > 0"
            class="ml-0.5 rounded-full bg-white/25 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-white"
            :aria-label="`${review.draftComments.length} pending draft comments`"
          >
            {{ review.draftComments.length }}
          </span>
        </button>
      </div>
    </div>
  </header>
</template>
