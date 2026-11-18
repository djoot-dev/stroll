import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  loadAppSettings,
  loadTourDirection,
  saveAppSettings,
  saveTourDirection,
  type PersistedAppSettings,
} from '@/services/storage'
import type { TourDirection } from '@/types/pr'

export type SettingsSection = 'general' | 'tour' | 'diff' | 'github' | 'shortcuts'

export interface AppSettings extends PersistedAppSettings {
  defaultTourDirection: TourDirection
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultTourDirection: 'bottom-up',
  autoAdvanceOnReview: false,
  sidebarDefaultOpen: true,
  codeFontSize: 12.5,
  requireAltForHover: false,
  showShortcutsBar: true,
  inboxAutoRefreshSeconds: 60,
}

export const useSettingsStore = defineStore('settings', () => {
  const isOpen = ref(false)
  const activeSection = ref<SettingsSection>('general')
  const initialized = ref(false)

  const defaultTourDirection = ref<TourDirection>(DEFAULT_APP_SETTINGS.defaultTourDirection)
  const autoAdvanceOnReview = ref<boolean>(DEFAULT_APP_SETTINGS.autoAdvanceOnReview)
  const sidebarDefaultOpen = ref<boolean>(DEFAULT_APP_SETTINGS.sidebarDefaultOpen)
  const codeFontSize = ref<number>(DEFAULT_APP_SETTINGS.codeFontSize)
  const requireAltForHover = ref<boolean>(DEFAULT_APP_SETTINGS.requireAltForHover)
  const showShortcutsBar = ref<boolean>(DEFAULT_APP_SETTINGS.showShortcutsBar)
  const inboxAutoRefreshSeconds = ref<number>(DEFAULT_APP_SETTINGS.inboxAutoRefreshSeconds)

  async function init(): Promise<void> {
    if (initialized.value) return
    const [savedDirection, savedSettings] = await Promise.all([
      loadTourDirection(),
      loadAppSettings(),
    ])
    defaultTourDirection.value = savedDirection
    if (typeof savedSettings.autoAdvanceOnReview === 'boolean') {
      autoAdvanceOnReview.value = savedSettings.autoAdvanceOnReview
    }
    if (typeof savedSettings.sidebarDefaultOpen === 'boolean') {
      sidebarDefaultOpen.value = savedSettings.sidebarDefaultOpen
    }
    if (typeof savedSettings.codeFontSize === 'number') {
      codeFontSize.value = savedSettings.codeFontSize
    }
    if (typeof savedSettings.requireAltForHover === 'boolean') {
      requireAltForHover.value = savedSettings.requireAltForHover
    }
    if (typeof savedSettings.showShortcutsBar === 'boolean') {
      showShortcutsBar.value = savedSettings.showShortcutsBar
    }
    if (typeof savedSettings.inboxAutoRefreshSeconds === 'number') {
      inboxAutoRefreshSeconds.value = savedSettings.inboxAutoRefreshSeconds
    }
    initialized.value = true
  }

  async function persist(): Promise<void> {
    await Promise.all([
      saveTourDirection(defaultTourDirection.value),
      saveAppSettings({
        autoAdvanceOnReview: autoAdvanceOnReview.value,
        sidebarDefaultOpen: sidebarDefaultOpen.value,
        codeFontSize: codeFontSize.value,
        requireAltForHover: requireAltForHover.value,
        showShortcutsBar: showShortcutsBar.value,
        inboxAutoRefreshSeconds: inboxAutoRefreshSeconds.value,
      }),
    ])
  }

  function openSettings(section: SettingsSection = 'general'): void {
    activeSection.value = section
    isOpen.value = true
  }

  function closeSettings(): void {
    isOpen.value = false
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

  async function setCodeFontSize(size: number): Promise<void> {
    codeFontSize.value = size
    await persist()
  }

  async function setRequireAltForHover(required: boolean): Promise<void> {
    requireAltForHover.value = required
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

  async function resetToDefaults(): Promise<void> {
    defaultTourDirection.value = DEFAULT_APP_SETTINGS.defaultTourDirection
    autoAdvanceOnReview.value = DEFAULT_APP_SETTINGS.autoAdvanceOnReview
    sidebarDefaultOpen.value = DEFAULT_APP_SETTINGS.sidebarDefaultOpen
    codeFontSize.value = DEFAULT_APP_SETTINGS.codeFontSize
    requireAltForHover.value = DEFAULT_APP_SETTINGS.requireAltForHover
    showShortcutsBar.value = DEFAULT_APP_SETTINGS.showShortcutsBar
    inboxAutoRefreshSeconds.value = DEFAULT_APP_SETTINGS.inboxAutoRefreshSeconds
    await persist()
  }

  return {
    isOpen,
    activeSection,
    defaultTourDirection,
    autoAdvanceOnReview,
    sidebarDefaultOpen,
    codeFontSize,
    requireAltForHover,
    showShortcutsBar,
    inboxAutoRefreshSeconds,
    init,
    openSettings,
    closeSettings,
    setDefaultTourDirection,
    setAutoAdvanceOnReview,
    setSidebarDefaultOpen,
    setCodeFontSize,
    setRequireAltForHover,
    setShowShortcutsBar,
    setInboxAutoRefreshSeconds,
    resetToDefaults,
  }
})
