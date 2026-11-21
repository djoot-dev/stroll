import type { RepoPermission } from '@/types/pr'

/**
 * Extracts the replacement code string from every ```suggestion fenced block
 * in a review comment body.
 */
export function extractSuggestionBlocks(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const suggestions: string[] = []

  let i = 0
  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^(`{3,}|~{3,})([\w+-]*)\s*$/)
    if (!fenceMatch) {
      i += 1
      continue
    }

    const fenceChar = fenceMatch[1][0]
    const fenceLen = fenceMatch[1].length
    const lang = fenceMatch[2].toLowerCase()
    const closeRe = new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`)
    const codeLines: string[] = []
    i += 1
    while (i < lines.length && !closeRe.test(lines[i])) {
      codeLines.push(lines[i])
      i += 1
    }
    if (i < lines.length) i += 1

    if (lang === 'suggestion') {
      suggestions.push(codeLines.join('\n'))
    }
  }

  return suggestions
}

/**
 * Applies a suggested code replacement over the 1-based inclusive line range
 * `[startLine, endLine]` in `content`.
 */
export function applySuggestionToContent(
  content: string,
  startLine: number,
  endLine: number,
  suggestionCode: string,
): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const startIdx = Math.max(0, startLine - 1)
  const endIdx = Math.min(lines.length - 1, Math.max(startIdx, endLine - 1))
  const replacementLines = suggestionCode === '' ? [''] : suggestionCode.replace(/\r\n?/g, '\n').split('\n')
  const updated = [
    ...lines.slice(0, startIdx),
    ...replacementLines,
    ...lines.slice(endIdx + 1),
  ]
  return updated.join('\n')
}

export function hasRepoWriteAccess(permission: RepoPermission | null | undefined): boolean {
  return permission === 'ADMIN' || permission === 'MAINTAIN' || permission === 'WRITE'
}

export function buildGitHubPermalink(
  host: string,
  owner: string,
  repo: string,
  commitOid: string,
  path: string,
  line?: number | null,
): string {
  const cleanHost = host.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'github.com'
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const base = `https://${cleanHost}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(commitOid)}/${encodedPath}`
  return line && line > 0 ? `${base}#L${line}` : base
}
