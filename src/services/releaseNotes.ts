import { httpFetch } from './http'

/** GitHub repository that publishes Stroll desktop releases (matches the updater endpoint). */
export const RELEASES_REPO = 'djoot-dev/stroll'
export const RELEASES_PAGE_URL = `https://github.com/${RELEASES_REPO}/releases`

export interface ReleaseNote {
  version: string
  name: string
  url: string
  publishedAt?: string
  body: string
}

interface GitHubRelease {
  tag_name: string
  name: string | null
  html_url: string
  body: string | null
  draft: boolean
  prerelease: boolean
  published_at: string | null
}

function parseVersion(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? match.slice(1, 4).map(Number) : null
}

/** Compares `x.y.z` versions (optional leading `v`). Returns <0, 0, or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/**
 * Strips the install boilerplate the release workflow prepends to every release
 * (asset download hint + macOS Gatekeeper note), leaving only the changelog.
 */
export function cleanReleaseBody(body: string | null | undefined): string {
  if (!body) return ''
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const kept: string[] = []
  let inMacNote = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^see the assets below to download and install stroll\.?$/i.test(trimmed)) continue
    if (/^>\s*\*\*macos note:\*\*/i.test(trimmed)) {
      inMacNote = true
      continue
    }
    if (inMacNote) {
      if (trimmed.startsWith('>')) continue
      inMacNote = false
    }
    kept.push(line)
  }
  // Shorten bare PR/issue URLs to `#123` links, as GitHub displays them.
  return kept
    .join('\n')
    .replace(
      /(^|\s)(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+))(?=[\s).,]|$)/gm,
      '$1[#$3]($2)',
    )
    .trim()
}

/**
 * Picks published, non-prerelease releases newer than `current` and up to and including
 * `target`, newest first.
 */
export function selectReleasesBetween(
  releases: GitHubRelease[],
  current: string,
  target: string,
): ReleaseNote[] {
  return releases
    .filter((r) => !r.draft && !r.prerelease && parseVersion(r.tag_name))
    .filter((r) => compareVersions(r.tag_name, current) > 0 && compareVersions(r.tag_name, target) <= 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      name: r.name || r.tag_name,
      url: r.html_url,
      publishedAt: r.published_at ?? undefined,
      body: cleanReleaseBody(r.body),
    }))
}

/**
 * Loads release notes for every version between the installed one and the available update
 * from the GitHub Releases API. When that fails or yields nothing, falls back to the notes
 * embedded in the updater manifest (`fallbackBody`). Never throws.
 */
export async function fetchReleaseNotes(
  currentVersion: string,
  targetVersion: string,
  fallbackBody?: string,
): Promise<ReleaseNote[]> {
  try {
    const res = await httpFetch(`https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (res.ok) {
      const notes = selectReleasesBetween((await res.json()) as GitHubRelease[], currentVersion, targetVersion)
      if (notes.length > 0) return notes
    }
  } catch {
    // Network or rate-limit failure: use the manifest notes below.
  }

  const body = cleanReleaseBody(fallbackBody)
  if (!body) return []
  const version = targetVersion.replace(/^v/, '')
  return [{ version, name: `Stroll v${version}`, url: `${RELEASES_PAGE_URL}/tag/v${version}`, body }]
}
