export type ArchitecturalLayer = 'config' | 'types' | 'core' | 'ui' | 'tests'

export type TourDirection = 'bottom-up' | 'top-down'

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'

export type DiffSide = 'LEFT' | 'RIGHT'

export type PRFilterMode = 'review-requested' | 'authored' | 'involves'

export type PRInboxSortOption = 'updated-desc' | 'updated-asc' | 'diff-asc' | 'diff-desc'

export type PRMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

export type PRReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null

export type PRReviewState =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'COMMENTED'
  | 'DISMISSED'
  | 'PENDING'

export type CheckRollupState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'EXPECTED' | 'ERROR'

export interface PRLabel {
  name: string
  color: string
}

export interface PRRequestedReviewer {
  type: 'user' | 'team'
  login: string
  name?: string | null
  avatarUrl: string
}

export interface PRReview {
  id: string
  author: GitHubUser
  state: PRReviewState
  body: string
  submittedAt: string | null
}

export interface PRIssueComment {
  id: string
  author: GitHubUser
  body: string
  createdAt: string
}

export interface PRStatusCheck {
  id: string
  name: string
  kind: 'check-run' | 'status-context'
  status: string
  conclusion: string | null
  url: string | null
  description?: string | null
}

export interface PRStatusCheckRollup {
  state: CheckRollupState
  checks: PRStatusCheck[]
}

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
  /** True when the file is detected as binary (non-text blob or known binary extension) */
  isBinary?: boolean
  /** True when the file is a previewable image asset */
  isImage?: boolean
  /** True when the file is a lockfile or generated asset */
  isGenerated?: boolean
  /** Optional preloaded base64 data URL for base image preview */
  baseImageDataUrl?: string | null
  /** Optional preloaded base64 data URL for head image preview */
  headImageDataUrl?: string | null
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
  /** True when this step is a generated file or lockfile (collapsed by default) */
  isGenerated?: boolean
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
  isDraft: boolean
  mergeable: PRMergeableState
  reviewDecision: PRReviewDecision
  labels: PRLabel[]
  createdAt: string
  updatedAt: string
  author: GitHubUser
  baseRefName: string
  headRefName: string
  baseRefOid: string
  headRefOid: string
  commits: PRCommit[]
  files: PRFile[]
  threads: ReviewThread[]
  requestedReviewers: PRRequestedReviewer[]
  reviews: PRReview[]
  issueComments: PRIssueComment[]
  statusCheckRollup: PRStatusCheckRollup | null
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
  isDraft: boolean
  reviewDecision: PRReviewDecision
  ciState: CheckRollupState | null
  totalCommentsCount: number
}
