export const FIRST_LAUNCH_SPLASH_MS = 750
export const SLOW_STARTUP_THRESHOLD_MS = 750

export interface StartupDeps {
  initSettings: () => Promise<void>
  isOnboardingCompleted: () => boolean
  initAuth: () => Promise<void>
  initReview: () => Promise<void>
  getAuthError: () => string | null
  onSlowStartup?: () => void
}

export interface StartupResult {
  ok: boolean
  error: string | null
  minDelayMs: number
}

/**
 * Runs application startup initialization.
 *
 * - Skips the artificial minimum splash delay once onboarding is completed (cached launch).
 * - Notifies `onSlowStartup` if initialization exceeds `SLOW_STARTUP_THRESHOLD_MS` so the
 *   splash screen can reveal real-time phase status and a continue/skip option.
 * - Captures thrown errors and auth validation failures for inline splash recovery.
 */
export async function runAppStartup(deps: StartupDeps): Promise<StartupResult> {
  let settled = false
  const slowTimer = setTimeout(() => {
    if (!settled) {
      deps.onSlowStartup?.()
    }
  }, SLOW_STARTUP_THRESHOLD_MS)

  let minDelayMs = FIRST_LAUNCH_SPLASH_MS

  try {
    await deps.initSettings()
    minDelayMs = deps.isOnboardingCompleted() ? 0 : FIRST_LAUNCH_SPLASH_MS

    const minDelayPromise =
      minDelayMs > 0
        ? new Promise<void>((resolve) => setTimeout(resolve, minDelayMs))
        : Promise.resolve()

    await Promise.all([deps.initAuth(), deps.initReview(), minDelayPromise])

    const authError = deps.getAuthError()
    if (authError) {
      return { ok: false, error: authError, minDelayMs }
    }

    return { ok: true, error: null, minDelayMs }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to initialize Stroll'
    return { ok: false, error: message, minDelayMs }
  } finally {
    settled = true
    clearTimeout(slowTimer)
  }
}
