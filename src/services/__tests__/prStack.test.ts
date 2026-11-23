import { describe, expect, it } from 'vitest'
import { annotateInboxStacks, inferPRStack, type PRStackCandidate } from '@/services/prStack'
import type { PRSummary } from '@/types/pr'

function makeCandidate(overrides: Partial<PRStackCandidate> = {}): PRStackCandidate {
  return {
    owner: 'acme',
    repo: 'stroll',
    number: 1,
    title: 'PR #1',
    url: 'https://github.com/acme/stroll/pull/1',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feat-1',
    isCrossRepository: false,
    reviewDecision: null,
    ciState: null,
    ...overrides,
  }
}

describe('inferPRStack', () => {
  it('returns null when PR is standalone', () => {
    const current = makeCandidate({ number: 10, baseRefName: 'main', headRefName: 'solo' })
    const stack = inferPRStack(
      { ...current, statusCheckRollup: null },
      [makeCandidate({ number: 11, baseRefName: 'main', headRefName: 'other' })],
      'main',
    )
    expect(stack).toBeNull()
  })

  it('infers a 3-PR linear stack with current in the middle', () => {
    const p1 = makeCandidate({ number: 101, baseRefName: 'main', headRefName: 'feat-a' })
    const p2 = makeCandidate({ number: 102, baseRefName: 'feat-a', headRefName: 'feat-b' })
    const p3 = makeCandidate({ number: 103, baseRefName: 'feat-b', headRefName: 'feat-c' })

    const stack = inferPRStack({ ...p2, statusCheckRollup: null }, [p1, p2, p3], 'main')
    expect(stack).not.toBeNull()
    expect(stack?.rootBaseRef).toBe('main')
    expect(stack?.flatChain.map((n) => n.number)).toEqual([101, 102, 103])
    expect(stack?.currentPosition).toBe(2)
    expect(stack?.totalCount).toBe(3)
    expect(stack?.baseIsNotDefault).toBe(true)
  })

  it('guards against branch cycles without infinite looping', () => {
    const p1 = makeCandidate({ number: 1, baseRefName: 'b', headRefName: 'a' })
    const p2 = makeCandidate({ number: 2, baseRefName: 'a', headRefName: 'b' })
    const stack = inferPRStack({ ...p1, statusCheckRollup: null }, [p1, p2], 'main')
    expect(stack?.flatChain.map((n) => n.number)).toEqual([2, 1])
  })

  it('annotates inbox PRs belonging to a stack', () => {
    const baseSummary = (num: number, baseRefName: string, headRefName: string): PRSummary => ({
      id: `id-${num}`,
      owner: 'acme',
      repo: 'stroll',
      number: num,
      title: `PR ${num}`,
      url: `https://github.com/acme/stroll/pull/${num}`,
      author: { login: 'alice', avatarUrl: '' },
      updatedAt: '2026-11-20T00:00:00Z',
      additions: 10,
      deletions: 2,
      changedFiles: 1,
      isDraft: false,
      reviewDecision: null,
      ciState: null,
      totalCommentsCount: 0,
      baseRefName,
      headRefName,
      isCrossRepository: false,
    })

    const map = annotateInboxStacks([
      baseSummary(1, 'main', 'part-1'),
      baseSummary(2, 'part-1', 'part-2'),
      baseSummary(3, 'main', 'unrelated'),
    ])

    expect(map.get('acme/stroll#1')).toEqual({ position: 1, total: 2 })
    expect(map.get('acme/stroll#2')).toEqual({ position: 2, total: 2 })
    expect(map.has('acme/stroll#3')).toBe(false)
  })
})
