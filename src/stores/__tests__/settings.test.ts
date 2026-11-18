import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_SETTINGS, useSettingsStore } from '../settings'

function createMemoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => {
      data.clear()
    },
  }
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  it('initializes with default settings when storage is empty', async () => {
    const store = useSettingsStore()
    await store.init()

    expect(store.defaultTourDirection).toBe(DEFAULT_APP_SETTINGS.defaultTourDirection)
    expect(store.autoAdvanceOnReview).toBe(false)
    expect(store.sidebarDefaultOpen).toBe(true)
    expect(store.codeFontSize).toBe(12.5)
    expect(store.requireAltForHover).toBe(false)
    expect(store.showShortcutsBar).toBe(true)
    expect(store.inboxAutoRefreshSeconds).toBe(60)
  })

  it('persists updated settings and reloads them in a fresh store', async () => {
    const store = useSettingsStore()
    await store.init()

    await store.setDefaultTourDirection('top-down')
    await store.setAutoAdvanceOnReview(true)
    await store.setSidebarDefaultOpen(false)
    await store.setCodeFontSize(14.5)
    await store.setRequireAltForHover(true)
    await store.setShowShortcutsBar(false)
    await store.setInboxAutoRefreshSeconds(300)

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.init()

    expect(reloaded.defaultTourDirection).toBe('top-down')
    expect(reloaded.autoAdvanceOnReview).toBe(true)
    expect(reloaded.sidebarDefaultOpen).toBe(false)
    expect(reloaded.codeFontSize).toBe(14.5)
    expect(reloaded.requireAltForHover).toBe(true)
    expect(reloaded.showShortcutsBar).toBe(false)
    expect(reloaded.inboxAutoRefreshSeconds).toBe(300)
  })

  it('opens to a specific section and resets preferences to defaults', async () => {
    const store = useSettingsStore()
    await store.init()

    store.openSettings('github')
    expect(store.isOpen).toBe(true)
    expect(store.activeSection).toBe('github')

    await store.setCodeFontSize(11.5)
    await store.setAutoAdvanceOnReview(true)
    await store.resetToDefaults()

    expect(store.codeFontSize).toBe(DEFAULT_APP_SETTINGS.codeFontSize)
    expect(store.autoAdvanceOnReview).toBe(DEFAULT_APP_SETTINGS.autoAdvanceOnReview)

    store.closeSettings()
    expect(store.isOpen).toBe(false)
  })
})
