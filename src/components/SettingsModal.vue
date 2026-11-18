<script setup lang="ts">
import { getVersion } from '@tauri-apps/api/app'
import {
  CheckCircle2,
  Code2,
  Download,
  Eye,
  EyeOff,
  FolderGit2,
  Keyboard,
  KeyRound,
  ListOrdered,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Terminal,
  Trash2,
  X,
} from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { isTauriRuntime } from '@/services/native'
import { checkForAppUpdate, type AvailableUpdate } from '@/services/updater'
import { useAuthStore } from '@/stores/auth'
import { useReviewStore } from '@/stores/review'
import { useSettingsStore, type SettingsSection } from '@/stores/settings'
import type { TourDirection } from '@/types/pr'

const auth = useAuthStore()
const review = useReviewStore()
const settings = useSettingsStore()

const tokenInput = ref(auth.pat)
const showToken = ref(false)
const resetDone = ref(false)
const repoInput = ref('')
const pathInput = ref('')
const appVersion = ref('0.1.0')
const updateState = ref<'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error'>('idle')
const availableUpdate = ref<AvailableUpdate | null>(null)
const updateMessage = ref('')

const linkedRepos = computed(() => Object.entries(review.repoPaths))
const activePRRepo = computed(() =>
  review.pr ? `${review.pr.owner}/${review.pr.repo}` : '',
)

onMounted(async () => {
  if (isTauriRuntime()) {
    try {
      appVersion.value = await getVersion()
    } catch {
      // Fallback to default version
    }
  }
})

async function handleCheckForUpdates() {
  updateState.value = 'checking'
  updateMessage.value = ''
  availableUpdate.value = null
  try {
    const result = await checkForAppUpdate()
    if (result.available) {
      availableUpdate.value = result
      updateState.value = 'available'
    } else {
      updateState.value = 'up-to-date'
    }
  } catch (err) {
    updateState.value = 'error'
    updateMessage.value = err instanceof Error ? err.message : 'Unable to check for updates.'
  }
}

async function handleInstallUpdate() {
  if (!availableUpdate.value) return
  updateState.value = 'installing'
  updateMessage.value = 'Downloading update...'
  try {
    await availableUpdate.value.install((downloaded, total) => {
      if (total && total > 0) {
        const pct = Math.round((downloaded / total) * 100)
        updateMessage.value = `Downloading update (${pct}%)...`
      }
    })
  } catch (err) {
    updateState.value = 'error'
    updateMessage.value = err instanceof Error ? err.message : 'Failed to install update.'
  }
}

watch(
  () => settings.isOpen,
  (open) => {
    if (open) {
      tokenInput.value = auth.pat
      showToken.value = false
      resetDone.value = false
      if (!repoInput.value && activePRRepo.value) {
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
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
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
  await auth.verifyAndLoadProfile(tokenInput.value.trim())
}

async function handleSignInWithGh() {
  const ok = await auth.signInWithGh()
  if (ok) {
    tokenInput.value = auth.pat
  }
}

async function handleLinkRepo() {
  if (!repoInput.value.trim() || !pathInput.value.trim()) return
  await review.linkRepoPath(repoInput.value, pathInput.value)
  repoInput.value = ''
  pathInput.value = ''
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
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      @click.self="settings.closeSettings()"
    >
      <div
        class="flex h-[540px] max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-canvas-subtle shadow-2xl sm:flex-row"
      >
        <!-- Sidebar Navigation -->
        <aside
          class="flex shrink-0 flex-col border-b border-border bg-canvas-inset/60 sm:w-48 sm:border-r sm:border-b-0"
        >
          <div class="flex items-center justify-between px-4 py-3.5 sm:border-b sm:border-border-muted">
            <div class="flex items-center gap-2">
              <Settings class="h-4 w-4 text-blue-400" />
              <span class="text-sm font-semibold text-slate-100">Settings</span>
            </div>
            <button
              class="rounded p-1 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100 sm:hidden"
              @click="settings.closeSettings()"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          <nav class="flex gap-1 overflow-x-auto px-2 pb-2 sm:flex-1 sm:flex-col sm:p-2">
            <button
              v-for="item in navItems"
              :key="item.id"
              class="flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors"
              :class="
                settings.activeSection === item.id
                  ? 'bg-blue-500/15 text-blue-300'
                  : 'text-slate-400 hover:bg-canvas-elevated/70 hover:text-slate-200'
              "
              @click="settings.activeSection = item.id"
            >
              <span class="flex items-center gap-2">
                <component :is="item.icon" class="h-3.5 w-3.5 shrink-0" />
                <span>{{ item.label }}</span>
              </span>
              <span
                v-if="item.badge?.()"
                class="hidden h-1.5 w-1.5 rounded-full bg-emerald-400 sm:inline-block"
                :title="item.badge() ?? ''"
              />
            </button>
          </nav>

          <div class="hidden border-t border-border-muted px-4 py-2.5 text-[10px] text-slate-500 sm:block">
            PR Tour v{{ appVersion }}
          </div>
        </aside>

        <!-- Main Section Content -->
        <div class="flex min-w-0 flex-1 flex-col">
          <header
            class="hidden items-center justify-between border-b border-border px-5 py-3.5 sm:flex"
          >
            <h2 class="text-sm font-semibold text-slate-100">{{ activeSectionTitle }}</h2>
            <button
              class="rounded p-1 text-slate-400 hover:bg-canvas-elevated hover:text-slate-100"
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
                <div class="rounded-lg border border-border bg-canvas/60 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-medium text-slate-200">Application Updates</p>
                      <p v-if="updateState === 'up-to-date'" class="mt-0.5 text-[11px] text-emerald-400">
                        PR Tour v{{ appVersion }} is up to date.
                      </p>
                      <p v-else-if="updateState === 'available' && availableUpdate" class="mt-0.5 text-[11px] text-blue-400">
                        Version v{{ availableUpdate.version }} is available.
                      </p>
                      <p v-else-if="updateState === 'installing'" class="mt-0.5 text-[11px] text-slate-400">
                        {{ updateMessage }}
                      </p>
                      <p v-else-if="updateState === 'error'" class="mt-0.5 text-[11px] text-amber-400">
                        {{ updateMessage }}
                      </p>
                      <p v-else class="mt-0.5 text-[11px] text-slate-400">
                        Installed version: v{{ appVersion }}
                      </p>
                    </div>
                    <button
                      v-if="updateState === 'available'"
                      type="button"
                      class="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/25"
                      @click="handleInstallUpdate"
                    >
                      <Download class="h-3.5 w-3.5" />
                      <span>Install &amp; Restart</span>
                    </button>
                    <button
                      v-else
                      type="button"
                      class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated disabled:opacity-50"
                      :disabled="updateState === 'checking' || updateState === 'installing'"
                      @click="handleCheckForUpdates"
                    >
                      <Loader2 v-if="updateState === 'checking' || updateState === 'installing'" class="h-3.5 w-3.5 animate-spin" />
                      <RefreshCw v-else class="h-3.5 w-3.5" />
                      <span>Check for Updates</span>
                    </button>
                  </div>
                </div>

                <div class="rounded-lg border border-border bg-canvas/60 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-medium text-slate-200">Inbox Auto-Refresh</p>
                      <p class="mt-0.5 text-[11px] text-slate-400">
                        Automatically poll GitHub for pending review requests while on the Inbox screen.
                      </p>
                    </div>
                    <div class="inline-flex rounded-lg border border-border bg-canvas-inset p-0.5">
                      <button
                        v-for="opt in refreshOptions"
                        :key="opt.value"
                        class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                        :class="
                          settings.inboxAutoRefreshSeconds === opt.value
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        "
                        @click="settings.setInboxAutoRefreshSeconds(opt.value)"
                      >
                        {{ opt.label }}
                      </button>
                    </div>
                  </div>
                </div>

                <label
                  class="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-canvas/60 p-4"
                >
                  <div>
                    <p class="text-xs font-medium text-slate-200">Show Keyboard Shortcuts Bar</p>
                    <p class="mt-0.5 text-[11px] text-slate-400">
                      Display the quick-reference shortcut bar at the bottom of the review screen.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    :checked="settings.showShortcutsBar"
                    class="h-4 w-4 rounded border-border bg-canvas-inset accent-blue-500"
                    @change="settings.setShowShortcutsBar(($event.target as HTMLInputElement).checked)"
                  />
                </label>

                <div class="rounded-lg border border-border-muted bg-canvas-inset/50 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-medium text-slate-300">Reset Preferences</p>
                      <p class="mt-0.5 text-[11px] text-slate-500">
                        Restore all tour, diff, and general settings to defaults. Your GitHub PAT is kept.
                      </p>
                    </div>
                    <button
                      class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated"
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
                <div class="rounded-lg border border-border bg-canvas/60 p-4">
                  <p class="text-xs font-medium text-slate-200">Default Reading Order</p>
                  <p class="mt-0.5 text-[11px] text-slate-400">
                    Controls how PR Tour orders files in the dependency graph.
                  </p>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      class="rounded-lg border p-3 text-left transition-colors"
                      :class="
                        settings.defaultTourDirection === 'bottom-up'
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-border bg-canvas-inset/60 hover:bg-canvas-elevated/60'
                      "
                      @click="handleDirectionChange('bottom-up')"
                    >
                      <p class="text-xs font-semibold text-slate-100">Bottom-Up</p>
                      <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
                        Start with config, types, and core foundations before UI and tests.
                      </p>
                    </button>

                    <button
                      class="rounded-lg border p-3 text-left transition-colors"
                      :class="
                        settings.defaultTourDirection === 'top-down'
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-border bg-canvas-inset/60 hover:bg-canvas-elevated/60'
                      "
                      @click="handleDirectionChange('top-down')"
                    >
                      <p class="text-xs font-semibold text-slate-100">Top-Down</p>
                      <p class="mt-1 text-[11px] leading-relaxed text-slate-400">
                        Start at entrypoints and UI components, drilling down into helpers.
                      </p>
                    </button>
                  </div>
                </div>

                <label
                  class="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-canvas/60 p-4"
                >
                  <div>
                    <p class="text-xs font-medium text-slate-200">Auto-Advance on Mark Reviewed</p>
                    <p class="mt-0.5 text-[11px] text-slate-400">
                      Automatically jump to the next unreviewed step after marking a file reviewed.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    :checked="settings.autoAdvanceOnReview"
                    class="h-4 w-4 rounded border-border bg-canvas-inset accent-blue-500"
                    @change="
                      settings.setAutoAdvanceOnReview(($event.target as HTMLInputElement).checked)
                    "
                  />
                </label>

                <label
                  class="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-canvas/60 p-4"
                >
                  <div>
                    <p class="text-xs font-medium text-slate-200">
                      Open Tour Outline Sidebar by Default
                    </p>
                    <p class="mt-0.5 text-[11px] text-slate-400">
                      Show the step outline sidebar automatically when opening a Pull Request.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    :checked="settings.sidebarDefaultOpen"
                    class="h-4 w-4 rounded border-border bg-canvas-inset accent-blue-500"
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
                <div class="rounded-lg border border-border bg-canvas/60 p-4">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p class="text-xs font-medium text-slate-200">Code Font Size</p>
                      <p class="mt-0.5 text-[11px] text-slate-400">
                        Adjusts the monospace font size in the diff viewer.
                      </p>
                    </div>
                    <div class="inline-flex rounded-lg border border-border bg-canvas-inset p-0.5">
                      <button
                        v-for="opt in fontSizeOptions"
                        :key="opt.value"
                        class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                        :class="
                          settings.codeFontSize === opt.value
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        "
                        @click="settings.setCodeFontSize(opt.value)"
                      >
                        {{ opt.label }}
                      </button>
                    </div>
                  </div>

                  <div
                    class="mt-3 overflow-hidden rounded-md border border-border-muted bg-canvas-inset p-2.5 font-mono leading-[1.55]"
                    :style="{ fontSize: `${settings.codeFontSize}px` }"
                  >
                    <div class="text-slate-500">  const order = buildReadingOrder(files, dir)</div>
                    <div class="bg-emerald-500/10 text-emerald-300">+ return order.filter((s) =&gt; !s.skipped)</div>
                  </div>
                </div>

                <div class="rounded-lg border border-border bg-canvas/60 p-4">
                  <p class="text-xs font-medium text-slate-200">Symbol Hover Popover</p>
                  <p class="mt-0.5 text-[11px] text-slate-400">
                    Choose how symbol definitions and PR context popovers are triggered in diffs.
                  </p>
                  <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      class="rounded-lg border p-3 text-left transition-colors"
                      :class="
                        !settings.requireAltForHover
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-border bg-canvas-inset/60 hover:bg-canvas-elevated/60'
                      "
                      @click="settings.setRequireAltForHover(false)"
                    >
                      <p class="text-xs font-semibold text-slate-100">Automatic (250ms)</p>
                      <p class="mt-1 text-[11px] text-slate-400">
                        Opens automatically when hovering an identifier.
                      </p>
                    </button>

                    <button
                      class="rounded-lg border p-3 text-left transition-colors"
                      :class="
                        settings.requireAltForHover
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-border bg-canvas-inset/60 hover:bg-canvas-elevated/60'
                      "
                      @click="settings.setRequireAltForHover(true)"
                    >
                      <p class="text-xs font-semibold text-slate-100">⌥ / Alt + Hover</p>
                      <p class="mt-1 text-[11px] text-slate-400">
                        Only opens while holding Option / Alt to avoid accidental popovers.
                      </p>
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- GITHUB -->
            <template v-else-if="settings.activeSection === 'github'">
              <div class="space-y-4">
                <p class="text-xs leading-relaxed text-slate-400">
                  Sign in with your local <code class="text-slate-200">gh</code> CLI session or
                  enter a GitHub Personal Access Token (PAT) with
                  <code class="text-slate-200">repo</code> and
                  <code class="text-slate-200">read:user</code> scopes.
                </p>

                <div v-if="isTauriRuntime()">
                  <button
                    class="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-500/20 disabled:opacity-50"
                    :disabled="auth.isLoading"
                    @click="handleSignInWithGh"
                  >
                    <Loader2 v-if="auth.isLoading" class="h-3.5 w-3.5 animate-spin" />
                    <Terminal v-else class="h-3.5 w-3.5" />
                    <span>Use GitHub CLI (gh auth token)</span>
                  </button>
                  <div class="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
                    <span class="h-px flex-1 bg-border-muted" />
                    <span>or paste PAT</span>
                    <span class="h-px flex-1 bg-border-muted" />
                  </div>
                </div>

                <div class="space-y-1.5">
                  <label class="block text-xs font-medium text-slate-300">
                    Personal Access Token
                  </label>
                  <div class="relative">
                    <input
                      v-model="tokenInput"
                      :type="showToken ? 'text' : 'password'"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      class="w-full rounded-lg border border-border bg-canvas-inset py-2 pr-9 pl-3 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                      @keydown.enter="handleSavePat"
                    />
                    <button
                      type="button"
                      class="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500 hover:text-slate-300"
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
                  class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
                >
                  {{ auth.error }}
                </div>

                <div
                  v-if="auth.viewer"
                  class="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300"
                >
                  <span class="flex items-center gap-2">
                    <CheckCircle2 class="h-4 w-4" />
                    Signed in as <strong class="font-mono">@{{ auth.viewer.login }}</strong>
                  </span>
                  <button
                    class="inline-flex items-center gap-1 text-slate-400 hover:text-rose-300"
                    @click="auth.clearPat()"
                  >
                    <LogOut class="h-3.5 w-3.5" />
                    <span>Sign out</span>
                  </button>
                </div>

                <div class="flex justify-end pt-1">
                  <button
                    class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
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
                    <p class="text-xs font-medium text-slate-200">Local Repository Checkouts</p>
                    <p class="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                      Map <code class="text-slate-300">owner/repo</code> to a local git checkout for
                      Tree-sitter unchanged-file symbol resolution and
                      <code class="text-slate-300">git blame</code> on hover.
                    </p>
                  </div>
                  <span
                    v-if="!isTauriRuntime()"
                    class="shrink-0 rounded border border-slate-700 bg-canvas px-1.5 py-0.5 text-[10px] text-slate-400"
                  >
                    Desktop-only
                  </span>
                </div>

                <div v-if="linkedRepos.length > 0" class="max-h-40 space-y-1.5 overflow-y-auto">
                  <div
                    v-for="[ownerRepo, localPath] in linkedRepos"
                    :key="ownerRepo"
                    class="flex items-center justify-between gap-2 rounded-lg border border-border-muted bg-canvas px-3 py-2 text-[11px]"
                  >
                    <div class="min-w-0">
                      <div class="font-mono font-semibold text-slate-200">{{ ownerRepo }}</div>
                      <div class="truncate font-mono text-[10px] text-slate-400">{{ localPath }}</div>
                    </div>
                    <button
                      class="shrink-0 rounded p-1 text-slate-500 hover:bg-canvas-elevated hover:text-rose-400"
                      title="Unlink repository"
                      @click="review.unlinkRepoPath(ownerRepo)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  v-else
                  class="rounded-lg border border-dashed border-border bg-canvas/40 p-4 text-center text-[11px] text-slate-500"
                >
                  No local checkouts linked yet.
                </div>

                <div class="space-y-2 rounded-lg border border-border bg-canvas/60 p-3.5">
                  <div class="flex flex-col gap-2 sm:flex-row">
                    <input
                      v-model="repoInput"
                      type="text"
                      placeholder="owner/repo"
                      class="rounded-lg border border-border bg-canvas-inset px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none sm:w-40"
                    />
                    <input
                      v-model="pathInput"
                      type="text"
                      placeholder="/path/to/local/checkout"
                      class="flex-1 rounded-lg border border-border bg-canvas-inset px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-blue-500 focus:outline-none"
                      @keydown.enter="handleLinkRepo"
                    />
                  </div>
                  <div class="flex items-center justify-between">
                    <button
                      v-if="activePRRepo"
                      class="text-[11px] text-blue-400 hover:text-blue-300"
                      @click="repoInput = activePRRepo"
                    >
                      Use current PR ({{ activePRRepo }})
                    </button>
                    <span v-else />
                    <button
                      class="inline-flex items-center gap-1 rounded-lg border border-border bg-canvas px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-canvas-elevated disabled:opacity-40"
                      :disabled="!repoInput.trim() || !pathInput.trim()"
                      @click="handleLinkRepo"
                    >
                      <Plus class="h-3.5 w-3.5" />
                      <span>Link Checkout</span>
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- SHORTCUTS -->
            <template v-else-if="settings.activeSection === 'shortcuts'">
              <div class="divide-y divide-border-muted rounded-lg border border-border bg-canvas/60">
                <div
                  v-for="row in shortcutRows"
                  :key="row.description"
                  class="flex items-center justify-between gap-4 px-4 py-2.5 text-xs"
                >
                  <span class="text-slate-300">{{ row.description }}</span>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <kbd
                      v-for="k in row.keys"
                      :key="k"
                      class="rounded border border-border bg-canvas-inset px-1.5 py-0.5 font-mono text-[11px] text-slate-200"
                    >
                      {{ k }}
                    </kbd>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div class="border-t border-border pt-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-xs font-medium text-slate-300">PR Tour v{{ appVersion }}</p>
              <p v-if="updateState === 'up-to-date'" class="text-[11px] text-emerald-400">
                You're on the latest version.
              </p>
              <p v-else-if="updateState === 'available' && availableUpdate" class="text-[11px] text-blue-400">
                Version v{{ availableUpdate.version }} is available.
              </p>
              <p v-else-if="updateState === 'installing'" class="text-[11px] text-slate-400">
                {{ updateMessage }}
              </p>
              <p v-else-if="updateState === 'error'" class="text-[11px] text-amber-400">
                {{ updateMessage }}
              </p>
            </div>

            <button
              v-if="updateState === 'available'"
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/25"
              @click="handleInstallUpdate"
            >
              <Download class="h-3.5 w-3.5" />
              <span>Install &amp; Restart</span>
            </button>
            <button
              v-else
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-slate-300 hover:bg-canvas-elevated disabled:opacity-50"
              :disabled="updateState === 'checking' || updateState === 'installing'"
              @click="handleCheckForUpdates"
            >
              <Loader2 v-if="updateState === 'checking' || updateState === 'installing'" class="h-3.5 w-3.5 animate-spin" />
              <RefreshCw v-else class="h-3.5 w-3.5" />
              <span>Check for Updates</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
