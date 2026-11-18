import { invoke } from '@tauri-apps/api/core'

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
}

export interface ResolvedRepoSymbol {
  name: string
  kind: string
  path: string
  line: number
  language: string
  docComment: string | null
  snippet: string
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
