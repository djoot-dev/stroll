import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkForAppUpdate = vi.fn()
const fetchReleaseNotes = vi.fn()

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '0.4.0') }))
vi.mock('@/services/native', () => ({ isTauriRuntime: () => true }))
vi.mock('@/services/updater', () => ({ checkForAppUpdate: () => checkForAppUpdate() }))
vi.mock('@/services/releaseNotes', () => ({
  fetchReleaseNotes: (...args: unknown[]) => fetchReleaseNotes(...args),
}))

import { useUpdatesStore } from '../updates'

function availableUpdate(version: string) {
  return { available: true as const, version, body: 'notes', install: vi.fn() }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useUpdatesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    checkForAppUpdate.mockReset()
    fetchReleaseNotes.mockReset()
  })

  it('stores the available update and its release notes', async () => {
    checkForAppUpdate.mockResolvedValue(availableUpdate('0.4.1'))
    fetchReleaseNotes.mockResolvedValue([{ version: '0.4.1', name: 'Stroll v0.4.1', url: 'u', body: 'hello' }])
    const store = useUpdatesStore()

    await store.checkForUpdates()
    await flush()

    expect(store.state).toBe('available')
    expect(store.appVersion).toBe('0.4.0')
    expect(store.availableUpdate?.version).toBe('0.4.1')
    expect(fetchReleaseNotes).toHaveBeenCalledWith('0.4.0', '0.4.1', 'notes')
    expect(store.releaseNotes.map((n) => n.body)).toEqual(['hello'])
    expect(store.isLoadingReleaseNotes).toBe(false)
  })

  it('reports up-to-date when no update exists', async () => {
    checkForAppUpdate.mockResolvedValue({ available: false })
    const store = useUpdatesStore()

    await store.checkForUpdates()

    expect(store.state).toBe('up-to-date')
    expect(store.availableUpdate).toBeNull()
  })

  it('keeps the previous state on a failed silent check', async () => {
    checkForAppUpdate.mockRejectedValue(new Error('offline'))
    const store = useUpdatesStore()

    await store.checkForUpdates({ silent: true })
    expect(store.state).toBe('idle')
    expect(store.message).toBe('')

    await store.checkForUpdates()
    expect(store.state).toBe('error')
    expect(store.message).toBe('offline')
  })
})
