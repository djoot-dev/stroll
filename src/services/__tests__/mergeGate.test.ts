import { describe, expect, it } from 'vitest'
import { mergeGate } from '@/services/mergeGate'
import type { PRStatusCheck } from '@/types/pr'

function check(overrides: Partial<PRStatusCheck> = {}): PRStatusCheck {
  return {
    id: 'c1',
    name: 'ci/test',
    kind: 'check-run',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
    url: null,
    isRequired: false,
    ...overrides,
  }
}

describe('mergeGate', () => {
  it('disables merge when PR is a draft', () => {
    const res = mergeGate({
      isDraft: true,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'DRAFT',
      reviewDecision: null,
      statusCheckRollup: null,
      viewerCanMergeAsAdmin: true,
    })
    expect(res.enabled).toBe(false)
    expect(res.canBypassAsAdmin).toBe(false)
    expect(res.reasons).toEqual(['Mark ready for review before merging'])
  })

  it('disables merge on conflicts', () => {
    const res = mergeGate({
      isDraft: false,
      mergeable: 'CONFLICTING',
      mergeStateStatus: 'DIRTY',
      reviewDecision: null,
      statusCheckRollup: null,
      viewerCanMergeAsAdmin: true,
    })
    expect(res.enabled).toBe(false)
    expect(res.canBypassAsAdmin).toBe(false)
    expect(res.reasons).toEqual(['Resolve merge conflicts before merging'])
  })

  it('marks UNKNOWN mergeStateStatus as disabled and pending', () => {
    const res = mergeGate({
      isDraft: false,
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
      reviewDecision: null,
      statusCheckRollup: null,
    })
    expect(res.enabled).toBe(false)
    expect(res.pending).toBe(true)
  })

  it('disables merge when branch is BEHIND base', () => {
    const res = mergeGate({
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BEHIND',
      reviewDecision: 'APPROVED',
      statusCheckRollup: null,
      viewerCanMergeAsAdmin: false,
    })
    expect(res.enabled).toBe(false)
    expect(res.reasons).toEqual(['Branch is out of date with base'])
  })

  it('explains failing/pending required checks and review blockers when BLOCKED', () => {
    const res = mergeGate({
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'REVIEW_REQUIRED',
      statusCheckRollup: {
        state: 'FAILURE',
        checks: [
          check({ id: '1', name: 'build', conclusion: 'FAILURE', isRequired: true }),
          check({ id: '2', name: 'lint', conclusion: 'FAILURE', isRequired: true }),
          check({ id: '3', name: 'e2e', status: 'IN_PROGRESS', conclusion: null, isRequired: true }),
          check({ id: '4', name: 'optional', conclusion: 'FAILURE', isRequired: false }),
        ],
      },
      viewerCanMergeAsAdmin: true,
    })
    expect(res.enabled).toBe(false)
    expect(res.canBypassAsAdmin).toBe(true)
    expect(res.reasons).toEqual([
      '2 required checks failing',
      '1 required check pending',
      'Requires approving review',
    ])
    expect(res.tooltip).toContain('2 required checks failing')
  })

  it('falls back to generic protection message when BLOCKED without check/review details', () => {
    const res = mergeGate({
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'APPROVED',
      statusCheckRollup: null,
    })
    expect(res.enabled).toBe(false)
    expect(res.reasons).toEqual(['Blocked by branch protection rules'])
  })

  it('enables merge for CLEAN, HAS_HOOKS, and UNSTABLE', () => {
    for (const status of ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'] as const) {
      const res = mergeGate({
        isDraft: false,
        mergeable: 'MERGEABLE',
        mergeStateStatus: status,
        reviewDecision: 'APPROVED',
        statusCheckRollup: null,
      })
      expect(res.enabled).toBe(true)
      expect(res.pending).toBe(false)
    }
  })
})
