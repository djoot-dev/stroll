import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIRST_LAUNCH_SPLASH_MS,
  SLOW_STARTUP_THRESHOLD_MS,
  runAppStartup,
} from '../startup'

describe('runAppStartup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits at least FIRST_LAUNCH_SPLASH_MS before resolving when onboarding is not completed', async () => {
    let resolved = false
    const promise = runAppStartup({
      initSettings: vi.fn().mockResolvedValue(undefined),
      isOnboardingCompleted: () => false,
      initAuth: vi.fn().mockResolvedValue(undefined),
      initReview: vi.fn().mockResolvedValue(undefined),
      getAuthError: () => null,
    }).then((result) => {
      resolved = true
      return result
    })

    await vi.advanceTimersByTimeAsync(FIRST_LAUNCH_SPLASH_MS - 1)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const result = await promise
    expect(resolved).toBe(true)
    expect(result).toEqual({
      ok: true,
      error: null,
      minDelayMs: FIRST_LAUNCH_SPLASH_MS,
    })
  })

  it('skips the artificial splash delay once onboarding is completed', async () => {
    const onSlowStartup = vi.fn()
    const result = await runAppStartup({
      initSettings: vi.fn().mockResolvedValue(undefined),
      isOnboardingCompleted: () => true,
      initAuth: vi.fn().mockResolvedValue(undefined),
      initReview: vi.fn().mockResolvedValue(undefined),
      getAuthError: () => null,
      onSlowStartup,
    })

    expect(result).toEqual({
      ok: true,
      error: null,
      minDelayMs: 0,
    })
    expect(onSlowStartup).not.toHaveBeenCalled()
  })

  it('triggers onSlowStartup when initialization exceeds SLOW_STARTUP_THRESHOLD_MS', async () => {
    let resolveAuth: () => void = () => {}
    const authPromise = new Promise<void>((resolve) => {
      resolveAuth = resolve
    })
    const onSlowStartup = vi.fn()

    const startupPromise = runAppStartup({
      initSettings: vi.fn().mockResolvedValue(undefined),
      isOnboardingCompleted: () => true,
      initAuth: () => authPromise,
      initReview: vi.fn().mockResolvedValue(undefined),
      getAuthError: () => null,
      onSlowStartup,
    })

    await vi.advanceTimersByTimeAsync(SLOW_STARTUP_THRESHOLD_MS - 1)
    expect(onSlowStartup).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onSlowStartup).toHaveBeenCalledTimes(1)

    resolveAuth()
    const result = await startupPromise
    expect(result.ok).toBe(true)
  })

  it('surfaces auth errors returned via getAuthError after init', async () => {
    const result = await runAppStartup({
      initSettings: vi.fn().mockResolvedValue(undefined),
      isOnboardingCompleted: () => true,
      initAuth: vi.fn().mockResolvedValue(undefined),
      initReview: vi.fn().mockResolvedValue(undefined),
      getAuthError: () => 'Bad credentials',
    })

    expect(result).toEqual({
      ok: false,
      error: 'Bad credentials',
      minDelayMs: 0,
    })
  })

  it('catches thrown errors during settings or store initialization', async () => {
    const result = await runAppStartup({
      initSettings: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
      isOnboardingCompleted: () => false,
      initAuth: vi.fn().mockResolvedValue(undefined),
      initReview: vi.fn().mockResolvedValue(undefined),
      getAuthError: () => null,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Storage unavailable')
  })
})
