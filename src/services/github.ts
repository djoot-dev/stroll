import { httpFetch } from './http'
import { gitReadBlobs, isTauriRuntime, type GitBlobSpec } from './native'
import type {
  DiffSide,
  FileChangeStatus,
  GitHubUser,
  PRCommit,
  PRFile,
  PRSummary,
  PullRequestData,
  ReviewComment,
  ReviewEvent,
  ReviewThread,
} from '@/types/pr'

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'
const GITHUB_REST_URL = 'https://api.github.com'

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string; type?: string }>
}

async function graphql<T>(
  pat: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await httpFetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      'User-Agent': 'PR-Tour-Desktop',
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub GraphQL error (${res.status}): ${text}`)
  }

  const json = (await res.json()) as GraphQLResponse<T>
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }
  if (!json.data) {
    throw new Error('GitHub GraphQL returned empty data')
  }
  return json.data
}

export function parsePRUrl(
  rawUrl: string,
): { owner: string; repo: string; number: number } | null {
  const trimmed = rawUrl.trim()
  const match = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/i,
  )
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
  }
}

export function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    vue: 'vue',
    rs: 'rust',
    py: 'python',
    sql: 'sql',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    css: 'css',
    scss: 'css',
    html: 'html',
    md: 'markdown',
    toml: 'toml',
  }
  return map[ext] ?? 'text'
}

export async function fetchViewerAndRequestedPRs(pat: string): Promise<{
  viewer: GitHubUser
  requestedPRs: PRSummary[]
}> {
  const query = `
    query ViewerAndRequestedPRs {
      viewer {
        login
        name
        avatarUrl
      }
      search(query: "is:pr is:open review-requested:@me sort:updated-desc", type: ISSUE, first: 20) {
        nodes {
          ... on PullRequest {
            id
            number
            title
            url
            updatedAt
            additions
            deletions
            changedFiles
            author {
              login
              avatarUrl
            }
            repository {
              name
              owner {
                login
              }
            }
          }
        }
      }
    }
  `

  interface RawResp {
    viewer: GitHubUser
    search: {
      nodes: Array<{
        id: string
        number: number
        title: string
        url: string
        updatedAt: string
        additions: number
        deletions: number
        changedFiles: number
        author: GitHubUser | null
        repository: { name: string; owner: { login: string } }
      } | null>
    }
  }

  const data = await graphql<RawResp>(pat, query)
  const requestedPRs: PRSummary[] = data.search.nodes
    .filter((n): n is NonNullable<typeof n> => Boolean(n && n.repository))
    .map((n) => ({
      id: n.id,
      owner: n.repository.owner.login,
      repo: n.repository.name,
      number: n.number,
      title: n.title,
      url: n.url,
      author: n.author ?? { login: 'ghost', avatarUrl: '' },
      updatedAt: n.updatedAt,
      additions: n.additions,
      deletions: n.deletions,
      changedFiles: n.changedFiles,
    }))

  return {
    viewer: data.viewer,
    requestedPRs,
  }
}

interface RestPRFile {
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

async function fetchRestPRFiles(
  pat: string,
  owner: string,
  repo: string,
  number: number,
): Promise<RestPRFile[]> {
  const res = await httpFetch(
    `${GITHUB_REST_URL}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'PR-Tour-Desktop',
      },
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub REST /files error (${res.status}): ${text}`)
  }
  return (await res.json()) as RestPRFile[]
}

function mapFileStatus(status: string): FileChangeStatus {
  switch (status.toLowerCase()) {
    case 'added':
      return 'added'
    case 'removed':
    case 'deleted':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    default:
      return 'modified'
  }
}

/**
 * Fetches full base & head blob contents for changed files in batches using GraphQL aliases.
 */
async function fetchFileContentsBatch(
  pat: string,
  owner: string,
  repo: string,
  baseOid: string,
  headOid: string,
  files: RestPRFile[],
): Promise<Map<string, { base: string | null; head: string | null }>> {
  const result = new Map<string, { base: string | null; head: string | null }>()
  const chunkSize = 20

  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    const fields: string[] = []

    chunk.forEach((f, idx) => {
      const status = mapFileStatus(f.status)
      if (status !== 'added') {
        const basePath = f.previous_filename ?? f.filename
        const expr = `${baseOid}:${basePath}`.replace(/"/g, '\\"')
        fields.push(`b_${idx}: object(expression: "${expr}") { ... on Blob { text } }`)
      }
      if (status !== 'deleted') {
        const expr = `${headOid}:${f.filename}`.replace(/"/g, '\\"')
        fields.push(`h_${idx}: object(expression: "${expr}") { ... on Blob { text } }`)
      }
    })

    if (fields.length === 0) continue

    const query = `
      query FileContents($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          ${fields.join('\n')}
        }
      }
    `

    interface BlobResp {
      repository: Record<string, { text?: string } | null>
    }

    const data = await graphql<BlobResp>(pat, query, { owner, repo })
    chunk.forEach((f, idx) => {
      const baseBlob = data.repository[`b_${idx}`]
      const headBlob = data.repository[`h_${idx}`]
      result.set(f.filename, {
        base: baseBlob?.text ?? null,
        head: headBlob?.text ?? null,
      })
    })
  }

  return result
}

export async function fetchPullRequest(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  localRepoPath?: string | null,
): Promise<PullRequestData> {
  const query = `
    query PullRequestDetails($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          id
          number
          title
          body
          url
          state
          baseRefName
          headRefName
          baseRefOid
          headRefOid
          author {
            login
            avatarUrl
          }
          commits(first: 50) {
            nodes {
              commit {
                oid
                abbreviatedOid
                messageHeadline
                committedDate
                author {
                  name
                }
              }
            }
          }
          reviews(first: 20, states: [PENDING]) {
            nodes {
              id
              author {
                login
              }
            }
          }
          reviewThreads(first: 100) {
            nodes {
              id
              path
              line
              diffSide
              startLine
              startDiffSide
              isResolved
              isOutdated
              comments(first: 30) {
                nodes {
                  id
                  body
                  createdAt
                  state
                  author {
                    login
                    avatarUrl
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  interface RawPRResp {
    repository: {
      pullRequest: {
        id: string
        number: number
        title: string
        body: string
        url: string
        state: 'OPEN' | 'CLOSED' | 'MERGED'
        baseRefName: string
        headRefName: string
        baseRefOid: string
        headRefOid: string
        author: GitHubUser | null
        commits: {
          nodes: Array<{
            commit: {
              oid: string
              abbreviatedOid: string
              messageHeadline: string
              committedDate: string
              author: { name?: string | null } | null
            }
          }>
        }
        reviews: {
          nodes: Array<{ id: string; author: { login: string } | null }>
        }
        reviewThreads: {
          nodes: Array<{
            id: string
            path: string
            line: number | null
            diffSide: DiffSide | null
            startLine: number | null
            startDiffSide: DiffSide | null
            isResolved: boolean
            isOutdated: boolean
            comments: {
              nodes: Array<{
                id: string
                body: string
                createdAt: string
                state: string
                author: GitHubUser | null
              }>
            }
          }>
        }
      } | null
    } | null
  }

  const [prResp, restFiles] = await Promise.all([
    graphql<RawPRResp>(pat, query, { owner, repo, number }),
    fetchRestPRFiles(pat, owner, repo, number),
  ])

  const pr = prResp.repository?.pullRequest
  if (!pr) {
    throw new Error(`Pull Request ${owner}/${repo}#${number} not found`)
  }

  // Hybrid local-first blob loading: read from linked local git checkout when available,
  // and fall back to GitHub GraphQL only for missing blobs.
  const contentsMap = new Map<string, { base: string | null; head: string | null }>()
  let remainingFiles = restFiles

  if (localRepoPath && isTauriRuntime() && restFiles.length > 0) {
    const specs: GitBlobSpec[] = []
    const specTargets: Array<{ filename: string; side: 'base' | 'head'; idx: number }> = []

    for (const f of restFiles) {
      const status = mapFileStatus(f.status)
      if (status !== 'added') {
        specTargets.push({ filename: f.filename, side: 'base', idx: specs.length })
        specs.push({ oid: pr.baseRefOid, path: f.previous_filename ?? f.filename })
      }
      if (status !== 'deleted') {
        specTargets.push({ filename: f.filename, side: 'head', idx: specs.length })
        specs.push({ oid: pr.headRefOid, path: f.filename })
      }
    }

    const localBlobs = await gitReadBlobs(localRepoPath, specs)
    if (localBlobs) {
      const missingFiles = new Set<string>()
      for (const f of restFiles) {
        contentsMap.set(f.filename, { base: null, head: null })
      }
      for (const target of specTargets) {
        const text = localBlobs[target.idx] ?? null
        if (text === null) {
          missingFiles.add(target.filename)
        } else {
          contentsMap.get(target.filename)![target.side] = text
        }
      }
      remainingFiles = restFiles.filter((f) => missingFiles.has(f.filename))
    }
  }

  if (remainingFiles.length > 0) {
    const remoteMap = await fetchFileContentsBatch(
      pat,
      owner,
      repo,
      pr.baseRefOid,
      pr.headRefOid,
      remainingFiles,
    )
    for (const [k, v] of remoteMap.entries()) {
      contentsMap.set(k, v)
    }
  }

  const files: PRFile[] = restFiles.map((rf) => {
    const content = contentsMap.get(rf.filename) ?? { base: null, head: null }
    return {
      path: rf.filename,
      previousPath: rf.previous_filename,
      status: mapFileStatus(rf.status),
      additions: rf.additions,
      deletions: rf.deletions,
      patch: rf.patch ?? '',
      baseContent: content.base,
      headContent: content.head,
      language: detectLanguage(rf.filename),
    }
  })

  const commits: PRCommit[] = pr.commits.nodes.map((n) => ({
    oid: n.commit.oid,
    shortOid: n.commit.abbreviatedOid,
    messageHeadline: n.commit.messageHeadline,
    authorName: n.commit.author?.name ?? 'Unknown',
    committedDate: n.commit.committedDate,
  }))

  const threads: ReviewThread[] = pr.reviewThreads.nodes
    .filter((t) => t.line !== null)
    .map((t) => ({
      id: t.id,
      path: t.path,
      line: t.line ?? 1,
      side: t.diffSide ?? 'RIGHT',
      startLine: t.startLine,
      startSide: t.startDiffSide,
      isResolved: t.isResolved,
      isOutdated: t.isOutdated,
      comments: t.comments.nodes.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        isPending: c.state === 'PENDING',
        author: c.author ?? { login: 'ghost', avatarUrl: '' },
      })),
    }))

  return {
    id: pr.id,
    owner,
    repo,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    url: pr.url,
    state: pr.state,
    author: pr.author ?? { login: 'ghost', avatarUrl: '' },
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    baseRefOid: pr.baseRefOid,
    headRefOid: pr.headRefOid,
    commits,
    files,
    threads,
    pendingReviewId: pr.reviews.nodes[0]?.id ?? null,
  }
}

export async function createPendingReview(
  pat: string,
  pullRequestId: string,
): Promise<string> {
  const mutation = `
    mutation CreatePendingReview($pullRequestId: ID!) {
      addPullRequestReview(input: { pullRequestId: $pullRequestId }) {
        pullRequestReview {
          id
        }
      }
    }
  `
  const data = await graphql<{
    addPullRequestReview: { pullRequestReview: { id: string } }
  }>(pat, mutation, { pullRequestId })
  return data.addPullRequestReview.pullRequestReview.id
}

export async function addReviewThread(
  pat: string,
  pullRequestId: string,
  pullRequestReviewId: string,
  path: string,
  line: number,
  side: DiffSide,
  body: string,
  startLine?: number,
  startSide?: DiffSide,
): Promise<string> {
  const isMultiline = startLine !== undefined && startLine !== line
  const mutation = `
    mutation AddReviewThread(
      $pullRequestId: ID!
      $pullRequestReviewId: ID!
      $path: String!
      $line: Int!
      $side: DiffSide!
      ${isMultiline ? '$startLine: Int!\n      $startSide: DiffSide!' : ''}
      $body: String!
    ) {
      addPullRequestReviewThread(
        input: {
          pullRequestId: $pullRequestId
          pullRequestReviewId: $pullRequestReviewId
          path: $path
          line: $line
          side: $side
          ${isMultiline ? 'startLine: $startLine\n          startSide: $startSide' : ''}
          body: $body
        }
      ) {
        thread {
          id
        }
      }
    }
  `
  const data = await graphql<{
    addPullRequestReviewThread: { thread: { id: string } }
  }>(pat, mutation, {
    pullRequestId,
    pullRequestReviewId,
    path,
    line,
    side,
    ...(isMultiline ? { startLine, startSide: startSide ?? side } : {}),
    body,
  })
  return data.addPullRequestReviewThread.thread.id
}

export async function replyToReviewThread(
  pat: string,
  pullRequestReviewThreadId: string,
  body: string,
): Promise<ReviewComment> {
  const mutation = `
    mutation ReplyToReviewThread($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(
        input: { pullRequestReviewThreadId: $threadId, body: $body }
      ) {
        comment {
          id
          body
          createdAt
          author {
            login
            avatarUrl
          }
        }
      }
    }
  `
  const data = await graphql<{
    addPullRequestReviewThreadReply: {
      comment: {
        id: string
        body: string
        createdAt: string
        author: GitHubUser | null
      }
    }
  }>(pat, mutation, { threadId: pullRequestReviewThreadId, body })

  const c = data.addPullRequestReviewThreadReply.comment
  return {
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    author: c.author ?? { login: 'ghost', avatarUrl: '' },
  }
}

export async function setReviewThreadResolved(
  pat: string,
  threadId: string,
  resolved: boolean,
): Promise<boolean> {
  const mutation = resolved
    ? `
      mutation ResolveThread($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread { isResolved }
        }
      }
    `
    : `
      mutation UnresolveThread($threadId: ID!) {
        unresolveReviewThread(input: { threadId: $threadId }) {
          thread { isResolved }
        }
      }
    `
  const data = await graphql<Record<string, { thread: { isResolved: boolean } }>>(
    pat,
    mutation,
    { threadId },
  )
  const key = resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
  return data[key].thread.isResolved
}

export async function submitReview(
  pat: string,
  pullRequestId: string,
  pullRequestReviewId: string,
  event: ReviewEvent,
  body: string,
): Promise<void> {
  const mutation = `
    mutation SubmitReview(
      $pullRequestId: ID!
      $pullRequestReviewId: ID!
      $event: PullRequestReviewEvent!
      $body: String
    ) {
      submitPullRequestReview(
        input: {
          pullRequestId: $pullRequestId
          pullRequestReviewId: $pullRequestReviewId
          event: $event
          body: $body
        }
      ) {
        pullRequestReview {
          id
          state
        }
      }
    }
  `
  await graphql(pat, mutation, {
    pullRequestId,
    pullRequestReviewId,
    event,
    body,
  })
}
