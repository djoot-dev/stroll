import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { openUrl } from '@tauri-apps/plugin-opener'

export interface RuntimeInfo {
  app_version: string
  os: string
  arch: string
  git_supported: boolean
  ast_supported: boolean
}

export interface ResolveRepoSymbolRequest {
  repoPath: string
  importerPath: string
  symbolName: string
  importSpecifier?: string | null
  /** Repo-relative file known to declare the symbol; skips import-path resolution. */
  targetPath?: string | null
  /** When set, `symbolName` is a member looked up inside this type/enum (e.g. `Status.Active`). */
  container?: string | null
}

export interface CSharpTypeEntry {
  name: string
  namespace: string | null
  path: string
}

export interface ResolvedRepoSymbol {
  name: string
  kind: string
  path: string
  line: number
  language: string
  docComment: string | null
  /** Declaration text (capped on the native side); the UI shows a prefix of it. */
  snippet: string
  /** Line count of the whole declaration. Absent from older native builds. */
  totalLines?: number
}

export interface GitBlameLineRequest {
  repoPath: string
  filePath: string
  line: number
  refOid?: string | null
}

export interface GitBlameInfo {
  commitOid: string
  shortOid: string
  authorName: string
  authorEmail: string
  timestamp: number
  summary: string
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getRuntimeInfo(): Promise<RuntimeInfo | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<RuntimeInfo>('get_runtime_info')
  } catch {
    return null
  }
}

export async function resolveRepoSymbol(
  request: ResolveRepoSymbolRequest,
): Promise<ResolvedRepoSymbol | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<ResolvedRepoSymbol | null>('resolve_repo_symbol', { request })
  } catch {
    return null
  }
}

export async function indexCSharpTypes(repoPath: string): Promise<CSharpTypeEntry[] | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<CSharpTypeEntry[]>('index_csharp_types', { request: { repoPath } })
  } catch {
    return null
  }
}

export async function gitBlameLine(
  request: GitBlameLineRequest,
): Promise<GitBlameInfo | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<GitBlameInfo>('git_blame_line', { request })
  } catch {
    return null
  }
}

export interface GitBlobSpec {
  oid: string
  path: string
}

export async function gitReadBlobs(
  repoPath: string,
  specs: GitBlobSpec[],
): Promise<Array<string | null> | null> {
  if (!isTauriRuntime() || specs.length === 0) return null
  try {
    return await invoke<Array<string | null>>('git_read_blobs', {
      request: { repoPath, specs },
    })
  } catch {
    return null
  }
}

export async function getGhAuthToken(): Promise<{ token: string | null; error: string | null }> {
  if (!isTauriRuntime()) {
    return {
      token: null,
      error: 'GitHub CLI sign-in is only available in the Tauri desktop app.',
    }
  }
  try {
    const token = await invoke<string>('get_gh_auth_token')
    return { token, error: null }
  } catch (err) {
    return {
      token: null,
      error: typeof err === 'string' ? err : err instanceof Error ? err.message : 'Failed to read gh auth token',
    }
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim()
  if (!trimmed) return

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return
  }

  if (isTauriRuntime()) {
    await openUrl(parsed.toString())
    return
  }

  if (typeof window !== 'undefined') {
    window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
  }
}

export interface LocalRepoInspection {
  isGitRepo: boolean
  ownerRepo: string | null
}

export async function pickLocalDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: 'Select Local Git Repository',
    })
    return typeof selected === 'string' ? selected : null
  } catch {
    return null
  }
}

export async function inspectLocalRepo(path: string): Promise<LocalRepoInspection | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<LocalRepoInspection>('inspect_local_repo', { path })
  } catch {
    return null
  }
}

export async function saveGitHubTokenKeychain(token: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke<void>('save_github_token', { token })
}

export async function loadGitHubTokenKeychain(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  return invoke<string | null>('load_github_token')
}

export async function deleteGitHubTokenKeychain(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke<void>('delete_github_token')
}

export interface LocalRepoStatus {
  /** Current branch, or `null` when HEAD is detached. */
  branch: string | null
  headOid: string | null
  /** Tracked files with uncommitted changes. */
  dirtyFiles: string[]
}

export interface GitCheckoutPRRequest {
  repoPath: string
  expectedOwnerRepo: string
  number: number
  headRefName: string
  isCrossRepository: boolean
}

export interface GitCheckoutPRResult {
  branch: string
  headOid: string
  created: boolean
  fastForwarded: boolean
  localAhead: boolean
}

function nativeErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return fallback
}

/** Reads branch / HEAD / dirty files of a linked checkout. `null` outside Tauri. */
export async function gitLocalStatus(repoPath: string): Promise<LocalRepoStatus | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<LocalRepoStatus>('git_local_status', { repoPath })
  } catch (err) {
    throw new Error(nativeErrorMessage(err, 'Failed to read local checkout status'))
  }
}

/** Fetches a PR's head and checks it out in the linked checkout. Throws with git's reason on failure. */
export async function gitCheckoutPR(request: GitCheckoutPRRequest): Promise<GitCheckoutPRResult> {
  if (!isTauriRuntime()) {
    throw new Error('Checking out branches is only available in the desktop app.')
  }
  try {
    return await invoke<GitCheckoutPRResult>('git_checkout_pr', { request })
  } catch (err) {
    throw new Error(nativeErrorMessage(err, 'Failed to check out the PR branch'))
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      let granted = await isPermissionGranted()
      if (!granted) {
        const result = await requestPermission()
        granted = result === 'granted'
      }
      return granted
    } catch {
      return false
    }
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

export async function sendDesktopNotification(title: string, body: string): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      const granted = await isPermissionGranted()
      if (!granted) return false
      sendNotification({ title, body })
      return true
    } catch {
      return false
    }
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body })
      return true
    } catch {
      return false
    }
  }
  return false
}
