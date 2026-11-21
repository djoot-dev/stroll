import { describe, expect, it } from 'vitest'
import { MOCK_PR } from '@/data/mockPR'
import type { PRSummary, RecentPRItem } from '@/types/pr'
import {
  diffNewPRs,
  extractInboxRepos,
  filterAndSortInboxPRs,
  formatLocalProgressBadge,
  recordRecentPR,
  removeRecentPR,
  summarizePullRequest,
  togglePinRecentPR,
} from '../inbox'

function makePR(overrides: Partial<PRSummary> & { id: string; number: number }): PRSummary {
  return {
    owner: 'acme',
    repo: 'stroll',
    title: `PR #${overrides.number}`,
    url: `https://github.com/acme/stroll/pull/${overrides.number}`,
    author: { login: 'alice', avatarUrl: '' },
    updatedAt: '2026-11-19T10:00:00Z',
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    isDraft: false,
    reviewDecision: null,
    ciState: 'SUCCESS',
    totalCommentsCount: 0,
    headRefName: 'feature',
    isCrossRepository: false,
    ...overrides,
  }
}

const SAMPLE_PRS: PRSummary[] = [
  makePR({
    id: 'pr-1',
    owner: 'acme',
    repo: 'stroll',
    number: 101,
    title: 'Add keychain storage for tokens',
    author: { login: 'alice', avatarUrl: '' },
    updatedAt: '2026-11-19T08:00:00Z',
    additions: 120,
    deletions: 30,
  }),
  makePR({
    id: 'pr-2',
    owner: 'acme',
    repo: 'web-app',
    number: 204,
    title: 'Fix button alignment in header',
    author: { login: 'bob', avatarUrl: '' },
    updatedAt: '2026-11-19T12:00:00Z',
    additions: 4,
    deletions: 2,
  }),
  makePR({
    id: 'pr-3',
    owner: 'org',
    repo: 'infra',
    number: 55,
    title: 'Upgrade Terraform providers',
    author: { login: 'charlie', avatarUrl: '' },
    updatedAt: '2026-11-19T10:00:00Z',
    additions: 500,
    deletions: 450,
  }),
]

describe('inbox filtering, sorting & notification diffing', () => {
  it('extracts sorted unique owner/repo list', () => {
    const repos = extractInboxRepos([
      ...SAMPLE_PRS,
      makePR({ id: 'pr-4', owner: 'acme', repo: 'stroll', number: 102 }),
    ])
    expect(repos).toEqual(['acme/stroll', 'acme/web-app', 'org/infra'])
  })

  it('filters by title, #number, owner/repo, and @author', () => {
    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: 'keychain', repo: 'all', sort: 'updated-desc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-1'])

    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: '#204', repo: 'all', sort: 'updated-desc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-2'])

    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: 'org/infra', repo: 'all', sort: 'updated-desc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-3'])

    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: '@bob', repo: 'all', sort: 'updated-desc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-2'])
  })

  it('filters by selected repository', () => {
    const result = filterAndSortInboxPRs(SAMPLE_PRS, {
      query: '',
      repo: 'acme/web-app',
      sort: 'updated-desc',
    })
    expect(result.map((p) => p.id)).toEqual(['pr-2'])
  })

  it('sorts by recently updated, oldest updated, smallest diff, and largest diff', () => {
    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: '', repo: 'all', sort: 'updated-desc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-2', 'pr-3', 'pr-1'])

    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: '', repo: 'all', sort: 'updated-asc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-1', 'pr-3', 'pr-2'])

    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: '', repo: 'all', sort: 'diff-asc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-2', 'pr-1', 'pr-3'])

    expect(
      filterAndSortInboxPRs(SAMPLE_PRS, { query: '', repo: 'all', sort: 'diff-desc' }).map(
        (p) => p.id,
      ),
    ).toEqual(['pr-3', 'pr-1', 'pr-2'])
  })

  it('diffs newly arrived PRs against a previous snapshot', () => {
    const prev = new Set(['pr-1', 'pr-2'])
    const added = diffNewPRs(prev, SAMPLE_PRS)
    expect(added.map((p) => p.id)).toEqual(['pr-3'])
  })
})

describe('recent/pinned PRs & local progress formatting', () => {
  it('summarizes full PullRequestData into a PRSummary', () => {
    const summary = summarizePullRequest(MOCK_PR)
    expect(summary.owner).toBe(MOCK_PR.owner)
    expect(summary.repo).toBe(MOCK_PR.repo)
    expect(summary.number).toBe(MOCK_PR.number)
    expect(summary.changedFiles).toBe(MOCK_PR.files.length)
    expect(summary.additions).toBe(
      MOCK_PR.files.reduce((sum, f) => sum + f.additions, 0),
    )
    expect(summary.deletions).toBe(
      MOCK_PR.files.reduce((sum, f) => sum + f.deletions, 0),
    )
  })

  it('records, deduplicates, pins, caps unpinned, and removes recent PRs', () => {
    let list: RecentPRItem[] = []
    for (let i = 1; i <= 7; i += 1) {
      list = recordRecentPR(
        list,
        makePR({ id: `pr-${i}`, number: i }),
        `2026-11-20T0${i}:00:00Z`,
        5,
      )
    }
    expect(list.map((r) => r.summary.number)).toEqual([7, 6, 5, 4, 3])

    // Pin #3 and ensure it stays at top even when more PRs are viewed
    list = togglePinRecentPR(list, 'acme/stroll#3')
    expect(list[0].summary.number).toBe(3)
    expect(list[0].pinned).toBe(true)

    list = recordRecentPR(list, makePR({ id: 'pr-8', number: 8 }), '2026-11-20T08:00:00Z', 5)
    expect(list[0].summary.number).toBe(3)
    expect(list.map((r) => r.summary.number)).toEqual([3, 8, 7, 6, 5, 4])

    // Re-viewing pinned PR preserves its pinned flag
    list = recordRecentPR(list, makePR({ id: 'pr-3', number: 3 }), '2026-11-20T09:00:00Z', 5)
    expect(list[0].summary.number).toBe(3)
    expect(list[0].pinned).toBe(true)

    list = removeRecentPR(list, 'acme/stroll#3')
    expect(list.some((r) => r.summary.number === 3)).toBe(false)
  })

  it('formats local draft and review progress badges', () => {
    expect(formatLocalProgressBadge(undefined, 10)).toEqual({
      draftLabel: null,
      reviewLabel: null,
    })
    expect(formatLocalProgressBadge({ draftCount: 1, reviewedCount: 4 }, 10)).toEqual({
      draftLabel: '1 draft',
      reviewLabel: '4/10 files reviewed',
    })
    expect(formatLocalProgressBadge({ draftCount: 3, reviewedCount: 12 }, 10)).toEqual({
      draftLabel: '3 drafts',
      reviewLabel: '10/10 files reviewed',
    })
  })
})
