export const OFFLINE_ERROR_MESSAGE = 'No internet connection — unable to reach GitHub.'

export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function extractErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof Error && err.message) {
    return err.message
  }
  if (typeof err === 'string' && err.trim()) {
    return err.trim()
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string' &&
    (err as { message: string }).message.trim()
  ) {
    return (err as { message: string }).message.trim()
  }
  return fallback
}

const NETWORK_ERROR_PATTERN =
  /\b(offline|enotfound|econnrefused|econnreset|etimedout|enetunreach|ehostunreach|err_network|err_internet_disconnected)\b|failed to fetch|load failed|networkerror|network error|error sending request|dns error|connection refused|connection reset|connection timed out|timed out|internet connection|unable to resolve host/i

export function isNetworkError(err: unknown): boolean {
  if (isBrowserOffline()) {
    return true
  }
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message)) {
    return true
  }
  const message = extractErrorMessage(err, '')
  return message ? NETWORK_ERROR_PATTERN.test(message) : false
}

const AUTH_ERROR_PATTERN = /GitHub GraphQL error \(401\)|bad credentials|\bunauthorized\b/i

export function isAuthError(err: unknown): boolean {
  const message = extractErrorMessage(err, '')
  return message ? AUTH_ERROR_PATTERN.test(message) : false
}
