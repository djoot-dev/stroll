import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractErrorMessage, isAuthError, isNetworkError } from '../network'

describe('network error helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts messages from Errors, strings, and objects', () => {
    expect(extractErrorMessage(new Error('boom'))).toBe('boom')
    expect(extractErrorMessage('error sending request')).toBe('error sending request')
    expect(extractErrorMessage({ message: 'timed out' })).toBe('timed out')
    expect(extractErrorMessage(null, 'fallback')).toBe('fallback')
  })

  it('detects browser and Tauri network/offline errors without false positives on GraphQL errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true)
    expect(isNetworkError('error sending request for url (https://api.github.com/graphql)')).toBe(true)
    expect(isNetworkError(new Error('dns error: failed to lookup address information'))).toBe(true)
    expect(isNetworkError(new Error('Could not resolve to a PullRequest with the number of 999.'))).toBe(false)
    expect(isNetworkError(new Error('GitHub GraphQL error (401): Bad credentials'))).toBe(false)

    vi.stubGlobal('navigator', { onLine: false })
    expect(isNetworkError(new Error('anything'))).toBe(true)
  })

  it('detects 401 authentication errors', () => {
    expect(isAuthError(new Error('GitHub GraphQL error (401): Bad credentials'))).toBe(true)
    expect(isAuthError(new Error('GitHub GraphQL error (502): Bad Gateway'))).toBe(false)
    expect(isAuthError(new TypeError('Failed to fetch'))).toBe(false)
  })
})
