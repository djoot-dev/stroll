import { LazyStore } from '@tauri-apps/plugin-store'
import type { DraftComment, TourDirection } from '@/types/pr'

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

export async function loadGitHubPat(): Promise<string> {
  return (await getItem<string>('github_pat')) ?? ''
}

export async function saveGitHubPat(pat: string): Promise<void> {
  await setItem('github_pat', pat.trim())
}

export async function loadTourDirection(): Promise<TourDirection> {
  return (await getItem<TourDirection>('tour_direction')) ?? 'bottom-up'
}

export async function saveTourDirection(direction: TourDirection): Promise<void> {
  await setItem('tour_direction', direction)
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

export interface PersistedAppSettings {
  autoAdvanceOnReview: boolean
  sidebarDefaultOpen: boolean
  codeFontSize: number
  requireAltForHover: boolean
  showShortcutsBar: boolean
  inboxAutoRefreshSeconds: number
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
