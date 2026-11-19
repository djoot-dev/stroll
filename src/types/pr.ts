export type ArchitecturalLayer = 'config' | 'types' | 'core' | 'ui' | 'tests'

export type TourDirection = 'bottom-up' | 'top-down'

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export type DiffSide = 'LEFT' | 'RIGHT'

export type PRFilterMode = 'review-requested' | 'authored' | 'involves'

export interface GitHubUser {
  login: string
  name?: string | null
  avatarUrl: string
}

export interface PRCommit {
  oid: string
  shortOid: string
  messageHeadline: string
  authorName: string
  committedDate: string
}

export interface PRFile {
  path: string
  previousPath?: string
  status: FileChangeStatus
  additions: number
  deletions: number
  /** Git blob SHA from GitHub REST API (when available) */
  sha?: string
  /** Unified diff patch from GitHub */
  patch: string
  /** Full file content at base commit (null for newly added files) */
  baseContent: string | null
  /** Full file content at head commit (null for deleted files) */
  headContent: string | null
  language: string
}

export interface ReviewComment {
  id: string
  author: GitHubUser
  body: string
  createdAt: string
  isPending?: boolean
}

export interface ReviewThread {
  id: string
  path: string
  /** 1-based line number on the target side (end line for multiline threads) */
  line: number
  side: DiffSide
  startLine?: number | null
  startSide?: DiffSide | null
  isResolved: boolean
  isOutdated: boolean
  comments: ReviewComment[]
}

export interface DraftComment {
  id: string
  prKey: string
  path: string
  line: number
  side: DiffSide
  startLine?: number
  startSide?: DiffSide
  body: string
  createdAt: string
  /** Set once synced to GitHub as a pending review thread */
  syncedThreadId?: string
}

export interface ReferencedContext {
  sourcePath: string
  symbolNames: string[]
  snippet: string
  language: string
  startLine: number
}

export interface TourStep {
  stepIndex: number
  file: PRFile
  layer: ArchitecturalLayer
  reason: string
  /** Paths of other PR files that this file imports */
  dependencies: string[]
  /** Paths of other PR files that import this file */
  dependents: string[]
  /** If this is a test file, the implementation file it is paired with */
  pairedWith?: string
  /** Definitions from other PR files referenced by this file */
  referencedContexts: ReferencedContext[]
}

export interface PullRequestData {
  /** GraphQL node ID */
  id: string
  owner: string
  repo: string
  number: number
  title: string
  body: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  author: GitHubUser
  baseRefName: string
  headRefName: string
  baseRefOid: string
  headRefOid: string
  commits: PRCommit[]
  files: PRFile[]
  threads: ReviewThread[]
  pendingReviewId: string | null
  isMock?: boolean
}

export interface PRSummary {
  id: string
  owner: string
  repo: string
  number: number
  title: string
  url: string
  author: GitHubUser
  updatedAt: string
  additions: number
  deletions: number
  changedFiles: number
}
