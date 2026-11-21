import { LazyStore } from '@tauri-apps/plugin-store'
import {
  deleteGitHubTokenKeychain,
  loadGitHubTokenKeychain,
  saveGitHubTokenKeychain,
} from './native'
import type { DraftComment, PRFile, PRLocalProgress, RecentPRItem, TourDirection } from '@/types/pr'

const STORE_FILE = 'stroll-settings.json'
const FALLBACK_PREFIX = 'stroll_'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let tauriStore: LazyStore | null = null

function getStore(): LazyStore {
  if (!tauriStore) {
    tauriStore = new LazyStore(STORE_FILE)
  }
  return tauriStore
}

async function getItem<T>(key: string): Promise<T | null> {
  if (isTauriRuntime()) {
    try {
      const value = await getStore().get<T>(key)
      return value ?? null
    } catch {
      return null
    }
  }
  const raw = localStorage.getItem(FALLBACK_PREFIX + key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function setItem<T>(key: string, value: T): Promise<void> {
  if (isTauriRuntime()) {
    const store = getStore()
    await store.set(key, value)
    await store.save()
    return
  }
  localStorage.setItem(FALLBACK_PREFIX + key, JSON.stringify(value))
}

async function deleteItem(key: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const store = getStore()
      await store.delete(key)
      await store.save()
    } catch {
      // Ignore deletion errors if key does not exist
    }
    return
  }
  localStorage.removeItem(FALLBACK_PREFIX + key)
}

export async function loadGitHubPat(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const keychainPat = await loadGitHubTokenKeychain()
      if (keychainPat && keychainPat.trim()) {
        return keychainPat.trim()
      }

      // One-time migration from legacy plaintext stroll-settings.json into OS Keychain
      const legacyPat = await getItem<string>('github_pat')
      if (legacyPat && legacyPat.trim()) {
        const trimmed = legacyPat.trim()
        await saveGitHubTokenKeychain(trimmed)
        await deleteItem('github_pat')
        return trimmed
      }
      return ''
    } catch {
      // Fallback to store if OS keychain is unavailable
      return (await getItem<string>('github_pat')) ?? ''
    }
  }
  return (await getItem<string>('github_pat')) ?? ''
}

export async function saveGitHubPat(pat: string): Promise<void> {
  const trimmed = pat.trim()
  if (isTauriRuntime()) {
    try {
      if (!trimmed) {
        await deleteGitHubTokenKeychain()
      } else {
        await saveGitHubTokenKeychain(trimmed)
      }
      // Remove any legacy plaintext entry from stroll-settings.json
      await deleteItem('github_pat')
      return
    } catch {
      // Fallback if keychain write fails
    }
  }
  if (!trimmed) {
    await deleteItem('github_pat')
    return
  }
  await setItem('github_pat', trimmed)
}

export async function loadTourDirection(): Promise<TourDirection> {
  return (await getItem<TourDirection>('tour_direction')) ?? 'bottom-up'
}

export async function saveTourDirection(direction: TourDirection): Promise<void> {
  await setItem('tour_direction', direction)
}

export async function loadOnboardingCompleted(): Promise<boolean> {
  return (await getItem<boolean>('onboarding_completed')) ?? false
}

export async function saveOnboardingCompleted(completed: boolean): Promise<void> {
  await setItem('onboarding_completed', completed)
}

export async function loadDraftComments(prKey: string): Promise<DraftComment[]> {
  const all = (await getItem<Record<string, DraftComment[]>>('draft_comments')) ?? {}
  return all[prKey] ?? []
}

export async function saveDraftComments(prKey: string, drafts: DraftComment[]): Promise<void> {
  const all = (await getItem<Record<string, DraftComment[]>>('draft_comments')) ?? {}
  all[prKey] = drafts
  await setItem('draft_comments', all)
}

export type ThemeMode = 'light' | 'dark' | 'system'

/** Display order for the overview's commit and conversation history. */
export type HistoryOrder = 'newest' | 'oldest'

export interface PersistedAppSettings {
  theme: ThemeMode
  autoAdvanceOnReview: boolean
  sidebarDefaultOpen: boolean
  sidebarWidth: number
  codeFontSize: number
  requireAltForHover: boolean
  wrapLines: boolean
  showShortcutsBar: boolean
  inboxAutoRefreshSeconds: number
  inboxNotificationsEnabled: boolean
  githubHost: string
  historyOrder: HistoryOrder
}

export async function loadAppSettings(): Promise<Partial<PersistedAppSettings>> {
  return (await getItem<Partial<PersistedAppSettings>>('app_settings')) ?? {}
}

export async function saveAppSettings(settings: PersistedAppSettings): Promise<void> {
  await setItem('app_settings', settings)
}

export async function loadRepoPaths(): Promise<Record<string, string>> {
  return (await getItem<Record<string, string>>('repo_paths')) ?? {}
}

export async function saveRepoPaths(paths: Record<string, string>): Promise<void> {
  await setItem('repo_paths', paths)
}

export type ViewedFilesMap = Record<string, string>

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n
const FNV_PRIME_64 = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

function fnv1a64(input: string): string {
  let hash = FNV_OFFSET_BASIS_64
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV_PRIME_64) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * Computes a deterministic content/diff fingerprint for a PR file so that
 * viewed state is preserved only while the file remains unchanged.
 */
export function computeFileFingerprint(file: PRFile): string {
  const parts = [
    file.status,
    file.previousPath ?? '',
    String(file.additions),
    String(file.deletions),
    file.sha ?? '',
    file.patch,
    file.baseContent ?? '<null>',
    file.headContent ?? '<null>',
  ]
  const payload = parts.map((p) => `${p.length}:${p}`).join('|')
  return `v1:${fnv1a64(payload)}`
}

let viewedFilesWriteQueue: Promise<void> = Promise.resolve()

export async function loadViewedFiles(prKey: string): Promise<ViewedFilesMap> {
  await viewedFilesWriteQueue
  const all = (await getItem<Record<string, ViewedFilesMap>>('viewed_files')) ?? {}
  return all[prKey] ?? {}
}

export async function saveViewedFiles(prKey: string, viewed: ViewedFilesMap): Promise<void> {
  const writeTask = viewedFilesWriteQueue.then(async () => {
    const all = (await getItem<Record<string, ViewedFilesMap>>('viewed_files')) ?? {}
    if (Object.keys(viewed).length === 0) {
      delete all[prKey]
    } else {
      all[prKey] = viewed
    }
    await setItem('viewed_files', all)
  })
  viewedFilesWriteQueue = writeTask.catch(() => {})
  return writeTask
}

export async function loadAllPRProgress(): Promise<Record<string, PRLocalProgress>> {
  await viewedFilesWriteQueue
  const [allDrafts, allViewed] = await Promise.all([
    getItem<Record<string, DraftComment[]>>('draft_comments'),
    getItem<Record<string, ViewedFilesMap>>('viewed_files'),
  ])

  const progress: Record<string, PRLocalProgress> = {}
  const keys = new Set([
    ...Object.keys(allDrafts ?? {}),
    ...Object.keys(allViewed ?? {}),
  ])

  for (const key of keys) {
    const draftCount = allDrafts?.[key]?.length ?? 0
    const reviewedCount = Object.keys(allViewed?.[key] ?? {}).length
    if (draftCount > 0 || reviewedCount > 0) {
      progress[key] = { draftCount, reviewedCount }
    }
  }

  return progress
}

export async function loadRecentPRs(): Promise<RecentPRItem[]> {
  const items = await getItem<RecentPRItem[]>('recent_prs')
  return Array.isArray(items) ? items : []
}

export async function saveRecentPRs(items: RecentPRItem[]): Promise<void> {
  await setItem('recent_prs', items)
}
