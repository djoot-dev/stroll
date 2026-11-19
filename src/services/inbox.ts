import type { PRInboxSortOption, PRSummary } from '@/types/pr'

export interface InboxFilterOptions {
  query: string
  repo: string
  sort: PRInboxSortOption
}

export function extractInboxRepos(prs: readonly PRSummary[]): string[] {
  const repos = new Set<string>()
  for (const pr of prs) {
    repos.add(`${pr.owner}/${pr.repo}`)
  }
  return Array.from(repos).sort((a, b) => a.localeCompare(b))
}

export function filterAndSortInboxPRs(
  prs: readonly PRSummary[],
  options: InboxFilterOptions,
): PRSummary[] {
  const normalizedQuery = options.query.trim().toLowerCase()
  const repoFilter = options.repo.trim()

  const filtered = prs.filter((pr) => {
    const fullRepo = `${pr.owner}/${pr.repo}`
    if (repoFilter && repoFilter !== 'all' && fullRepo !== repoFilter) {
      return false
    }

    if (!normalizedQuery) return true

    const haystack = [
      pr.title,
      `#${pr.number}`,
      String(pr.number),
      fullRepo,
      `${fullRepo}#${pr.number}`,
      `@${pr.author.login}`,
      pr.author.login,
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedQuery)
  })

  return [...filtered].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime()
    const bTime = new Date(b.updatedAt).getTime()
    const aDiff = a.additions + a.deletions
    const bDiff = b.additions + b.deletions

    switch (options.sort) {
      case 'updated-asc':
        return aTime - bTime
      case 'diff-asc':
        return aDiff - bDiff || bTime - aTime
      case 'diff-desc':
        return bDiff - aDiff || bTime - aTime
      case 'updated-desc':
      default:
        return bTime - aTime
    }
  })
}

export function diffNewPRs(
  previousIds: ReadonlySet<string>,
  currentPRs: readonly PRSummary[],
): PRSummary[] {
  return currentPRs.filter((pr) => !previousIds.has(pr.id))
}
