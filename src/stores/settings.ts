import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { normalizeGitHubHost, setGitHubHost as syncGitHubHost } from '@/services/github'
import {
  loadAppSettings,
  loadOnboardingCompleted,
  loadTourDirection,
  saveAppSettings,
  saveOnboardingCompleted,
  saveTourDirection,
  type HistoryOrder,
  type PersistedAppSettings,
  type ThemeMode,
} from '@/services/storage'
import type { DiffViewMode, LocalEditor, TourDirection } from '@/types/pr'

export type { HistoryOrder, ThemeMode }

export type SettingsSection =
  | 'general'
  | 'tour'
  | 'diff'
  | 'github'
  | 'repositories'
  | 'updates'
  | 'shortcuts'

export interface AppSettings extends PersistedAppSettings {
  defaultTourDirection: TourDirection
}

export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 560

/** Rounds and clamps a sidebar width (px) into the supported range. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_APP_SETTINGS.sidebarWidth
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'light',
  defaultTourDirection: 'bottom-up',
  autoAdvanceOnReview: false,
  sidebarDefaultOpen: true,
  sidebarWidth: 288,
  codeFontSize: 12.5,
  requireAltForHover: false,
  wrapLines: false,
  diffViewMode: 'unified',
  localEditor: 'vscode',
  showShortcutsBar: true,
  inboxAutoRefreshSeconds: 60,
  inboxNotificationsEnabled: false,
  githubHost: 'github.com',
  historyOrder: 'newest',
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useSettingsStore = defineStore('settings', () => {
  const isOpen = ref(false)
  const activeSection = ref<SettingsSection>('general')
  const initialized = ref(false)
  const onboardingCompleted = ref(false)

  const theme = ref<ThemeMode>(DEFAULT_APP_SETTINGS.theme)
  const systemPrefersDark = ref<boolean>(getSystemPrefersDark())
  const defaultTourDirection = ref<TourDirection>(DEFAULT_APP_SETTINGS.defaultTourDirection)
  const autoAdvanceOnReview = ref<boolean>(DEFAULT_APP_SETTINGS.autoAdvanceOnReview)
  const sidebarDefaultOpen = ref<boolean>(DEFAULT_APP_SETTINGS.sidebarDefaultOpen)
  const sidebarWidth = ref<number>(DEFAULT_APP_SETTINGS.sidebarWidth)
  const codeFontSize = ref<number>(DEFAULT_APP_SETTINGS.codeFontSize)
  const requireAltForHover = ref<boolean>(DEFAULT_APP_SETTINGS.requireAltForHover)
  const wrapLines = ref<boolean>(DEFAULT_APP_SETTINGS.wrapLines)
  const diffViewMode = ref<DiffViewMode>(DEFAULT_APP_SETTINGS.diffViewMode)
  const localEditor = ref<LocalEditor>(DEFAULT_APP_SETTINGS.localEditor)
  const showShortcutsBar = ref<boolean>(DEFAULT_APP_SETTINGS.showShortcutsBar)
  const inboxAutoRefreshSeconds = ref<number>(DEFAULT_APP_SETTINGS.inboxAutoRefreshSeconds)
  const inboxNotificationsEnabled = ref<boolean>(DEFAULT_APP_SETTINGS.inboxNotificationsEnabled)
  const githubHost = ref<string>(DEFAULT_APP_SETTINGS.githubHost)
  const historyOrder = ref<HistoryOrder>(DEFAULT_APP_SETTINGS.historyOrder)

  const resolvedTheme = computed<'light' | 'dark'>(() => {
    if (theme.value === 'system') {
      return systemPrefersDark.value ? 'dark' : 'light'
    }
    return theme.value
  })

  function applyThemeToDom(): void {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', resolvedTheme.value === 'dark')
  }

  let mediaQueryBound = false
  function bindSystemThemeListener(): void {
    if (mediaQueryBound || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark.value = mq.matches
    mq.addEventListener?.('change', (e) => {
      systemPrefersDark.value = e.matches
      applyThemeToDom()
    })
    mediaQueryBound = true
  }

  async function init(): Promise<void> {
    if (initialized.value) return
    bindSystemThemeListener()
    const [savedDirection, savedSettings, savedOnboarding] = await Promise.all([
      loadTourDirection(),
      loadAppSettings(),
      loadOnboardingCompleted(),
    ])
    onboardingCompleted.value = savedOnboarding
    defaultTourDirection.value = savedDirection
    if (
      savedSettings.theme === 'light' ||
      savedSettings.theme === 'dark' ||
      savedSettings.theme === 'system'
    ) {
      theme.value = savedSettings.theme
    }
    if (typeof savedSettings.autoAdvanceOnReview === 'boolean') {
      autoAdvanceOnReview.value = savedSettings.autoAdvanceOnReview
    }
    if (typeof savedSettings.sidebarDefaultOpen === 'boolean') {
      sidebarDefaultOpen.value = savedSettings.sidebarDefaultOpen
    }
    if (typeof savedSettings.sidebarWidth === 'number') {
      sidebarWidth.value = clampSidebarWidth(savedSettings.sidebarWidth)
    }
    if (typeof savedSettings.codeFontSize === 'number') {
      codeFontSize.value = savedSettings.codeFontSize
    }
    if (typeof savedSettings.requireAltForHover === 'boolean') {
      requireAltForHover.value = savedSettings.requireAltForHover
    }
    if (typeof savedSettings.wrapLines === 'boolean') {
      wrapLines.value = savedSettings.wrapLines
    }
    if (savedSettings.diffViewMode === 'unified' || savedSettings.diffViewMode === 'split') {
      diffViewMode.value = savedSettings.diffViewMode
    }
    if (
      savedSettings.localEditor === 'vscode' ||
      savedSettings.localEditor === 'cursor' ||
      savedSettings.localEditor === 'zed'
    ) {
      localEditor.value = savedSettings.localEditor
    }
    if (typeof savedSettings.showShortcutsBar === 'boolean') {
      showShortcutsBar.value = savedSettings.showShortcutsBar
    }
    if (typeof savedSettings.inboxAutoRefreshSeconds === 'number') {
      inboxAutoRefreshSeconds.value = savedSettings.inboxAutoRefreshSeconds
    }
    if (typeof savedSettings.inboxNotificationsEnabled === 'boolean') {
      inboxNotificationsEnabled.value = savedSettings.inboxNotificationsEnabled
    }
    if (typeof savedSettings.githubHost === 'string') {
      githubHost.value = normalizeGitHubHost(savedSettings.githubHost)
    }
    if (savedSettings.historyOrder === 'newest' || savedSettings.historyOrder === 'oldest') {
      historyOrder.value = savedSettings.historyOrder
    }
    syncGitHubHost(githubHost.value)
    applyThemeToDom()
    initialized.value = true
  }

  async function persist(): Promise<void> {
    await Promise.all([
      saveTourDirection(defaultTourDirection.value),
      saveAppSettings({
        theme: theme.value,
        autoAdvanceOnReview: autoAdvanceOnReview.value,
        sidebarDefaultOpen: sidebarDefaultOpen.value,
        sidebarWidth: sidebarWidth.value,
        codeFontSize: codeFontSize.value,
        requireAltForHover: requireAltForHover.value,
        wrapLines: wrapLines.value,
        diffViewMode: diffViewMode.value,
        localEditor: localEditor.value,
        showShortcutsBar: showShortcutsBar.value,
        inboxAutoRefreshSeconds: inboxAutoRefreshSeconds.value,
        inboxNotificationsEnabled: inboxNotificationsEnabled.value,
        githubHost: githubHost.value,
        historyOrder: historyOrder.value,
      }),
    ])
  }

  /** `owner/repo` to prefill in the Repositories section the next time Settings opens. */
  const linkRepoPrefill = ref<string | null>(null)

  function openSettings(section: SettingsSection = 'general', options: { linkRepo?: string } = {}): void {
    activeSection.value = section
    linkRepoPrefill.value = options.linkRepo ?? null
    isOpen.value = true
  }

  async function completeOnboarding(): Promise<void> {
    if (onboardingCompleted.value) return
    onboardingCompleted.value = true
    await saveOnboardingCompleted(true)
  }

  function closeSettings(): void {
    isOpen.value = false
  }

  async function setTheme(mode: ThemeMode): Promise<void> {
    theme.value = mode
    applyThemeToDom()
    await persist()
  }

  async function toggleTheme(): Promise<void> {
    const next: ThemeMode = resolvedTheme.value === 'dark' ? 'light' : 'dark'
    await setTheme(next)
  }

  async function setDefaultTourDirection(direction: TourDirection): Promise<void> {
    defaultTourDirection.value = direction
    await saveTourDirection(direction)
  }

  async function setAutoAdvanceOnReview(enabled: boolean): Promise<void> {
    autoAdvanceOnReview.value = enabled
    await persist()
  }

  async function setSidebarDefaultOpen(open: boolean): Promise<void> {
    sidebarDefaultOpen.value = open
    await persist()
  }

  /**
   * Sets the tour sidebar width. Pass `persist: false` for live updates while
   * dragging, then persist once on release.
   */
  async function setSidebarWidth(width: number, options: { persist?: boolean } = {}): Promise<void> {
    sidebarWidth.value = clampSidebarWidth(width)
    if (options.persist !== false) await persist()
  }

  async function setCodeFontSize(size: number): Promise<void> {
    codeFontSize.value = size
    await persist()
  }

  async function setRequireAltForHover(required: boolean): Promise<void> {
    requireAltForHover.value = required
    await persist()
  }

  async function setWrapLines(enabled: boolean): Promise<void> {
    wrapLines.value = enabled
    await persist()
  }

  async function setDiffViewMode(mode: DiffViewMode): Promise<void> {
    diffViewMode.value = mode
    await persist()
  }

  async function setLocalEditor(editor: LocalEditor): Promise<void> {
    localEditor.value = editor
    await persist()
  }

  async function setShowShortcutsBar(visible: boolean): Promise<void> {
    showShortcutsBar.value = visible
    await persist()
  }

  async function setInboxAutoRefreshSeconds(seconds: number): Promise<void> {
    inboxAutoRefreshSeconds.value = seconds
    await persist()
  }

  async function setInboxNotificationsEnabled(enabled: boolean): Promise<void> {
    inboxNotificationsEnabled.value = enabled
    await persist()
  }

  async function setGithubHost(host: string): Promise<void> {
    const normalized = normalizeGitHubHost(host)
    githubHost.value = normalized
    syncGitHubHost(normalized)
    await persist()
  }

  async function setHistoryOrder(order: HistoryOrder): Promise<void> {
    historyOrder.value = order
    await persist()
  }

  async function toggleHistoryOrder(): Promise<void> {
    await setHistoryOrder(historyOrder.value === 'newest' ? 'oldest' : 'newest')
  }

  async function resetToDefaults(): Promise<void> {
    theme.value = DEFAULT_APP_SETTINGS.theme
    defaultTourDirection.value = DEFAULT_APP_SETTINGS.defaultTourDirection
    autoAdvanceOnReview.value = DEFAULT_APP_SETTINGS.autoAdvanceOnReview
    sidebarDefaultOpen.value = DEFAULT_APP_SETTINGS.sidebarDefaultOpen
    sidebarWidth.value = DEFAULT_APP_SETTINGS.sidebarWidth
    codeFontSize.value = DEFAULT_APP_SETTINGS.codeFontSize
    requireAltForHover.value = DEFAULT_APP_SETTINGS.requireAltForHover
    wrapLines.value = DEFAULT_APP_SETTINGS.wrapLines
    diffViewMode.value = DEFAULT_APP_SETTINGS.diffViewMode
    localEditor.value = DEFAULT_APP_SETTINGS.localEditor
    showShortcutsBar.value = DEFAULT_APP_SETTINGS.showShortcutsBar
    inboxAutoRefreshSeconds.value = DEFAULT_APP_SETTINGS.inboxAutoRefreshSeconds
    inboxNotificationsEnabled.value = DEFAULT_APP_SETTINGS.inboxNotificationsEnabled
    githubHost.value = DEFAULT_APP_SETTINGS.githubHost
    historyOrder.value = DEFAULT_APP_SETTINGS.historyOrder
    syncGitHubHost(githubHost.value)
    applyThemeToDom()
    await persist()
  }

  return {
    isOpen,
    linkRepoPrefill,
    activeSection,
    theme,
    initialized,
    onboardingCompleted,
    completeOnboarding,
    resolvedTheme,
    defaultTourDirection,
    autoAdvanceOnReview,
    sidebarDefaultOpen,
    sidebarWidth,
    codeFontSize,
    requireAltForHover,
    wrapLines,
    diffViewMode,
    localEditor,
    showShortcutsBar,
    inboxAutoRefreshSeconds,
    inboxNotificationsEnabled,
    githubHost,
    historyOrder,
    init,
    openSettings,
    closeSettings,
    setTheme,
    toggleTheme,
    setDefaultTourDirection,
    setAutoAdvanceOnReview,
    setSidebarDefaultOpen,
    setSidebarWidth,
    setCodeFontSize,
    setRequireAltForHover,
    setWrapLines,
    setDiffViewMode,
    setLocalEditor,
    setShowShortcutsBar,
    setInboxAutoRefreshSeconds,
    setInboxNotificationsEnabled,
    setGithubHost,
    setHistoryOrder,
    toggleHistoryOrder,
    resetToDefaults,
  }
})
