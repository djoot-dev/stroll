import type { PRReviewDecision } from '@/types/pr'

export interface ReviewDecisionDisplay {
  label: string
  badgeClass: string
  kind: 'approved' | 'changes_requested' | 'review_required' | 'awaiting_review'
}

/**
 * Map GitHub's PR-level `reviewDecision` to a viewer-aware badge.
 * When `REVIEW_REQUIRED` is shown to the PR's own author, render a neutral
 * "Awaiting review" state instead of an ochre call-to-action pill.
 */
export function getReviewDecisionDisplay(
  decision: PRReviewDecision,
  authorLogin?: string | null,
  viewerLogin?: string | null,
): ReviewDecisionDisplay | null {
  switch (decision) {
    case 'APPROVED':
      return {
        label: 'Approved',
        badgeClass: 'border-pine-border bg-pine-soft text-pine-text',
        kind: 'approved',
      }
    case 'CHANGES_REQUESTED':
      return {
        label: 'Changes requested',
        badgeClass: 'border-crimson-border bg-crimson-soft text-crimson-text',
        kind: 'changes_requested',
      }
    case 'REVIEW_REQUIRED': {
      const isAuthor =
        Boolean(authorLogin) &&
        Boolean(viewerLogin) &&
        authorLogin!.toLowerCase() === viewerLogin!.toLowerCase()
      if (isAuthor) {
        return {
          label: 'Awaiting review',
          badgeClass: 'border-border bg-canvas-inset text-ink-muted',
          kind: 'awaiting_review',
        }
      }
      return {
        label: 'Review required',
        badgeClass: 'border-ochre-border bg-ochre-soft text-ochre-text',
        kind: 'review_required',
      }
    }
    default:
      return null
  }
}
