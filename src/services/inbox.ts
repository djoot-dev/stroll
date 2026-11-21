import type {
  PRInboxSortOption,
  PRLocalProgress,
  PRSummary,
  PullRequestData,
  RecentPRItem,
} from '@/types/pr'

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

export const MAX_UNPINNED_RECENT_PRS = 5

export function prRefKey(pr: Pick<PRSummary, 'owner' | 'repo' | 'number'>): string {
  return `${pr.owner}/${pr.repo}#${pr.number}`
}

export function summarizePullRequest(data: PullRequestData): PRSummary {
  let additions = 0
  let deletions = 0
  for (const file of data.files) {
    additions += file.additions
    deletions += file.deletions
  }
  const threadComments = data.threads.reduce((sum, thread) => sum + thread.comments.length, 0)

  return {
    id: data.id,
    owner: data.owner,
    repo: data.repo,
    number: data.number,
    title: data.title,
    url: data.url,
    author: data.author,
    updatedAt: data.updatedAt,
    additions,
    deletions,
    changedFiles: data.files.length,
    isDraft: data.isDraft,
    reviewDecision: data.reviewDecision,
    ciState: data.statusCheckRollup?.state ?? null,
    totalCommentsCount: data.issueComments.length + threadComments,
    headRefName: data.headRefName,
    isCrossRepository: data.isCrossRepository,
  }
}

function sortRecentPRs(items: RecentPRItem[]): RecentPRItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return new Date(b.viewedAt).getTime() - new Date(a.viewedAt).getTime()
  })
}

export function recordRecentPR(
  existing: readonly RecentPRItem[],
  summary: PRSummary,
  viewedAt = new Date().toISOString(),
  maxUnpinned = MAX_UNPINNED_RECENT_PRS,
): RecentPRItem[] {
  const key = prRefKey(summary)
  const prev = existing.find((item) => prRefKey(item.summary) === key)
  const nextItem: RecentPRItem = {
    summary,
    viewedAt,
    pinned: prev?.pinned ?? false,
  }

  const remaining = existing.filter((item) => prRefKey(item.summary) !== key)
  const sorted = sortRecentPRs([nextItem, ...remaining])
  const pinned = sorted.filter((item) => item.pinned)
  const unpinned = sorted.filter((item) => !item.pinned).slice(0, maxUnpinned)
  return [...pinned, ...unpinned]
}

export function togglePinRecentPR(
  existing: readonly RecentPRItem[],
  key: string,
): RecentPRItem[] {
  const updated = existing.map((item) =>
    prRefKey(item.summary) === key ? { ...item, pinned: !item.pinned } : item,
  )
  return sortRecentPRs(updated)
}

export function removeRecentPR(
  existing: readonly RecentPRItem[],
  key: string,
): RecentPRItem[] {
  return existing.filter((item) => prRefKey(item.summary) !== key)
}

export function formatLocalProgressBadge(
  progress: PRLocalProgress | undefined,
  changedFiles: number,
): { draftLabel: string | null; reviewLabel: string | null } {
  if (!progress) return { draftLabel: null, reviewLabel: null }

  const draftLabel =
    progress.draftCount > 0
      ? `${progress.draftCount} ${progress.draftCount === 1 ? 'draft' : 'drafts'}`
      : null

  let reviewLabel: string | null = null
  if (progress.reviewedCount > 0) {
    reviewLabel =
      changedFiles > 0
        ? `${Math.min(progress.reviewedCount, changedFiles)}/${changedFiles} files reviewed`
        : `${progress.reviewedCount} reviewed`
  }

  return { draftLabel, reviewLabel }
}
