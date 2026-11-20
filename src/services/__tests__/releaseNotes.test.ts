import { beforeEach, describe, expect, it, vi } from 'vitest'

const httpFetch = vi.fn()
vi.mock('../http', () => ({ httpFetch: (...args: unknown[]) => httpFetch(...args) }))

import { cleanReleaseBody, compareVersions, fetchReleaseNotes, selectReleasesBetween } from '../releaseNotes'

const BOILERPLATE =
  'See the assets below to download and install Stroll.\r\n\r\n' +
  '> **macOS note:** This build is ad-hoc signed. Run `xattr -cr /Applications/Stroll.app`.\r\n\r\n'

function release(tag: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: `Stroll ${tag}`,
    html_url: `https://github.com/totalfreak/stroll/releases/tag/${tag}`,
    body,
    draft: false,
    prerelease: false,
    published_at: '2026-11-20T08:48:43Z',
    ...extra,
  }
}

describe('compareVersions', () => {
  it('orders semver numerically and ignores a leading v', () => {
    expect(compareVersions('0.3.10', '0.3.9')).toBeGreaterThan(0)
    expect(compareVersions('v0.3.5', '0.3.5')).toBe(0)
    expect(compareVersions('0.2.9', 'v0.3.0')).toBeLessThan(0)
  })
})

describe('cleanReleaseBody', () => {
  it('strips the install hint and macOS note but keeps the changelog', () => {
    const body = `${BOILERPLATE}## What's Changed\r\n* Fix thing by @someone in https://github.com/x/y/pull/1`
    expect(cleanReleaseBody(body)).toBe(
      "## What's Changed\n* Fix thing by @someone in [#1](https://github.com/x/y/pull/1)",
    )
  })

  it('leaves non-PR URLs and existing markdown links alone', () => {
    const body = '[#2](https://github.com/x/y/pull/2) and https://github.com/x/y/compare/v1.0.0...v1.0.1'
    expect(cleanReleaseBody(body)).toBe(body)
  })

  it('returns empty string for boilerplate-only or missing bodies', () => {
    expect(cleanReleaseBody(BOILERPLATE)).toBe('')
    expect(cleanReleaseBody(null)).toBe('')
  })
})

describe('selectReleasesBetween', () => {
  it('keeps published releases in (current, target], newest first', () => {
    const notes = selectReleasesBetween(
      [
        release('v0.3.3', 'three'),
        release('v0.3.5', 'five'),
        release('v0.3.4', 'four'),
        release('v0.3.6', 'six-draft', { draft: true }),
        release('v0.3.6-beta', 'pre', { prerelease: true }),
        release('v0.3.7', 'future'),
      ],
      '0.3.3',
      '0.3.5',
    )
    expect(notes.map((n) => n.version)).toEqual(['0.3.5', '0.3.4'])
    expect(notes[0].body).toBe('five')
  })
})

describe('fetchReleaseNotes', () => {
  beforeEach(() => {
    httpFetch.mockReset()
  })

  it('returns notes from the GitHub Releases API', async () => {
    httpFetch.mockResolvedValue({ ok: true, json: async () => [release('v0.3.5', `${BOILERPLATE}hello`)] })
    const notes = await fetchReleaseNotes('0.3.4', '0.3.5', 'manifest notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('hello')
  })

  it('falls back to the updater manifest notes when the API fails', async () => {
    httpFetch.mockImplementation(async () => {
      throw new Error('offline')
    })
    const notes = await fetchReleaseNotes('0.3.4', '0.3.5', 'manifest notes')
    expect(notes).toEqual([
      {
        version: '0.3.5',
        name: 'Stroll v0.3.5',
        url: 'https://github.com/totalfreak/stroll/releases/tag/v0.3.5',
        body: 'manifest notes',
      },
    ])
  })

  it('returns nothing when neither source has notes', async () => {
    httpFetch.mockResolvedValue({ ok: false, json: async () => ({}) })
    expect(await fetchReleaseNotes('0.3.4', '0.3.5', '')).toEqual([])
  })
})
