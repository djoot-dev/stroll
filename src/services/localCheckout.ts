import type { LocalRepoStatus } from './native'

/** The minimum PR info needed to check out its head branch locally. */
export interface CheckoutTarget {
  owner: string
  repo: string
  number: number
  headRefName: string
  isCrossRepository: boolean
  /** PR head commit, when known, to tell "on the branch" from "on the latest PR commit". */
  headRefOid?: string | null
}

export type LocalCheckoutState =
  /** The checkout is on the PR branch at the PR head (or the head is unknown). */
  | { kind: 'on-pr'; branch: string }
  /** The checkout is on the PR branch but at a different commit than the PR head. */
  | { kind: 'on-pr-stale'; branch: string }
  /** The checkout is somewhere else (`branch` is `null` for a detached HEAD). */
  | { kind: 'elsewhere'; branch: string | null }

export function checkoutKey(target: Pick<CheckoutTarget, 'owner' | 'repo' | 'number'>): string {
  return `${target.owner}/${target.repo}#${target.number}`
}

/** Mirrors the Rust side: head branch for same-repo PRs, `pr/<n>` for forks. */
export function localBranchForPR(target: Pick<CheckoutTarget, 'number' | 'headRefName' | 'isCrossRepository'>): string {
  return target.isCrossRepository ? `pr/${target.number}` : target.headRefName
}

export function describeLocalCheckout(status: LocalRepoStatus, target: CheckoutTarget): LocalCheckoutState {
  const expected = localBranchForPR(target)
  if (status.branch !== expected) {
    return { kind: 'elsewhere', branch: status.branch }
  }
  if (target.headRefOid && status.headOid && status.headOid !== target.headRefOid) {
    return { kind: 'on-pr-stale', branch: expected }
  }
  return { kind: 'on-pr', branch: expected }
}

export function shortOid(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 7) : ''
}
