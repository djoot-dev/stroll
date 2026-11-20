import { getVersion } from '@tauri-apps/api/app'
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { isTauriRuntime } from '@/services/native'
import { fetchReleaseNotes, type ReleaseNote } from '@/services/releaseNotes'
import { checkForAppUpdate, type AvailableUpdate } from '@/services/updater'

export type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error'

/** How often to re-check for a new desktop release in the background. */
export const BACKGROUND_UPDATE_CHECK_MS = 4 * 60 * 60 * 1000

/**
 * App update state shared by Settings → Updates and the version indicator, so a
 * background check on startup can surface an available update anywhere in the UI.
 */
export const useUpdatesStore = defineStore('updates', () => {
  const appVersion = ref('')
  const state = ref<UpdateState>('idle')
  // shallowRef: keep the raw update object (it wraps a native resource handle).
  const availableUpdate = shallowRef<AvailableUpdate | null>(null)
  const message = ref('')
  const releaseNotes = ref<ReleaseNote[]>([])
  const isLoadingReleaseNotes = ref(false)

  // Incremented per check so results from a stale check are ignored.
  let checkId = 0

  async function loadAppVersion(): Promise<void> {
    if (appVersion.value || !isTauriRuntime()) return
    try {
      appVersion.value = await getVersion()
    } catch {
      // Version unavailable outside a packaged build.
    }
  }

  async function loadReleaseNotes(update: AvailableUpdate, id: number): Promise<void> {
    isLoadingReleaseNotes.value = true
    try {
      const notes = await fetchReleaseNotes(appVersion.value, update.version, update.body)
      if (id === checkId) releaseNotes.value = notes
    } finally {
      if (id === checkId) isLoadingReleaseNotes.value = false
    }
  }

  /**
   * Checks for an update. With `silent`, failures leave the current state untouched
   * (used for background checks so a flaky network doesn't show an error).
   */
  async function checkForUpdates({ silent = false }: { silent?: boolean } = {}): Promise<void> {
    if (state.value === 'checking' || state.value === 'installing') return
    const id = ++checkId
    const previousState = state.value
    state.value = 'checking'
    message.value = ''
    try {
      await loadAppVersion()
      const result = await checkForAppUpdate()
      if (id !== checkId) return
      if (result.available) {
        const isNewVersion = availableUpdate.value?.version !== result.version
        availableUpdate.value = result
        state.value = 'available'
        if (isNewVersion || releaseNotes.value.length === 0) {
          releaseNotes.value = []
          void loadReleaseNotes(result, id)
        }
      } else {
        availableUpdate.value = null
        releaseNotes.value = []
        state.value = 'up-to-date'
      }
    } catch (err) {
      if (id !== checkId) return
      if (silent) {
        state.value = previousState
        return
      }
      state.value = 'error'
      message.value = err instanceof Error ? err.message : 'Unable to check for updates.'
    }
  }

  async function installUpdate(): Promise<void> {
    const update = availableUpdate.value
    if (!update) return
    state.value = 'installing'
    message.value = 'Downloading update...'
    try {
      await update.install((downloaded, total) => {
        if (total && total > 0) {
          const pct = Math.min(100, Math.round((downloaded / total) * 100))
          message.value = `Downloading update (${pct}%)...`
        }
      })
    } catch (err) {
      state.value = 'error'
      message.value = err instanceof Error ? err.message : 'Failed to install update.'
    }
  }

  return {
    appVersion,
    state,
    availableUpdate,
    message,
    releaseNotes,
    isLoadingReleaseNotes,
    loadAppVersion,
    checkForUpdates,
    installUpdate,
  }
})
