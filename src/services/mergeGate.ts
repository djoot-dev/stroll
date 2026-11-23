import type { PRStatusCheck, PullRequestData } from '@/types/pr'

export interface MergeGateResult {
  enabled: boolean
  pending: boolean
  canBypassAsAdmin: boolean
  reasons: string[]
  tooltip: string
}

const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'ERROR',
  'STARTUP_FAILURE',
])

export function isStatusCheckPassed(check: PRStatusCheck): boolean {
  if (check.kind === 'status-context') {
    return check.status === 'SUCCESS'
  }
  return check.status === 'COMPLETED' && PASSING_CONCLUSIONS.has(check.conclusion ?? '')
}

export function isStatusCheckFailed(check: PRStatusCheck): boolean {
  if (check.kind === 'status-context') {
    return check.status === 'FAILURE' || check.status === 'ERROR'
  }
  return check.status === 'COMPLETED' && FAILING_CONCLUSIONS.has(check.conclusion ?? '')
}

/**
 * Pure merge-gating evaluator for the PR overview merge button.
 * Respects draft status, merge conflicts, GitHub's `mergeStateStatus`,
 * required checks, review decisions, and admin bypass capability.
 */
export function mergeGate(
  pr: Pick<
    PullRequestData,
    | 'isDraft'
    | 'mergeable'
    | 'mergeStateStatus'
    | 'reviewDecision'
    | 'statusCheckRollup'
    | 'viewerCanMergeAsAdmin'
  >,
): MergeGateResult {
  if (pr.isDraft || pr.mergeStateStatus === 'DRAFT') {
    const reasons = ['Mark ready for review before merging']
    return {
      enabled: false,
      pending: false,
      canBypassAsAdmin: false,
      reasons,
      tooltip: reasons[0],
    }
  }

  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    const reasons = ['Resolve merge conflicts before merging']
    return {
      enabled: false,
      pending: false,
      canBypassAsAdmin: false,
      reasons,
      tooltip: reasons[0],
    }
  }

  const status =
    pr.mergeStateStatus ?? (pr.mergeable === 'MERGEABLE' ? 'CLEAN' : 'UNKNOWN')

  if (status === 'UNKNOWN') {
    const reasons = ['Checking mergeability and branch protection…']
    return {
      enabled: false,
      pending: true,
      canBypassAsAdmin: false,
      reasons,
      tooltip: reasons[0],
    }
  }

  const canBypassAsAdmin = Boolean(pr.viewerCanMergeAsAdmin)

  if (status === 'BEHIND') {
    const reasons = ['Branch is out of date with base']
    return {
      enabled: false,
      pending: false,
      canBypassAsAdmin,
      reasons,
      tooltip: reasons[0],
    }
  }

  if (status === 'BLOCKED') {
    const reasons: string[] = []
    const requiredChecks = (pr.statusCheckRollup?.checks ?? []).filter((c) => c.isRequired)
    let requiredFailed = 0
    let requiredPending = 0
    for (const check of requiredChecks) {
      if (isStatusCheckFailed(check)) requiredFailed += 1
      else if (!isStatusCheckPassed(check)) requiredPending += 1
    }

    if (requiredFailed > 0) {
      reasons.push(
        `${requiredFailed} required check${requiredFailed === 1 ? '' : 's'} failing`,
      )
    }
    if (requiredPending > 0) {
      reasons.push(
        `${requiredPending} required check${requiredPending === 1 ? '' : 's'} pending`,
      )
    }

    if (pr.reviewDecision === 'CHANGES_REQUESTED') {
      reasons.push('Changes requested')
    } else if (pr.reviewDecision === 'REVIEW_REQUIRED') {
      reasons.push('Requires approving review')
    }

    if (reasons.length === 0) {
      reasons.push('Blocked by branch protection rules')
    }

    return {
      enabled: false,
      pending: false,
      canBypassAsAdmin,
      reasons,
      tooltip: reasons.join(' · '),
    }
  }

  // CLEAN, HAS_HOOKS, UNSTABLE (only non-required checks failing)
  return {
    enabled: true,
    pending: false,
    canBypassAsAdmin: false,
    reasons: [],
    tooltip: '',
  }
}
