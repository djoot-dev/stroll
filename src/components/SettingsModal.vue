<script setup lang="ts">
import {
  AlertCircle,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  ExternalLink,
  EyeOff,
  FolderGit2,
  FolderOpen,
  Globe,
  Keyboard,
  KeyRound,
  ListOrdered,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sun,
  Terminal,
  Trash2,
  X,
} from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import {
  inspectLocalRepo,
  isTauriRuntime,
  openExternalUrl,
  pickLocalDirectory,
  requestNotificationPermission,
} from '@/services/native'
import { RELEASES_PAGE_URL } from '@/services/releaseNotes'
import { useAuthStore } from '@/stores/auth'
import MarkdownContent from './MarkdownContent.vue'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore, type SettingsSection, type ThemeMode } from '@/stores/settings'
import { useUpdatesStore } from '@/stores/updates'
import type { TourDirection } from '@/types/pr'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()

const tokenInput = ref(auth.pat)
const githubHostInput = ref(settings.githubHost)
const showToken = ref(false)
const resetDone = ref(false)
const notificationPermissionError = ref<string | null>(null)
const repoInput = ref('')
const pathInput = ref('')
const pathValidationError = ref<string | null>(null)
const detectedOwnerRepo = ref<string | null>(null)
const isInspectingPath = ref(false)
const updates = useUpdatesStore()
const {
  appVersion,
  state: updateState,
  availableUpdate,
  message: updateMessage,
  releaseNotes,
  isLoadingReleaseNotes,
} = storeToRefs(updates)

const linkedRepos = computed(() => Object.entries(review.repoPaths))
const activePRRepo = computed(() =>
  review.pr ? `${review.pr.owner}/${review.pr.repo}` : '',
)

onMounted(() => {
  void updates.loadAppVersion()
})

function handleCheckForUpdates() {
  void updates.checkForUpdates()
}

function handleInstallUpdate() {
  void updates.installUpdate()
}

function formatReleaseDate(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

watch(
  () => settings.isOpen,
  (open) => {
    if (open) {
      tokenInput.value = auth.pat
      githubHostInput.value = settings.githubHost
      showToken.value = false
      resetDone.value = false
      notificationPermissionError.value = null
      pathValidationError.value = null
      detectedOwnerRepo.value = null
      const prefillRepo = settings.linkRepoPrefill
      if (prefillRepo) {
        repoInput.value = prefillRepo
        pathInput.value = review.repoPaths[prefillRepo] ?? ''
        settings.linkRepoPrefill = null
      } else if (!repoInput.value && activePRRepo.value) {
        repoInput.value = activePRRepo.value
        pathInput.value = review.repoPaths[activePRRepo.value] ?? ''
      }
    }
  },
)

const navItems: Array<{
  id: SettingsSection
  label: string
  icon: typeof Settings
  badge?: () => string | null
}> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'tour', label: 'Tour & Order', icon: ListOrdered },
  { id: 'diff', label: 'Diff & Code', icon: Code2 },
  {
    id: 'github',
    label: 'GitHub',
    icon: KeyRound,
    badge: () => (auth.isAuthenticated ? 'Connected' : null),
  },
  {
    id: 'repositories',
    label: 'Local & Git',
    icon: FolderGit2,
    badge: () => (linkedRepos.value.length > 0 ? `${linkedRepos.value.length}` : null),
  },
  {
    id: 'updates',
    label: 'Updates',
    icon: RefreshCw,
    badge: () => (updateState.value === 'available' ? 'Update available' : null),
  },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
]

const themeOptions: Array<{
  value: ThemeMode
  label: string
  subtitle: string
  icon: typeof Sun
  swatches: [string, string, string]
}> = [
  {
    value: 'light',
    label: 'Warm Parchment',
    subtitle: 'Sunlit cream, sage & pine',
    icon: Sun,
    swatches: ['#f7f1e5', '#245e48', '#c86130'],
  },
  {
    value: 'dark',
    label: 'Deep Pine',
    subtitle: 'Night forest & warm clay',
    icon: Moon,
    swatches: ['#0f1915', '#2d7a5b', '#de7b47'],
  },
  {
    value: 'system',
    label: 'System',
    subtitle: 'Match macOS appearance',
    icon: Monitor,
    swatches: ['#f7f1e5', '#0f1915', '#c86130'],
  },
]

const refreshOptions = [
  { label: 'Off', value: 0 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
]

const fontSizeOptions = [
  { label: 'Compact', value: 11.5 },
  { label: 'Default', value: 12.5 },
  { label: 'Comfortable', value: 13.5 },
  { label: 'Large', value: 14.5 },
]

const shortcutRows = [
  { keys: ['⌘K', 'Ctrl+K'], description: 'Open command palette (files, symbols, threads)' },
  { keys: ['O', '0'], description: 'Go to PR overview' },
  { keys: ['L', '→'], description: 'Next tour step' },
  { keys: ['H', '←'], description: 'Previous tour step' },
  { keys: ['J', '↓'], description: 'Smooth scroll down' },
  { keys: ['K', '↑'], description: 'Smooth scroll up' },
  { keys: ['M'], description: 'Mark current step reviewed / unreviewed' },
  { keys: ['['], description: 'Toggle tour outline sidebar' },
  { keys: ['R'], description: 'Open Finish & Submit Review modal' },
  { keys: ['⌘,', 'Ctrl+,'], description: 'Open or close Settings' },
  { keys: ['Esc'], description: 'Close active modal or popover' },
]

const activeSectionTitle = computed(
  () => navItems.find((item) => item.id === settings.activeSection)?.label ?? 'Settings',
)

async function handleSavePat() {
  if (!tokenInput.value.trim()) return
  await settings.setGithubHost(githubHostInput.value)
  githubHostInput.value = settings.githubHost
  await auth.verifyAndLoadProfile(tokenInput.value.trim())
}

async function handleSaveGithubHost() {
  await settings.setGithubHost(githubHostInput.value)
  githubHostInput.value = settings.githubHost
}

async function handleToggleNotifications(event: Event) {
  const input = event.target as HTMLInputElement
  const next = input.checked
  notificationPermissionError.value = null

  if (!next) {
    await settings.setInboxNotificationsEnabled(false)
    return
  }

  const granted = await requestNotificationPermission()
  if (!granted) {
    input.checked = false
    notificationPermissionError.value =
      'Notification permission was not granted. Enable notifications for Stroll in your system or browser settings.'
    await settings.setInboxNotificationsEnabled(false)
    return
  }

  await settings.setInboxNotificationsEnabled(true)
}

async function validateAndInspectLocalPath(rawPath: string): Promise<boolean> {
  const trimmed = rawPath.trim()
  pathValidationError.value = null
  detectedOwnerRepo.value = null

  if (!trimmed || !isTauriRuntime()) {
    return true
  }

  isInspectingPath.value = true
  try {
    const result = await inspectLocalRepo(trimmed)
    if (!result) return true
    if (!result.isGitRepo) {
      pathValidationError.value = 'Selected folder is not a valid Git repository.'
      return false
    }
    if (result.ownerRepo) {
      detectedOwnerRepo.value = result.ownerRepo
      if (!repoInput.value.trim() || repoInput.value.trim() === activePRRepo.value) {
        repoInput.value = result.ownerRepo
      }
    }
    return true
  } finally {
    isInspectingPath.value = false
  }
}

async function handleBrowseLocalRepo() {
  const selected = await pickLocalDirectory()
  if (!selected) return
  pathInput.value = selected
  await validateAndInspectLocalPath(selected)
}

async function handleSignInWithGh() {
  await settings.setGithubHost(githubHostInput.value)
  githubHostInput.value = settings.githubHost
  const ok = await auth.signInWithGh()
  if (ok) {
    tokenInput.value = auth.pat
  }
}

async function handleLinkRepo() {
  if (!repoInput.value.trim() || !pathInput.value.trim()) return
  const valid = await validateAndInspectLocalPath(pathInput.value)
  if (!valid) return
  await review.linkRepoPath(repoInput.value, pathInput.value)
  repoInput.value = ''
  pathInput.value = ''
  pathValidationError.value = null
  detectedOwnerRepo.value = null
}

async function handleDirectionChange(direction: TourDirection) {
  await review.setTourDirection(direction)
}

async function handleResetDefaults() {
  await settings.resetToDefaults()
  await review.setTourDirection(settings.defaultTourDirection)
  resetDone.value = true
  window.setTimeout(() => {
    resetDone.value = false
  }, 2000)
}
</script>

<template>
  <Transition name="modal-pop">
    <div
      v-if="settings.isOpen"
      class="stroll-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      @click.self="settings.closeSettings()"
    >
      <div
        class="stroll-elevated flex h-[560px] max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-canvas-subtle sm:flex-row"
      >
        <!-- Sidebar Navigation -->
        <aside
          class="flex shrink-0 flex-col border-b border-border bg-canvas/80 sm:w-48 sm:border-r sm:border-b-0"
        >
          <div class="flex items-center justify-between px-4 py-3.5 sm:border-b sm:border-border-muted">
            <div class="flex items-center gap-2">
              <Settings class="h-4 w-4 text-terra" />
              <span class="text-sm font-semibold text-ink">Settings</span>
            </div>
            <button
              class="rounded-lg p-1 text-ink-muted hover:bg-canvas-elevated hover:text-ink sm:hidden"
              @click="settings.closeSettings()"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <nav class="flex gap-1 overflow-x-auto px-2 pb-2 sm:flex-1 sm:flex-col sm:p-2">
            <button
              v-for="item in navItems"
              :key="item.id"
              class="flex shrink-0 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors"
              :class="
                settings.activeSection === item.id
                  ? 'bg-terra-soft text-terra-text'
                  : 'text-ink-muted hover:bg-canvas-elevated/70 hover:text-ink'
              "
              @click="settings.activeSection = item.id"
            >
              <span class="flex items-center gap-2">
                <component :is="item.icon" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ item.label }}</span>
              </span>
              <span
                v-if="item.badge?.()"
                class="hidden h-1.5 w-1.5 rounded-full bg-pine sm:inline-block"
                :title="item.badge() ?? ''"
              />
            </button>
          </nav>

          <div class="hidden border-t border-border-muted px-4 py-2.5 text-[10px] text-ink-faint sm:block">
            Stroll<template v-if="appVersion"> v{{ appVersion }}</template>
          </div>
        </aside>

        <!-- Main Section Content -->
        <div class="flex min-w-0 flex-1 flex-col">
          <header
            class="hidden items-center justify-between border-b border-border px-5 py-3.5 sm:flex"
          >
            <h2 class="text-sm font-semibold text-ink">{{ activeSectionTitle }}</h2>
            <button
              class="rounded-lg p-1 text-ink-muted hover:bg-canvas-elevated hover:text-ink"
              title="Close (Esc)"
              @click="settings.closeSettings()"
            >
              <X class="h-4 w-4" />
            </button>
          </header>

          <div class="flex-1 space-y-5 overflow-y-auto p-5">
            <!-- GENERAL -->
            <template v-if="settings.activeSection === 'general'">
              <div class="space-y-4">
                <!-- Appearance / Theme Picker -->
                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <p class="text-xs font-medium text-ink">Appearance</p>
                  <p class="mt-0.5 text-[11px] text-ink-muted">
                    Choose between Warm Parchment Light, Deep Pine Dark, or your system setting.
                  </p>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      v-for="opt in themeOptions"
                      :key="opt.value"
                      class="rounded-xl border p-2.5 text-left transition-all"
                      :class="
                        settings.theme === opt.value
                          ? 'border-terra-border bg-terra-soft'
                          : 'border-border bg-canvas-subtle hover:bg-canvas-elevated/60'
                      "
                      @click="settings.setTheme(opt.value)"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <component
                          :is="opt.icon"
                          class="h-3.5 w-3.5"
                          :class="settings.theme === opt.value ? 'text-terra-text' : 'text-ink-muted'"
                        />
                        <div class="flex items-center gap-1">
                          <span
                            v-for="(hex, sIdx) in opt.swatches"
                            :key="sIdx"
                            class="h-2.5 w-2.5 rounded-full border border-black/15"
                            :style="{ backgroundColor: hex }"
                          />
                        </div>
                      </div>
                      <p class="mt-2 text-xs font-semibold text-ink">{{ opt.label }}</p>
                      <p class="mt-0.5 text-[10px] text-ink-muted">{{ opt.subtitle }}</p>
                    </button>
                  </div>
                </div>

                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-medium text-ink">Inbox Auto-Refresh</p>
                      <p class="mt-0.5 text-[11px] text-ink-muted">
                        Automatically poll GitHub for pending review requests while on the Inbox screen.
                      </p>
                    </div>
                    <div class="inline-flex rounded-xl border border-border bg-canvas-inset p-0.5">
                      <button
                        v-for="opt in refreshOptions"
                        :key="opt.value"
                        class="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
                        :class="
                          settings.inboxAutoRefreshSeconds === opt.value
                            ? 'bg-terra text-white shadow-xs'
                            : 'text-ink-muted hover:text-ink'
                        "
                        @click="settings.setInboxAutoRefreshSeconds(opt.value)"
                      >
                        {{ opt.label }}
                      </button>
                    </div>
                  </div>
                </div>

                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <label class="flex cursor-pointer items-center justify-between gap-4">
                    <div>
                      <p class="text-xs font-medium text-ink">
                        Desktop Notifications for New Review Requests
                      </p>
                      <p class="mt-0.5 text-[11px] text-ink-muted">
                        Send a native notification when auto-refresh detects new PRs awaiting your review.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      :checked="settings.inboxNotificationsEnabled"
                      class="h-4 w-4 rounded border-border bg-canvas-inset accent-terra"
                      @change="handleToggleNotifications"
                    />
                  </label>
                  <p
                    v-if="notificationPermissionError"
                    class="mt-2 text-[11px] text-crimson-text"
                  >
                    {{ notificationPermissionError }}
                  </p>
                </div>

                <label
                  class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-canvas/60 p-4"
                >
                  <div>
                    <p class="text-xs font-medium text-ink">Show Keyboard Shortcuts Bar</p>
                    <p class="mt-0.5 text-[11px] text-ink-muted">
                      Display the quick-reference shortcut bar at the bottom of the review screen.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    :checked="settings.showShortcutsBar"
                    class="h-4 w-4 rounded border-border bg-canvas-inset accent-terra"
                    @change="settings.setShowShortcutsBar(($event.target as HTMLInputElement).checked)"
                  />
                </label>

                <div class="rounded-xl border border-border-muted bg-canvas-inset/60 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-medium text-ink-secondary">Reset Preferences</p>
                      <p class="mt-0.5 text-[11px] text-ink-faint">
                        Restore all tour, diff, and general settings to defaults. Your GitHub PAT is kept.
                      </p>
                    </div>
                    <button
                      class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-canvas-subtle px-3 py-1.5 text-xs text-ink-secondary hover:bg-canvas-elevated"
                      @click="handleResetDefaults"
                    >
                      <RotateCcw class="h-3.5 w-3.5" />
                      <span>{{ resetDone ? 'Reset!' : 'Reset' }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- TOUR & ORDER -->
            <template v-else-if="settings.activeSection === 'tour'">
              <div class="space-y-4">
                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <p class="text-xs font-medium text-ink">Default Reading Order</p>
                  <p class="mt-0.5 text-[11px] text-ink-muted">
                    Controls how Stroll orders files in the dependency graph.
                  </p>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      class="rounded-xl border p-3 text-left transition-colors"
                      :class="
                        settings.defaultTourDirection === 'bottom-up'
                          ? 'border-terra-border bg-terra-soft'
                          : 'border-border bg-canvas-subtle hover:bg-canvas-elevated/60'
                      "
                      @click="handleDirectionChange('bottom-up')"
                    >
                      <p class="text-xs font-semibold text-ink">Bottom-Up</p>
                      <p class="mt-1 text-[11px] leading-relaxed text-ink-muted">
                        Start with config, types, and core foundations before UI and tests.
                      </p>
                    </button>

                    <button
                      class="rounded-xl border p-3 text-left transition-colors"
                      :class="
                        settings.defaultTourDirection === 'top-down'
                          ? 'border-terra-border bg-terra-soft'
                          : 'border-border bg-canvas-subtle hover:bg-canvas-elevated/60'
                      "
                      @click="handleDirectionChange('top-down')"
                    >
                      <p class="text-xs font-semibold text-ink">Top-Down</p>
                      <p class="mt-1 text-[11px] leading-relaxed text-ink-muted">
                        Start at entrypoints and UI components, drilling down into helpers.
                      </p>
                    </button>
                  </div>
                </div>

                <label
                  class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-canvas/60 p-4"
                >
                  <div>
                    <p class="text-xs font-medium text-ink">Auto-Advance on Mark Reviewed</p>
                    <p class="mt-0.5 text-[11px] text-ink-muted">
                      Automatically jump to the next unreviewed step after marking a file reviewed.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    :checked="settings.autoAdvanceOnReview"
                    class="h-4 w-4 rounded border-border bg-canvas-inset accent-terra"
                    @change="
                      settings.setAutoAdvanceOnReview(($event.target as HTMLInputElement).checked)
                    "
                  />
                </label>

                <label
                  class="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-canvas/60 p-4"
                >
                  <div>
                    <p class="text-xs font-medium text-ink">
                      Open Tour Outline Sidebar by Default
                    </p>
                    <p class="mt-0.5 text-[11px] text-ink-muted">
                      Show the step outline sidebar automatically when opening a Pull Request.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    :checked="settings.sidebarDefaultOpen"
                    class="h-4 w-4 rounded border-border bg-canvas-inset accent-terra"
                    @change="
                      settings.setSidebarDefaultOpen(($event.target as HTMLInputElement).checked)
                    "
                  />
                </label>
              </div>
            </template>

            <!-- DIFF & CODE -->
            <template v-else-if="settings.activeSection === 'diff'">
              <div class="space-y-4">
                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-medium text-ink">Code Font Size</p>
                      <p class="mt-0.5 text-[11px] text-ink-muted">
                        Adjusts the monospace font size in the diff viewer.
                      </p>
                    </div>
                    <div class="inline-flex rounded-xl border border-border bg-canvas-inset p-0.5">
                      <button
                        v-for="opt in fontSizeOptions"
                        :key="opt.value"
                        class="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
                        :class="
                          settings.codeFontSize === opt.value
                            ? 'bg-terra text-white shadow-xs'
                            : 'text-ink-muted hover:text-ink'
                        "
                        @click="settings.setCodeFontSize(opt.value)"
                      >
                        {{ opt.label }}
                      </button>
                    </div>
                  </div>

                  <div
                    class="mt-3 overflow-hidden rounded-xl border border-border-muted bg-code p-2.5 font-mono leading-[1.55]"
                    :style="{ fontSize: `${settings.codeFontSize}px` }"
                  >
                    <div class="text-ink-muted">  const order = buildReadingOrder(files, dir)</div>
                    <div class="bg-diff-add text-pine-text">+ return order.filter((s) =&gt; !s.skipped)</div>
                  </div>
                </div>

                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <p class="text-xs font-medium text-ink">Symbol Hover Popover</p>
                  <p class="mt-0.5 text-[11px] text-ink-muted">
                    Choose how symbol definitions and PR context popovers are triggered in diffs.
                  </p>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      class="rounded-xl border p-3 text-left transition-colors"
                      :class="
                        !settings.requireAltForHover
                          ? 'border-terra-border bg-terra-soft'
                          : 'border-border bg-canvas-subtle hover:bg-canvas-elevated/60'
                      "
                      @click="settings.setRequireAltForHover(false)"
                    >
                      <p class="text-xs font-semibold text-ink">Automatic (250ms)</p>
                      <p class="mt-1 text-[11px] text-ink-muted">
                        Opens automatically when hovering an identifier.
                      </p>
                    </button>

                    <button
                      class="rounded-xl border p-3 text-left transition-colors"
                      :class="
                        settings.requireAltForHover
                          ? 'border-terra-border bg-terra-soft'
                          : 'border-border bg-canvas-subtle hover:bg-canvas-elevated/60'
                      "
                      @click="settings.setRequireAltForHover(true)"
                    >
                      <p class="text-xs font-semibold text-ink">⌥ / Alt + Hover</p>
                      <p class="mt-1 text-[11px] text-ink-muted">
                        Only opens while holding Option / Alt to avoid accidental popovers.
                      </p>
                    </button>
                  </div>
                </div>

                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <p class="text-xs font-medium text-ink">Long Lines</p>
                  <p class="mt-0.5 text-[11px] text-ink-muted">
                    Choose how diff lines wider than the viewer are displayed.
                  </p>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      class="rounded-xl border p-3 text-left transition-colors"
                      :class="
                        !settings.wrapLines
                          ? 'border-terra-border bg-terra-soft'
                          : 'border-border bg-canvas-subtle hover:bg-canvas-elevated/60'
                      "
                      @click="settings.setWrapLines(false)"
                    >
                      <p class="text-xs font-semibold text-ink">Scroll horizontally</p>
                      <p class="mt-1 text-[11px] text-ink-muted">
                        Keep each line on one row; scroll sideways to read long lines.
                      </p>
                    </button>

                    <button
                      class="rounded-xl border p-3 text-left transition-colors"
                      :class="
                        settings.wrapLines
                          ? 'border-terra-border bg-terra-soft'
                          : 'border-border bg-canvas-subtle hover:bg-canvas-elevated/60'
                      "
                      @click="settings.setWrapLines(true)"
                    >
                      <p class="text-xs font-semibold text-ink">Wrap lines</p>
                      <p class="mt-1 text-[11px] text-ink-muted">
                        Soft-wrap long lines to fit the viewer width.
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- GITHUB -->
            <template v-else-if="settings.activeSection === 'github'">
              <div class="space-y-4">
                <p class="text-xs leading-relaxed text-ink-muted">
                  Sign in with your local <code class="font-mono text-ink">gh</code> CLI session or
                  enter a GitHub Personal Access Token (PAT) with
                  <code class="font-mono text-ink">repo</code> and
                  <code class="font-mono text-ink">read:user</code> scopes.
                </p>

                <div v-if="isTauriRuntime()">
                  <button
                    class="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-terra-border bg-terra-soft px-3 py-2 text-xs font-semibold text-terra-text transition-colors hover:bg-terra hover:text-white disabled:opacity-50"
                    :disabled="auth.isLoading"
                    @click="handleSignInWithGh"
                  >
                    <Loader2 v-if="auth.isLoading" class="h-3.5 w-3.5 animate-spin" />
                    <Terminal v-else class="h-3.5 w-3.5" />
                    <span>Use GitHub CLI (gh auth token)</span>
                  </button>
                  <div class="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-faint">
                    <span class="h-px flex-1 bg-border-muted" />
                    <span>or paste PAT</span>
                    <span class="h-px flex-1 bg-border-muted" />
                  </div>
                </div>

                <div class="space-y-1.5">
                  <label class="flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
                    <Globe class="h-3.5 w-3.5 text-ink-muted" />
                    <span>GitHub Host</span>
                    <span class="font-normal text-ink-faint">(optional, for GitHub Enterprise)</span>
                  </label>
                  <input
                    v-model="githubHostInput"
                    type="text"
                    placeholder="github.com"
                    class="w-full rounded-xl border border-border bg-canvas-inset px-3 py-2 font-mono text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
                    @blur="handleSaveGithubHost"
                    @keydown.enter="handleSaveGithubHost"
                  />
                  <p class="text-[11px] leading-relaxed text-ink-faint">
                    Defaults to <code class="font-mono text-ink-muted">github.com</code>. Custom
                    GitHub Enterprise hosts use <code class="font-mono text-ink-muted">/api/graphql</code>
                    and <code class="font-mono text-ink-muted">/api/v3</code>, and require allowing
                    <code class="font-mono text-ink-muted">https://&lt;host&gt;/**</code> in
                    <code class="font-mono text-ink-muted">src-tauri/capabilities/default.json</code>
                    (<code class="font-mono text-ink-muted">http:default</code>) for desktop builds.
                  </p>
                </div>

                <div class="space-y-1.5">
                  <label class="block text-xs font-medium text-ink-secondary">
                    Personal Access Token
                  </label>
                  <div class="relative">
                    <input
                      v-model="tokenInput"
                      :type="showToken ? 'text' : 'password'"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      class="w-full rounded-xl border border-border bg-canvas-inset py-2 pr-9 pl-3 font-mono text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
                      @keydown.enter="handleSavePat"
                    />
                    <button
                      type="button"
                      class="absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-faint hover:text-ink"
                      :title="showToken ? 'Hide token' : 'Show token'"
                      @click="showToken = !showToken"
                    >
                      <EyeOff v-if="showToken" class="h-3.5 w-3.5" />
                      <Eye v-else class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  v-if="auth.error"
                  class="rounded-xl border border-crimson-border bg-crimson-soft px-3 py-2 text-xs text-crimson-text"
                >
                  {{ auth.error }}
                </div>

                <div
                  v-if="auth.viewer"
                  class="flex items-center justify-between rounded-xl border border-pine-border bg-pine-soft px-3 py-2 text-xs text-pine-text"
                >
                  <span class="flex items-center gap-2">
                    <CheckCircle2 class="h-4 w-4" />
                    Signed in as <strong class="font-mono">@{{ auth.viewer.login }}</strong>
                  </span>
                  <button
                    class="inline-flex items-center gap-1 text-ink-muted hover:text-crimson-text"
                    @click="auth.clearPat()"
                  >
                    <LogOut class="h-3.5 w-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>

                <div class="flex justify-end pt-1">
                  <button
                    class="inline-flex items-center gap-1.5 rounded-xl bg-terra px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-terra-hover disabled:opacity-40"
                    :disabled="auth.isLoading || !tokenInput.trim()"
                    @click="handleSavePat"
                  >
                    <Loader2 v-if="auth.isLoading" class="h-3.5 w-3.5 animate-spin" />
                    <span>Verify & Save</span>
                  </button>
                </div>
              </div>
            </template>

            <!-- LOCAL & GIT -->
            <template v-else-if="settings.activeSection === 'repositories'">
              <div class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-xs font-medium text-ink">Local Repository Checkouts</p>
                    <p class="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                      Map <code class="font-mono text-ink">owner/repo</code> to a local git checkout for
                      Tree-sitter unchanged-file symbol resolution and
                      <code class="font-mono text-ink">git blame</code> on hover.
                    </p>
                  </div>
                  <span
                    v-if="!isTauriRuntime()"
                    class="shrink-0 rounded-md border border-border bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted"
                  >
                    Desktop-only
                  </span>
                </div>

                <div v-if="linkedRepos.length > 0" class="max-h-40 space-y-1.5 overflow-y-auto">
                  <div
                    v-for="[ownerRepo, localPath] in linkedRepos"
                    :key="ownerRepo"
                    class="flex items-center justify-between gap-2 rounded-xl border border-border-muted bg-canvas px-3 py-2 text-[11px]"
                  >
                    <div class="min-w-0">
                      <div class="font-mono font-semibold text-ink">{{ ownerRepo }}</div>
                      <div class="truncate font-mono text-[10px] text-ink-muted">{{ localPath }}</div>
                    </div>
                    <button
                      class="shrink-0 rounded-lg p-1 text-ink-faint hover:bg-canvas-elevated hover:text-crimson-text"
                      title="Unlink repository"
                      @click="review.unlinkRepoPath(ownerRepo)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  v-else
                  class="rounded-xl border border-dashed border-border bg-canvas/50 p-4 text-center text-[11px] text-ink-faint"
                >
                  No local checkouts linked yet.
                </div>

                <div class="space-y-2 rounded-xl border border-border bg-canvas/60 p-3.5">
                  <div class="flex flex-col gap-2 sm:flex-row">
                    <input
                      v-model="repoInput"
                      type="text"
                      placeholder="owner/repo"
                      class="rounded-xl border border-border bg-canvas-inset px-2.5 py-1.5 font-mono text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none sm:w-40"
                    />
                    <div class="flex min-w-0 flex-1 gap-1.5">
                      <input
                        v-model="pathInput"
                        type="text"
                        placeholder="/path/to/local/checkout"
                        class="min-w-0 flex-1 rounded-xl border border-border bg-canvas-inset px-2.5 py-1.5 font-mono text-xs text-ink placeholder-ink-faint focus:border-terra focus:outline-none"
                        @blur="validateAndInspectLocalPath(pathInput)"
                        @keydown.enter="handleLinkRepo"
                      />
                      <button
                        v-if="isTauriRuntime()"
                        type="button"
                        class="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-canvas-subtle px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-canvas-elevated"
                        title="Choose local repository folder"
                        @click="handleBrowseLocalRepo"
                      >
                        <FolderOpen class="h-3.5 w-3.5" />
                        <span>Browse…</span>
                      </button>
                    </div>
                  </div>

                  <p
                    v-if="pathValidationError"
                    class="flex items-center gap-1.5 text-[11px] text-crimson-text"
                  >
                    <AlertCircle class="h-3.5 w-3.5 shrink-0" />
                    <span>{{ pathValidationError }}</span>
                  </p>
                  <p
                    v-else-if="detectedOwnerRepo"
                    class="flex items-center gap-1.5 text-[11px] text-pine-text"
                  >
                    <CheckCircle2 class="h-3.5 w-3.5 shrink-0" />
                    <span>Detected remote <strong class="font-mono">{{ detectedOwnerRepo }}</strong></span>
                  </p>

                  <div class="flex items-center justify-between">
                    <button
                      v-if="activePRRepo"
                      class="text-[11px] text-terra-text hover:underline"
                      @click="repoInput = activePRRepo"
                    >
                      Use current PR ({{ activePRRepo }})
                    </button>
                    <span v-else />
                    <button
                      class="inline-flex items-center gap-1 rounded-xl border border-border bg-canvas-subtle px-2.5 py-1 text-xs font-medium text-ink-secondary hover:bg-canvas-elevated disabled:opacity-40"
                      :disabled="
                        !repoInput.trim() ||
                        !pathInput.trim() ||
                        Boolean(pathValidationError) ||
                        isInspectingPath
                      "
                      @click="handleLinkRepo"
                    >
                      <Loader2 v-if="isInspectingPath" class="h-3.5 w-3.5 animate-spin" />
                      <Plus v-else class="h-3.5 w-3.5" />
                      <span>Link Checkout</span>
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- UPDATES -->
            <template v-else-if="settings.activeSection === 'updates'">
              <div class="space-y-4">
                <div class="rounded-xl border border-border bg-canvas/60 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-medium text-ink">Stroll<template v-if="appVersion"> v{{ appVersion }}</template></p>
                      <p v-if="updateState === 'up-to-date'" class="mt-0.5 text-[11px] text-pine-text">
                        You're on the latest version.
                      </p>
                      <p
                        v-else-if="updateState === 'available' && availableUpdate"
                        class="mt-0.5 text-[11px] text-terra-text"
                      >
                        Version v{{ availableUpdate.version }} is available.
                      </p>
                      <p v-else-if="updateState === 'installing'" class="mt-0.5 text-[11px] text-ink-muted">
                        {{ updateMessage }}
                      </p>
                      <p v-else-if="updateState === 'error'" class="mt-0.5 text-[11px] text-ochre-text">
                        {{ updateMessage }}
                      </p>
                      <p v-else class="mt-0.5 text-[11px] text-ink-muted">
                        Check for new desktop releases and install updates automatically.
                      </p>
                    </div>

                    <button
                      v-if="updateState === 'available'"
                      type="button"
                      class="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-terra px-3 py-1.5 text-xs font-semibold text-white hover:bg-terra-hover"
                      @click="handleInstallUpdate"
                    >
                      <Download class="h-3.5 w-3.5" />
                      <span>Install &amp; Restart</span>
                    </button>
                    <button
                      v-else
                      type="button"
                      class="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-canvas-subtle px-3 py-1.5 text-xs text-ink-secondary hover:bg-canvas-elevated disabled:opacity-50"
                      :disabled="updateState === 'checking' || updateState === 'installing'"
                      @click="handleCheckForUpdates"
                    >
                      <Loader2
                        v-if="updateState === 'checking' || updateState === 'installing'"
                        class="h-3.5 w-3.5 animate-spin"
                      />
                      <RefreshCw v-else class="h-3.5 w-3.5" />
                      <span>Check for Updates</span>
                    </button>
                  </div>
                </div>

                <div
                  v-if="(updateState === 'available' || updateState === 'installing') && availableUpdate"
                  class="rounded-xl border border-border bg-canvas/60 p-4"
                >
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <p class="text-xs font-medium text-ink">What's new</p>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
                      @click="openExternalUrl(RELEASES_PAGE_URL)"
                    >
                      <span>All releases</span>
                      <ExternalLink class="h-3 w-3" />
                    </button>
                  </div>

                  <div v-if="isLoadingReleaseNotes" class="flex items-center gap-2 text-[11px] text-ink-muted">
                    <Loader2 class="h-3.5 w-3.5 animate-spin" />
                    <span>Loading release notes...</span>
                  </div>
                  <p v-else-if="releaseNotes.length === 0" class="text-[11px] text-ink-muted">
                    No release notes available for v{{ availableUpdate.version }}.
                  </p>
                  <div v-else class="max-h-80 space-y-4 overflow-y-auto pr-1">
                    <section
                      v-for="note in releaseNotes"
                      :key="note.version"
                      class="border-b border-border pb-4 last:border-b-0 last:pb-0"
                    >
                      <div class="mb-1.5 flex items-baseline justify-between gap-3">
                        <button
                          type="button"
                          class="text-xs font-semibold text-ink hover:underline"
                          @click="openExternalUrl(note.url)"
                        >
                          v{{ note.version }}
                        </button>
                        <span v-if="note.publishedAt" class="text-[11px] text-ink-muted">
                          {{ formatReleaseDate(note.publishedAt) }}
                        </span>
                      </div>
                      <MarkdownContent
                        v-if="note.body"
                        :content="note.body"
                        class="text-xs text-ink-secondary"
                      />
                      <p v-else class="text-[11px] text-ink-muted">No notes for this release.</p>
                    </section>
                  </div>
                </div>
              </div>
            </template>

            <!-- SHORTCUTS -->
            <template v-else-if="settings.activeSection === 'shortcuts'">
              <div class="divide-y divide-border-muted rounded-xl border border-border bg-canvas/60">
                <div
                  v-for="row in shortcutRows"
                  :key="row.description"
                  class="flex items-center justify-between gap-4 px-4 py-2.5 text-xs"
                >
                  <span class="text-ink-secondary">{{ row.description }}</span>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <kbd
                      v-for="k in row.keys"
                      :key="k"
                      class="rounded-md border border-border bg-canvas-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink"
                    >
                      {{ k }}
                    </kbd>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
