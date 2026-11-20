import { describe, expect, it } from 'vitest'
import type { PRSummary } from '@/types/pr'
import { diffNewPRs, extractInboxRepos, filterAndSortInboxPRs } from '../inbox'

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
