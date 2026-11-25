import type { PRHeadPulse } from '@/services/github'

/**
 * The remote PR state the user has already seen. Polls are compared against
 * this snapshot rather than against the loaded PR data, because the loaded
 * comment/thread lists are filtered (outdated threads are dropped) and capped
 * (first N comments), so their lengths never match GitHub's totalCount.
 *
 * Counts start as `null` after a load/refresh and are filled in from the first
 * poll; until then, new comments are still detected through `updatedAt`.
 */
export interface PulseBaseline {
  headRefOid: string
  updatedAt: string
  commentCount: number | null
  threadCount: number | null
  checkState?: string | null
}

export type PulseChange = 'commits' | 'activity' | 'checks' | null

export function baselineFromPR(pr: {
  headRefOid: string
  updatedAt: string
  statusCheckRollup?: { state: string | null } | null
}): PulseBaseline {
  return {
    headRefOid: pr.headRefOid,
    updatedAt: pr.updatedAt,
    commentCount: null,
    threadCount: null,
    checkState: pr.statusCheckRollup?.state ?? null,
  }
}

export function baselineFromPulse(pulse: PRHeadPulse): PulseBaseline {
  return {
    headRefOid: pulse.headRefOid,
    updatedAt: pulse.updatedAt,
    commentCount: pulse.commentCount,
    threadCount: pulse.threadCount,
    checkState: pulse.checkState ?? null,
  }
}

export function detectPulseChange(baseline: PulseBaseline, pulse: PRHeadPulse): PulseChange {
  if (pulse.headRefOid !== baseline.headRefOid) return 'commits'
  if (
    (baseline.commentCount !== null && pulse.commentCount > baseline.commentCount) ||
    (baseline.threadCount !== null && pulse.threadCount > baseline.threadCount) ||
    Date.parse(pulse.updatedAt) > Date.parse(baseline.updatedAt)
  ) {
    return 'activity'
  }
  if (
    pulse.checkState !== undefined &&
    baseline.checkState !== undefined &&
    pulse.checkState !== baseline.checkState
  ) {
    return 'checks'
  }
  return null
}

/** Fill in counts that were unknown at load time, keeping everything else. */
export function completeBaseline(baseline: PulseBaseline, pulse: PRHeadPulse): PulseBaseline {
  return {
    ...baseline,
    commentCount: baseline.commentCount ?? pulse.commentCount,
    threadCount: baseline.threadCount ?? pulse.threadCount,
    checkState: baseline.checkState !== undefined ? baseline.checkState : (pulse.checkState ?? null),
  }
}
