import type { CheckRollupState, PRReviewDecision, PRSummary, PullRequestData } from '@/types/pr'

export interface PRStackCandidate {
  owner: string
  repo: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  baseRefName: string
  headRefName: string
  isCrossRepository: boolean
  reviewDecision: PRReviewDecision
  ciState: CheckRollupState | null
}

export interface PRStackNode extends PRStackCandidate {
  isCurrent: boolean
  children: PRStackNode[]
}

export interface InferredPRStack {
  rootBaseRef: string
  ancestors: PRStackNode[]
  current: PRStackNode
  descendants: PRStackNode[]
  flatChain: PRStackNode[]
  totalCount: number
  currentPosition: number
  baseIsNotDefault: boolean
}

function toNode(c: PRStackCandidate, isCurrent: boolean): PRStackNode {
  return { ...c, isCurrent, children: [] }
}

/**
 * Infers a PR stack from branch (`baseRefName` / `headRefName`) relationships
 * among same-repository open PRs. Returns `null` when the PR has no parent or
 * child PRs in the stack.
 */
export function inferPRStack(
  currentPR: Pick<
    PullRequestData,
    | 'owner'
    | 'repo'
    | 'number'
    | 'title'
    | 'url'
    | 'state'
    | 'isDraft'
    | 'baseRefName'
    | 'headRefName'
    | 'isCrossRepository'
    | 'reviewDecision'
    | 'statusCheckRollup'
  >,
  candidates: PRStackCandidate[],
  defaultBranchName = 'main',
): InferredPRStack | null {
  if (currentPR.isCrossRepository) return null

  const sameRepo = candidates.filter(
    (c) =>
      !c.isCrossRepository &&
      c.owner.toLowerCase() === currentPR.owner.toLowerCase() &&
      c.repo.toLowerCase() === currentPR.repo.toLowerCase(),
  )

  const byHeadRef = new Map<string, PRStackCandidate>()
  const byBaseRef = new Map<string, PRStackCandidate[]>()
  for (const c of sameRepo) {
    if (c.number === currentPR.number) continue
    if (!byHeadRef.has(c.headRefName)) {
      byHeadRef.set(c.headRefName, c)
    }
    const list = byBaseRef.get(c.baseRefName) ?? []
    list.push(c)
    byBaseRef.set(c.baseRefName, list)
  }

  const currentCandidate: PRStackCandidate = {
    owner: currentPR.owner,
    repo: currentPR.repo,
    number: currentPR.number,
    title: currentPR.title,
    url: currentPR.url,
    state: currentPR.state,
    isDraft: currentPR.isDraft,
    baseRefName: currentPR.baseRefName,
    headRefName: currentPR.headRefName,
    isCrossRepository: currentPR.isCrossRepository,
    reviewDecision: currentPR.reviewDecision,
    ciState: currentPR.statusCheckRollup?.state ?? null,
  }

  const visited = new Set<number>([currentPR.number])

  // Walk downward to ancestors (parent whose headRefName === child's baseRefName)
  const ancestors: PRStackNode[] = []
  let cursorBase = currentPR.baseRefName
  while (cursorBase && cursorBase !== defaultBranchName) {
    const parent = byHeadRef.get(cursorBase)
    if (!parent || visited.has(parent.number)) break
    visited.add(parent.number)
    ancestors.unshift(toNode(parent, false))
    cursorBase = parent.baseRefName
  }

  const currentNode = toNode(currentCandidate, true)

  // Walk upward to descendants (children whose baseRefName === node's headRefName)
  const descendants: PRStackNode[] = []
  function attachChildren(node: PRStackNode) {
    const kids = (byBaseRef.get(node.headRefName) ?? []).sort((a, b) => a.number - b.number)
    for (const kid of kids) {
      if (visited.has(kid.number)) continue
      visited.add(kid.number)
      const kidNode = toNode(kid, false)
      node.children.push(kidNode)
      descendants.push(kidNode)
      attachChildren(kidNode)
    }
  }
  attachChildren(currentNode)

  if (ancestors.length === 0 && descendants.length === 0) {
    return null
  }

  const flatChain = [...ancestors, currentNode, ...descendants]
  const rootBaseRef = ancestors[0]?.baseRefName ?? currentPR.baseRefName

  return {
    rootBaseRef,
    ancestors,
    current: currentNode,
    descendants,
    flatChain,
    totalCount: flatChain.length,
    currentPosition: ancestors.length + 1,
    baseIsNotDefault: currentPR.baseRefName !== defaultBranchName,
  }
}

/**
 * Computes `position / total` stack badges for PRs in the inbox list when
 * multiple PRs in the same repo form a branch chain.
 */
export function annotateInboxStacks(
  prs: PRSummary[],
): Map<string, { position: number; total: number }> {
  const result = new Map<string, { position: number; total: number }>()
  const byRepo = new Map<string, PRSummary[]>()

  for (const pr of prs) {
    if (pr.isCrossRepository || !pr.baseRefName) continue
    const key = `${pr.owner.toLowerCase()}/${pr.repo.toLowerCase()}`
    const list = byRepo.get(key) ?? []
    list.push(pr)
    byRepo.set(key, list)
  }

  for (const [, repoPRs] of byRepo) {
    if (repoPRs.length < 2) continue
    const candidates: PRStackCandidate[] = repoPRs.map((p) => ({
      owner: p.owner,
      repo: p.repo,
      number: p.number,
      title: p.title,
      url: p.url,
      state: 'OPEN',
      isDraft: p.isDraft,
      baseRefName: p.baseRefName!,
      headRefName: p.headRefName,
      isCrossRepository: p.isCrossRepository,
      reviewDecision: p.reviewDecision,
      ciState: p.ciState,
    }))

    for (const pr of repoPRs) {
      const stack = inferPRStack(
        {
          owner: pr.owner,
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: 'OPEN',
          isDraft: pr.isDraft,
          baseRefName: pr.baseRefName!,
          headRefName: pr.headRefName,
          isCrossRepository: pr.isCrossRepository,
          reviewDecision: pr.reviewDecision,
          statusCheckRollup: null,
        },
        candidates,
      )
      if (stack && stack.totalCount > 1) {
        result.set(`${pr.owner}/${pr.repo}#${pr.number}`, {
          position: stack.currentPosition,
          total: stack.totalCount,
        })
      }
    }
  }

  return result
}
