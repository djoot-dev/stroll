import { LazyStore } from '@tauri-apps/plugin-store'
import {
  deleteGitHubTokenKeychain,
  loadGitHubTokenKeychain,
  saveGitHubTokenKeychain,
} from './native'
import type { DraftComment, PRFile, ReviewEvent, TourDirection } from '@/types/pr'

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

export type DiffViewMode = 'unified' | 'split'
export type TabSizeOption = 2 | 4 | 8
export type ExternalEditorPreset = 'vscode' | 'cursor' | 'zed' | 'custom'

export interface ReviewSummaryDraft {
  body: string
  event: ReviewEvent
}

export interface ReviewTemplate {
  id: string
  name: string
  body: string
}

export interface PersistedAppSettings {
  theme: ThemeMode
  autoAdvanceOnReview: boolean
  sidebarDefaultOpen: boolean
  sidebarWidth: number
  codeFontSize: number
  requireAltForHover: boolean
  wrapLines: boolean
  diffViewMode: DiffViewMode
  tabSize: TabSizeOption
  ignoreWhitespaceDefault: boolean
  externalEditor: ExternalEditorPreset
  externalEditorCustomCommand: string
  tourIgnorePatterns: string[]
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

export async function loadReviewSummaryDraft(prKey: string): Promise<ReviewSummaryDraft | null> {
  if (!prKey) return null
  const all = (await getItem<Record<string, ReviewSummaryDraft>>('review_summary_drafts')) ?? {}
  return all[prKey] ?? null
}

export async function saveReviewSummaryDraft(
  prKey: string,
  draft: ReviewSummaryDraft | null,
): Promise<void> {
  if (!prKey) return
  const all = (await getItem<Record<string, ReviewSummaryDraft>>('review_summary_drafts')) ?? {}
  if (!draft || (!draft.body.trim() && draft.event === 'COMMENT')) {
    delete all[prKey]
  } else {
    all[prKey] = draft
  }
  await setItem('review_summary_drafts', all)
}

export async function loadReviewTemplates(): Promise<ReviewTemplate[]> {
  return (await getItem<ReviewTemplate[]>('review_templates')) ?? []
}

export async function saveReviewTemplates(templates: ReviewTemplate[]): Promise<void> {
  await setItem('review_templates', templates)
}

/**
 * Clears cached PR review progress (viewed files), pending inline draft comments,
 * and saved review summary drafts while keeping PAT, settings, and linked repos intact.
 */
export async function clearReviewCache(): Promise<void> {
  await viewedFilesWriteQueue
  await Promise.all([
    deleteItem('draft_comments'),
    deleteItem('viewed_files'),
    deleteItem('review_summary_drafts'),
  ])
}
