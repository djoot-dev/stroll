import { describe, expect, it } from 'vitest'
import { getReviewDecisionDisplay } from '@/services/reviewDecision'

describe('getReviewDecisionDisplay', () => {
  it('returns null for null decision', () => {
    expect(getReviewDecisionDisplay(null, 'alice', 'alice')).toBeNull()
  })

  it('shows Review required for non-author viewers', () => {
    const res = getReviewDecisionDisplay('REVIEW_REQUIRED', 'alice', 'bob')
    expect(res).toMatchObject({
      label: 'Review required',
      kind: 'review_required',
    })
    expect(res?.badgeClass).toContain('ochre')
  })

  it('shows neutral Awaiting review when the viewer is the PR author', () => {
    const res = getReviewDecisionDisplay('REVIEW_REQUIRED', 'alice', 'alice')
    expect(res).toMatchObject({
      label: 'Awaiting review',
      kind: 'awaiting_review',
    })
    expect(res?.badgeClass).not.toContain('ochre')
  })

  it('matches author and viewer logins case-insensitively', () => {
    const res = getReviewDecisionDisplay('REVIEW_REQUIRED', 'Alice', 'alice')
    expect(res?.kind).toBe('awaiting_review')
  })

  it('handles missing viewerLogin gracefully', () => {
    const res = getReviewDecisionDisplay('REVIEW_REQUIRED', 'alice', null)
    expect(res?.kind).toBe('review_required')
  })

  it('returns Approved and Changes requested regardless of author', () => {
    expect(getReviewDecisionDisplay('APPROVED', 'alice', 'alice')?.kind).toBe('approved')
    expect(getReviewDecisionDisplay('CHANGES_REQUESTED', 'alice', 'alice')?.kind).toBe('changes_requested')
  })
})
