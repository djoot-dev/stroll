import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Uses `@tauri-apps/plugin-http` inside Tauri for CORS-free GitHub API requests,
 * and falls back to browser `fetch` during plain Vite browser development.
 */
export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauriRuntime()) {
    return tauriFetch(input, init)
  }
  return window.fetch(input, init)
}
