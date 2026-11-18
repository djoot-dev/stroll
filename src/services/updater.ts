import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent } from '@tauri-apps/plugin-updater'

export interface AvailableUpdate {
  available: true
  version: string
  date?: string
  body?: string
  install: (onProgress?: (downloadedBytes: number, totalBytes?: number) => void) => Promise<void>
}

export type UpdateCheckResult = { available: false } | AvailableUpdate

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Checks for an application update via `@tauri-apps/plugin-updater`.
 * Returns `{ available: false }` when running outside Tauri.
 */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriRuntime()) {
    return { available: false }
  }

  const update = await check()
  if (!update) {
    return { available: false }
  }

  return {
    available: true,
    version: update.version,
    date: update.date,
    body: update.body,
    install: async (onProgress) => {
      let downloaded = 0
      let total: number | undefined

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          total = event.data.contentLength
          downloaded = 0
          onProgress?.(downloaded, total)
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          onProgress?.(downloaded, total)
        } else if (event.event === 'Finished') {
          onProgress?.(total ?? downloaded, total)
        }
      })

      await relaunch()
    },
  }
}
