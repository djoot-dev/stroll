import { httpFetch } from './http'
import { gitReadBlobs, isTauriRuntime, type GitBlobSpec } from './native'
import { isGeneratedOrLockfile } from './readingOrder'
import type {
  CheckRollupState,
  DiffSide,
  FileChangeStatus,
  FileViewedState,
  GitHubUser,
  PRCommit,
  PRFile,
  PRFilterMode,
  PRIssueComment,
  PRLabel,
  PRMergeableState,
  PRMergeMethod,
  PRRequestedReviewer,
  PRReview,
  PRReviewDecision,
  PRReviewState,
  PRStatusCheck,
  PRStatusCheckRollup,
  PRSummary,
  PullRequestData,
  ReactionContent,
  ReactionGroup,
  ReviewComment,
  ReviewEvent,
  ReviewThread,
} from '@/types/pr'

const MAX_PR_FILES = 3000
const MAX_COMMIT_PAGES = 10
const MAX_THREAD_PAGES = 20
const MAX_FILE_VIEWED_PAGES = 30
const DEFAULT_GITHUB_HOST = 'github.com'
let configuredGitHubHost = DEFAULT_GITHUB_HOST

export function normalizeGitHubHost(rawHost: string): string {
  const cleaned = rawHost
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
  return cleaned || DEFAULT_GITHUB_HOST
}

export function setGitHubHost(host: string): void {
  configuredGitHubHost = normalizeGitHubHost(host)
}

export function getGitHubHost(): string {
  return configuredGitHubHost
}

export function getGitHubEndpoints(host?: string): { graphqlUrl: string; restUrl: string } {
  const normalized = normalizeGitHubHost(host ?? configuredGitHubHost)
  if (normalized === DEFAULT_GITHUB_HOST) {
    return {
      graphqlUrl: 'https://api.github.com/graphql',
      restUrl: 'https://api.github.com',
    }
  }
  return {
    graphqlUrl: `https://${normalized}/api/graphql`,
    restUrl: `https://${normalized}/api/v3`,
  }
}

interface GraphQLResponse<T> {
  data?: T
  errors?: Array<{ message: string; type?: string }>
}

async function graphql<T>(
  pat: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const { graphqlUrl } = getGitHubEndpoints()
  const res = await httpFetch(graphqlUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Stroll-Desktop',
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
  customHost?: string,
): { owner: string; repo: string; number: number } | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }

  const allowedHosts = new Set<string>([
    DEFAULT_GITHUB_HOST,
    normalizeGitHubHost(customHost ?? configuredGitHubHost),
  ])

  const urlHost = parsed.host.toLowerCase()
  const urlHostname = parsed.hostname.toLowerCase()
  if (!allowedHosts.has(urlHost) && !allowedHosts.has(urlHostname)) {
    return null
  }

  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/i)
  if (!match) return null
  return {
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
  }
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'avif',
  'bmp',
  'pdf',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'icns',
  'exe',
  'dll',
  'so',
  'dylib',
  'wasm',
  'mp3',
  'mp4',
  'mov',
  'webm',
  'wav',
  'ogg',
  'sqlite',
  'db',
  'jar',
  'class',
  'pyc',
  'o',
  'a',
  'bin',
  'dmg',
  'pkg',
  'apk',
  'ipa',
  'lockb',
  'xls',
  'xlsx',
  'doc',
  'docx',
  'ppt',
  'pptx',
])

export function getImageMimeType(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_MIME_TYPES[ext] ?? null
}

export function isImageFilePath(path: string): boolean {
  return getImageMimeType(path) !== null
}

export function isBinaryFilePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXTENSIONS.has(ext)
}

export function detectLanguage(path: string): string {
  const fileName = (path.split('/').pop() ?? path).toLowerCase()
  if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) {
    return 'dockerfile'
  }
  if (
    fileName === '.bashrc' ||
    fileName === '.zshrc' ||
    fileName === '.bash_profile' ||
    fileName === '.profile'
  ) {
    return 'shell'
  }

  const ext = fileName.includes('.') ? (fileName.split('.').pop() ?? '') : ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    vue: 'vue',
    rs: 'rust',
    py: 'python',
    cs: 'csharp',
    go: 'go',
    java: 'java',
    c: 'cpp',
    h: 'cpp',
    cc: 'cpp',
    cpp: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hxx: 'cpp',
    hh: 'cpp',
    php: 'php',
    xml: 'xml',
    svg: 'xml',
    plist: 'xml',
    csproj: 'xml',
    props: 'xml',
    targets: 'xml',
    xaml: 'xml',
    resx: 'xml',
    sql: 'sql',
    json: 'json',
    jsonc: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    html: 'html',
    htm: 'html',
    md: 'markdown',
    markdown: 'markdown',
    toml: 'toml',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    fish: 'shell',
    rb: 'ruby',
    rake: 'ruby',
    gemspec: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    kts: 'kotlin',
    dockerfile: 'dockerfile',
  }
  return map[ext] ?? 'text'
}

const PR_SEARCH_QUERIES: Record<PRFilterMode, string> = {
  'review-requested': 'is:pr is:open review-requested:@me sort:updated-desc',
  authored: 'is:pr is:open author:@me sort:updated-desc',
  involves: 'is:pr is:open involves:@me sort:updated-desc',
}

export async function fetchViewerAndRequestedPRs(
  pat: string,
  filter: PRFilterMode = 'review-requested',
  after: string | null = null,
  pageSize = 30,
): Promise<{
  viewer: GitHubUser
  requestedPRs: PRSummary[]
  hasNextPage: boolean
  endCursor: string | null
}> {
  const searchQuery = PR_SEARCH_QUERIES[filter]
  const query = `
    query ViewerAndRequestedPRs($searchQuery: String!, $first: Int!, $after: String) {
      viewer {
        login
        name
        avatarUrl
      }
      search(query: $searchQuery, type: ISSUE, first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
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
            isDraft
            reviewDecision
            totalCommentsCount
            commits(last: 1) {
              nodes {
                commit {
                  statusCheckRollup {
                    state
                  }
                }
              }
            }
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
      pageInfo: {
        hasNextPage: boolean
        endCursor: string | null
      }
      nodes: Array<{
        id: string
        number: number
        title: string
        url: string
        updatedAt: string
        additions: number
        deletions: number
        changedFiles: number
        isDraft: boolean
        reviewDecision: PRReviewDecision
        totalCommentsCount: number | null
        commits: {
          nodes: Array<{
            commit: {
              statusCheckRollup: {
                state: CheckRollupState
              } | null
            }
          }>
        } | null
        author: GitHubUser | null
        repository: { name: string; owner: { login: string } }
      } | null>
    }
  }

  const data = await graphql<RawResp>(pat, query, {
    searchQuery,
    first: pageSize,
    after,
  })
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
      isDraft: Boolean(n.isDraft),
      reviewDecision: n.reviewDecision ?? null,
      ciState: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
      totalCommentsCount: n.totalCommentsCount ?? 0,
    }))

  return {
    viewer: data.viewer,
    requestedPRs,
    hasNextPage: data.search.pageInfo.hasNextPage,
    endCursor: data.search.pageInfo.endCursor,
  }
}

export interface RestPRFile {
  sha?: string
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

function parseNextLinkUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i)
  return match ? match[1] : null
}

/**
 * Fetches all changed files for a PR via GitHub REST API, following pagination
 * (`Link: <...>; rel="next"` or incrementing `page`) up to GitHub's 3,000-file cap.
 */
export async function fetchRestPRFiles(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  maxFiles = MAX_PR_FILES,
): Promise<RestPRFile[]> {
  const { restUrl } = getGitHubEndpoints()
  const perPage = 100
  const allFiles: RestPRFile[] = []
  let page = 1
  let nextUrl: string | null =
    `${restUrl}/repos/${owner}/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`

  while (nextUrl && allFiles.length < maxFiles) {
    const res = await httpFetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Stroll-Desktop',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GitHub REST /files error (${res.status}): ${text}`)
    }

    const batch = (await res.json()) as RestPRFile[]
    if (!Array.isArray(batch) || batch.length === 0) break

    allFiles.push(...batch)
    if (allFiles.length >= maxFiles) break

    const linkHeader = res.headers?.get?.('link') ?? res.headers?.get?.('Link') ?? null
    const linkNext = parseNextLinkUrl(linkHeader)
    if (linkNext) {
      nextUrl = linkNext
    } else if (linkHeader) {
      // Server provided Link header without rel="next" -> last page reached
      nextUrl = null
    } else if (batch.length === perPage) {
      page += 1
      nextUrl = `${restUrl}/repos/${owner}/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`
    } else {
      nextUrl = null
    }
  }

  return allFiles.slice(0, maxFiles)
}

/**
 * Fetches a binary/image file from GitHub using the user's PAT and returns
 * an inline `data:<mime>;base64,...` URL so private repositories work seamlessly.
 */
export async function fetchFileBlobDataUrl(
  pat: string,
  owner: string,
  repo: string,
  path: string,
  refOid: string,
  blobSha?: string,
): Promise<string | null> {
  const { restUrl } = getGitHubEndpoints()
  const mime = getImageMimeType(path) ?? 'application/octet-stream'
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Stroll-Desktop',
  }

  // Prefer Git Blobs API when blob SHA is already known (works for files > 1MB too)
  if (blobSha) {
    const blobRes = await httpFetch(
      `${restUrl}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(blobSha)}`,
      { headers },
    )
    if (blobRes.ok) {
      const blobJson = (await blobRes.json()) as { content?: string; encoding?: string }
      if (blobJson.content && blobJson.encoding === 'base64') {
        const clean = blobJson.content.replace(/\s+/g, '')
        return `data:${mime};base64,${clean}`
      }
    }
  }

  const encodedPath = path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  const contentsRes = await httpFetch(
    `${restUrl}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(refOid)}`,
    { headers },
  )
  if (!contentsRes.ok) return null

  const contentsJson = (await contentsRes.json()) as {
    content?: string
    encoding?: string
    sha?: string
  }

  if (contentsJson.content && contentsJson.encoding === 'base64') {
    const clean = contentsJson.content.replace(/\s+/g, '')
    return `data:${mime};base64,${clean}`
  }

  // Fallback to git blob endpoint for files > 1MB where /contents omits `content`
  if (contentsJson.sha) {
    const blobRes = await httpFetch(
      `${restUrl}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(contentsJson.sha)}`,
      { headers },
    )
    if (blobRes.ok) {
      const blobJson = (await blobRes.json()) as { content?: string; encoding?: string }
      if (blobJson.content && blobJson.encoding === 'base64') {
        const clean = blobJson.content.replace(/\s+/g, '')
        return `data:${mime};base64,${clean}`
      }
    }
  }

  return null
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
): Promise<Map<string, { base: string | null; head: string | null; isBinary: boolean }>> {
  const result = new Map<string, { base: string | null; head: string | null; isBinary: boolean }>()
  const chunkSize = 20

  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize)
    const fields: string[] = []

    chunk.forEach((f, idx) => {
      const status = mapFileStatus(f.status)
      if (status !== 'added') {
        const basePath = f.previous_filename ?? f.filename
        const expr = `${baseOid}:${basePath}`.replace(/"/g, '\\"')
        fields.push(`b_${idx}: object(expression: "${expr}") { ... on Blob { text isBinary } }`)
      }
      if (status !== 'deleted') {
        const expr = `${headOid}:${f.filename}`.replace(/"/g, '\\"')
        fields.push(`h_${idx}: object(expression: "${expr}") { ... on Blob { text isBinary } }`)
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
      repository: Record<string, { text?: string | null; isBinary?: boolean } | null>
    }

    const data = await graphql<BlobResp>(pat, query, { owner, repo })
    chunk.forEach((f, idx) => {
      const baseBlob = data.repository[`b_${idx}`]
      const headBlob = data.repository[`h_${idx}`]
      result.set(f.filename, {
        base: baseBlob?.text ?? null,
        head: headBlob?.text ?? null,
        isBinary: Boolean(baseBlob?.isBinary || headBlob?.isBinary),
      })
    })
  }

  return result
}

interface RawCommitNode {
  commit: {
    oid: string
    abbreviatedOid: string
    messageHeadline: string
    committedDate: string
    author: { name?: string | null } | null
  }
}

interface RawReactionGroup {
  content: ReactionContent
  viewerHasReacted: boolean
  reactors: {
    totalCount: number
  }
}

function mapReactionGroups(groups?: RawReactionGroup[] | null): ReactionGroup[] | undefined {
  if (!groups || groups.length === 0) return undefined
  const mapped = groups
    .filter((g) => g.reactors.totalCount > 0)
    .map((g) => ({
      content: g.content,
      count: g.reactors.totalCount,
      viewerHasReacted: g.viewerHasReacted,
    }))
  return mapped.length > 0 ? mapped : undefined
}

interface RawThreadNode {
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
      reactionGroups?: RawReactionGroup[]
    }>
  }
}

interface PageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

interface RawFileViewedNode {
  path: string
  viewerViewedState: FileViewedState
}

async function fetchRemainingFileViewedStates(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  initialCursor: string,
): Promise<RawFileViewedNode[]> {
  const extra: RawFileViewedNode[] = []
  let cursor: string | null = initialCursor
  let pages = 0

  const query = `
    query PullRequestFilesViewedPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          files(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              path
              viewerViewedState
            }
          }
        }
      }
    }
  `

  while (cursor && pages < MAX_FILE_VIEWED_PAGES) {
    pages += 1
    const resp: {
      repository: {
        pullRequest: {
          files: { pageInfo: PageInfo; nodes: RawFileViewedNode[] }
        } | null
      } | null
    } = await graphql(pat, query, { owner, repo, number, after: cursor })
    const conn = resp.repository?.pullRequest?.files
    if (!conn) break
    extra.push(...conn.nodes)
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
  }

  return extra
}

async function fetchRemainingCommits(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  initialCursor: string,
): Promise<RawCommitNode[]> {
  const extra: RawCommitNode[] = []
  let cursor: string | null = initialCursor
  let pages = 0

  const query = `
    query PullRequestCommitsPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          commits(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
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
        }
      }
    }
  `

  interface CommitsPageResp {
    repository: {
      pullRequest: {
        commits: { pageInfo: PageInfo; nodes: RawCommitNode[] }
      } | null
    } | null
  }

  while (cursor && pages < MAX_COMMIT_PAGES) {
    pages += 1
    const resp: CommitsPageResp = await graphql<CommitsPageResp>(pat, query, {
      owner,
      repo,
      number,
      after: cursor,
    })
    const conn = resp.repository?.pullRequest?.commits
    if (!conn) break
    extra.push(...conn.nodes)
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
  }

  return extra
}

async function fetchRemainingReviewThreads(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  initialCursor: string,
): Promise<RawThreadNode[]> {
  const extra: RawThreadNode[] = []
  let cursor: string | null = initialCursor
  let pages = 0

  const query = `
    query PullRequestThreadsPage($owner: String!, $repo: String!, $number: Int!, $after: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
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
                  reactionGroups {
                    content
                    viewerHasReacted
                    reactors {
                      totalCount
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `

  interface ThreadsPageResp {
    repository: {
      pullRequest: {
        reviewThreads: { pageInfo: PageInfo; nodes: RawThreadNode[] }
      } | null
    } | null
  }

  while (cursor && pages < MAX_THREAD_PAGES) {
    pages += 1
    const resp: ThreadsPageResp = await graphql<ThreadsPageResp>(pat, query, {
      owner,
      repo,
      number,
      after: cursor,
    })
    const conn = resp.repository?.pullRequest?.reviewThreads
    if (!conn) break
    extra.push(...conn.nodes)
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null
  }

  return extra
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
          isDraft
          mergeable
          reviewDecision
          createdAt
          updatedAt
          baseRefName
          headRefName
          baseRefOid
          headRefOid
          author {
            login
            avatarUrl
          }
          labels(first: 20) {
            nodes {
              name
              color
            }
          }
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                __typename
                ... on User {
                  login
                  name
                  avatarUrl
                }
                ... on Team {
                  name
                  slug
                  avatarUrl
                }
              }
            }
          }
          commits(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
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
          headCommit: commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                  contexts(first: 50) {
                    nodes {
                      __typename
                      ... on CheckRun {
                        id
                        name
                        status
                        conclusion
                        detailsUrl
                        title
                      }
                      ... on StatusContext {
                        id
                        context
                        state
                        targetUrl
                        description
                      }
                    }
                  }
                }
              }
            }
          }
          pendingReviews: reviews(first: 20, states: [PENDING]) {
            nodes {
              id
              author {
                login
              }
            }
          }
          reviews(last: 50) {
            nodes {
              id
              state
              body
              submittedAt
              author {
                login
                avatarUrl
              }
              reactionGroups {
                content
                viewerHasReacted
                reactors {
                  totalCount
                }
              }
            }
          }
          comments(first: 50) {
            nodes {
              id
              body
              createdAt
              author {
                login
                avatarUrl
              }
              reactionGroups {
                content
                viewerHasReacted
                reactors {
                  totalCount
                }
              }
            }
          }
          reviewThreads(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
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
                  reactionGroups {
                    content
                    viewerHasReacted
                    reactors {
                      totalCount
                    }
                  }
                }
              }
            }
          }
          files(first: 100) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              path
              viewerViewedState
            }
          }
        }
      }
    }
  `

  interface RawCheckRun {
    __typename: 'CheckRun'
    id: string
    name: string
    status: string
    conclusion: string | null
    detailsUrl: string | null
    title: string | null
  }

  interface RawStatusContext {
    __typename: 'StatusContext'
    id: string
    context: string
    state: string
    targetUrl: string | null
    description: string | null
  }

  interface RawPRResp {
    repository: {
      pullRequest: {
        id: string
        number: number
        title: string
        body: string
        url: string
        state: 'OPEN' | 'CLOSED' | 'MERGED'
        isDraft: boolean
        mergeable: PRMergeableState
        reviewDecision: PRReviewDecision
        createdAt: string
        updatedAt: string
        baseRefName: string
        headRefName: string
        baseRefOid: string
        headRefOid: string
        author: GitHubUser | null
        labels: {
          nodes: Array<PRLabel | null>
        }
        reviewRequests: {
          nodes: Array<{
            requestedReviewer:
              | { __typename: 'User'; login: string; name?: string | null; avatarUrl: string }
              | { __typename: 'Team'; name: string; slug: string; avatarUrl?: string | null }
              | { __typename: string }
              | null
          } | null>
        }
        commits: {
          pageInfo?: PageInfo
          nodes: RawCommitNode[]
        }
        headCommit: {
          nodes: Array<{
            commit: {
              statusCheckRollup: {
                state: CheckRollupState
                contexts: {
                  nodes: Array<RawCheckRun | RawStatusContext | { __typename: string } | null>
                }
              } | null
            }
          }>
        }
        pendingReviews: {
          nodes: Array<{ id: string; author: { login: string } | null }>
        }
        reviews: {
          nodes: Array<{
            id: string
            state: PRReviewState
            body: string
            submittedAt: string | null
            author: GitHubUser | null
            reactionGroups?: RawReactionGroup[]
          } | null>
        }
        comments: {
          nodes: Array<{
            id: string
            body: string
            createdAt: string
            author: GitHubUser | null
            reactionGroups?: RawReactionGroup[]
          } | null>
        }
        reviewThreads: {
          pageInfo?: PageInfo
          nodes: RawThreadNode[]
        }
        files?: {
          pageInfo?: PageInfo
          nodes: RawFileViewedNode[]
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

  // Paginate remaining commits, reviewThreads & file viewed states if truncated
  const [extraCommits, extraThreads, extraFileViewed] = await Promise.all([
    pr.commits.pageInfo?.hasNextPage && pr.commits.pageInfo.endCursor
      ? fetchRemainingCommits(pat, owner, repo, number, pr.commits.pageInfo.endCursor)
      : Promise.resolve([] as RawCommitNode[]),
    pr.reviewThreads.pageInfo?.hasNextPage && pr.reviewThreads.pageInfo.endCursor
      ? fetchRemainingReviewThreads(pat, owner, repo, number, pr.reviewThreads.pageInfo.endCursor)
      : Promise.resolve([] as RawThreadNode[]),
    pr.files?.pageInfo?.hasNextPage && pr.files.pageInfo.endCursor
      ? fetchRemainingFileViewedStates(pat, owner, repo, number, pr.files.pageInfo.endCursor)
      : Promise.resolve([] as RawFileViewedNode[]),
  ])

  const viewedStateMap = new Map<string, FileViewedState>()
  for (const node of [...(pr.files?.nodes ?? []), ...extraFileViewed]) {
    if (node?.path && node.viewerViewedState) {
      viewedStateMap.set(node.path, node.viewerViewedState)
    }
  }

  // Avoid fetching full text blobs for binary or generated/lockfiles where unnecessary
  const blobEligibleFiles = restFiles.filter(
    (rf) => !isBinaryFilePath(rf.filename) && !isGeneratedOrLockfile(rf.filename),
  )

  // Hybrid local-first blob loading: read from linked local git checkout when available,
  // and fall back to GitHub GraphQL only for missing blobs.
  const contentsMap = new Map<
    string,
    { base: string | null; head: string | null; isBinary: boolean }
  >()
  let remainingFiles = blobEligibleFiles

  if (localRepoPath && isTauriRuntime() && blobEligibleFiles.length > 0) {
    const specs: GitBlobSpec[] = []
    const specTargets: Array<{ filename: string; side: 'base' | 'head'; idx: number }> = []

    for (const f of blobEligibleFiles) {
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
      for (const f of blobEligibleFiles) {
        contentsMap.set(f.filename, { base: null, head: null, isBinary: false })
      }
      for (const target of specTargets) {
        const text = localBlobs[target.idx] ?? null
        if (text === null) {
          missingFiles.add(target.filename)
        } else {
          contentsMap.get(target.filename)![target.side] = text
        }
      }
      remainingFiles = blobEligibleFiles.filter((f) => missingFiles.has(f.filename))
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
    const content = contentsMap.get(rf.filename) ?? { base: null, head: null, isBinary: false }
    const status = mapFileStatus(rf.status)
    const patch = rf.patch ?? ''
    const isImage = isImageFilePath(rf.filename)
    const isGenerated = isGeneratedOrLockfile(rf.filename)
    const isPureMove =
      status === 'renamed' && !patch.trim() && rf.additions === 0 && rf.deletions === 0
    const isBinary =
      content.isBinary ||
      isBinaryFilePath(rf.filename) ||
      (!patch.trim() &&
        !isPureMove &&
        !isGenerated &&
        content.base === null &&
        content.head === null &&
        rf.additions === 0 &&
        rf.deletions === 0)

    return {
      path: rf.filename,
      previousPath: rf.previous_filename,
      status,
      additions: rf.additions,
      deletions: rf.deletions,
      sha: rf.sha,
      patch,
      baseContent: content.base,
      headContent: content.head,
      language: detectLanguage(rf.filename),
      isBinary: isBinary || undefined,
      isImage: isImage || undefined,
      isGenerated: isGenerated || undefined,
      viewerViewedState: viewedStateMap.get(rf.filename),
    }
  })

  const allCommitNodes = [...pr.commits.nodes, ...extraCommits]
  const commits: PRCommit[] = allCommitNodes.map((n) => ({
    oid: n.commit.oid,
    shortOid: n.commit.abbreviatedOid,
    messageHeadline: n.commit.messageHeadline,
    authorName: n.commit.author?.name ?? 'Unknown',
    committedDate: n.commit.committedDate,
  }))

  const allThreadNodes = [...pr.reviewThreads.nodes, ...extraThreads]
  const threads: ReviewThread[] = allThreadNodes
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
        reactions: mapReactionGroups(c.reactionGroups),
      })),
    }))

  const labels: PRLabel[] = (pr.labels?.nodes ?? [])
    .filter((l): l is PRLabel => Boolean(l && l.name))
    .map((l) => ({ name: l.name, color: l.color }))

  const requestedReviewers: PRRequestedReviewer[] = []
  for (const node of pr.reviewRequests?.nodes ?? []) {
    const reviewer = node?.requestedReviewer
    if (!reviewer) continue
    if (reviewer.__typename === 'User' && 'login' in reviewer) {
      requestedReviewers.push({
        type: 'user',
        login: reviewer.login,
        name: reviewer.name ?? null,
        avatarUrl: reviewer.avatarUrl,
      })
    } else if (reviewer.__typename === 'Team' && 'slug' in reviewer) {
      requestedReviewers.push({
        type: 'team',
        login: reviewer.slug,
        name: reviewer.name,
        avatarUrl: reviewer.avatarUrl ?? '',
      })
    }
  }

  const reviews: PRReview[] = (pr.reviews?.nodes ?? [])
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({
      id: r.id,
      author: r.author ?? { login: 'ghost', avatarUrl: '' },
      state: r.state,
      body: r.body ?? '',
      submittedAt: r.submittedAt,
      reactions: mapReactionGroups(r.reactionGroups),
    }))

  const issueComments: PRIssueComment[] = (pr.comments?.nodes ?? [])
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      id: c.id,
      author: c.author ?? { login: 'ghost', avatarUrl: '' },
      body: c.body,
      createdAt: c.createdAt,
      reactions: mapReactionGroups(c.reactionGroups),
    }))

  const rawRollup = pr.headCommit?.nodes?.[0]?.commit?.statusCheckRollup ?? null
  let statusCheckRollup: PRStatusCheckRollup | null = null
  if (rawRollup) {
    const checks: PRStatusCheck[] = []
    for (const ctx of rawRollup.contexts?.nodes ?? []) {
      if (!ctx) continue
      if (ctx.__typename === 'CheckRun' && 'name' in ctx) {
        checks.push({
          id: ctx.id,
          name: ctx.name,
          kind: 'check-run',
          status: ctx.status,
          conclusion: ctx.conclusion,
          url: ctx.detailsUrl,
          description: ctx.title,
        })
      } else if (ctx.__typename === 'StatusContext' && 'context' in ctx) {
        checks.push({
          id: ctx.id,
          name: ctx.context,
          kind: 'status-context',
          status: ctx.state,
          conclusion: ctx.state,
          url: ctx.targetUrl,
          description: ctx.description,
        })
      }
    }
    statusCheckRollup = {
      state: rawRollup.state,
      checks,
    }
  }

  return {
    id: pr.id,
    owner,
    repo,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    url: pr.url,
    state: pr.state,
    isDraft: Boolean(pr.isDraft),
    mergeable: pr.mergeable ?? 'UNKNOWN',
    reviewDecision: pr.reviewDecision ?? null,
    labels,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    author: pr.author ?? { login: 'ghost', avatarUrl: '' },
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    baseRefOid: pr.baseRefOid,
    headRefOid: pr.headRefOid,
    commits,
    files,
    threads,
    requestedReviewers,
    reviews,
    issueComments,
    statusCheckRollup,
    pendingReviewId: pr.pendingReviews?.nodes?.[0]?.id ?? null,
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

export async function addPRComment(
  pat: string,
  pullRequestId: string,
  body: string,
): Promise<PRIssueComment> {
  const mutation = `
    mutation AddPRComment($subjectId: ID!, $body: String!) {
      addComment(input: { subjectId: $subjectId, body: $body }) {
        commentEdge {
          node {
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
    }
  `
  const data = await graphql<{
    addComment: {
      commentEdge: {
        node: {
          id: string
          body: string
          createdAt: string
          author: GitHubUser | null
        }
      }
    }
  }>(pat, mutation, { subjectId: pullRequestId, body })

  const node = data.addComment.commentEdge.node
  return {
    id: node.id,
    body: node.body,
    createdAt: node.createdAt,
    author: node.author ?? { login: 'ghost', avatarUrl: '' },
  }
}

export async function setFileViewedState(
  pat: string,
  pullRequestId: string,
  path: string,
  viewed: boolean,
): Promise<FileViewedState> {
  const mutation = viewed
    ? `
      mutation MarkFileAsViewed($pullRequestId: ID!, $path: String!) {
        markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
          pullRequest { id }
        }
      }
    `
    : `
      mutation UnmarkFileAsViewed($pullRequestId: ID!, $path: String!) {
        unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) {
          pullRequest { id }
        }
      }
    `
  await graphql(pat, mutation, { pullRequestId, path })
  return viewed ? 'VIEWED' : 'UNVIEWED'
}

export async function updateReviewComment(
  pat: string,
  commentId: string,
  body: string,
): Promise<string> {
  const mutation = `
    mutation UpdateReviewComment($commentId: ID!, $body: String!) {
      updatePullRequestReviewComment(
        input: { pullRequestReviewCommentId: $commentId, body: $body }
      ) {
        pullRequestReviewComment {
          id
          body
        }
      }
    }
  `
  const data = await graphql<{
    updatePullRequestReviewComment: {
      pullRequestReviewComment: { id: string; body: string }
    }
  }>(pat, mutation, { commentId, body })
  return data.updatePullRequestReviewComment.pullRequestReviewComment.body
}

export async function deleteReviewComment(pat: string, commentId: string): Promise<void> {
  const mutation = `
    mutation DeleteReviewComment($commentId: ID!) {
      deletePullRequestReviewComment(input: { id: $commentId }) {
        pullRequestReview {
          id
        }
      }
    }
  `
  await graphql(pat, mutation, { commentId })
}

export async function updateIssueComment(
  pat: string,
  commentId: string,
  body: string,
): Promise<string> {
  const mutation = `
    mutation UpdateIssueComment($commentId: ID!, $body: String!) {
      updateIssueComment(input: { id: $commentId, body: $body }) {
        issueComment {
          id
          body
        }
      }
    }
  `
  const data = await graphql<{
    updateIssueComment: {
      issueComment: { id: string; body: string }
    }
  }>(pat, mutation, { commentId, body })
  return data.updateIssueComment.issueComment.body
}

export async function deleteIssueComment(pat: string, commentId: string): Promise<void> {
  const mutation = `
    mutation DeleteIssueComment($commentId: ID!) {
      deleteIssueComment(input: { id: $commentId }) {
        clientMutationId
      }
    }
  `
  await graphql(pat, mutation, { commentId })
}

export async function toggleReaction(
  pat: string,
  subjectId: string,
  content: ReactionContent,
  add: boolean,
): Promise<void> {
  const mutation = add
    ? `
      mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
        addReaction(input: { subjectId: $subjectId, content: $content }) {
          subject { id }
        }
      }
    `
    : `
      mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
        removeReaction(input: { subjectId: $subjectId, content: $content }) {
          subject { id }
        }
      }
    `
  await graphql(pat, mutation, { subjectId, content })
}

export async function mergePullRequest(
  pat: string,
  pullRequestId: string,
  mergeMethod: PRMergeMethod,
  commitHeadline?: string,
): Promise<'MERGED'> {
  const mutation = `
    mutation MergePullRequest(
      $pullRequestId: ID!
      $mergeMethod: PullRequestMergeMethod!
      $commitHeadline: String
    ) {
      mergePullRequest(
        input: {
          pullRequestId: $pullRequestId
          mergeMethod: $mergeMethod
          commitHeadline: $commitHeadline
        }
      ) {
        pullRequest {
          state
        }
      }
    }
  `
  const data = await graphql<{ mergePullRequest: { pullRequest: { state: 'MERGED' } } }>(
    pat,
    mutation,
    {
      pullRequestId,
      mergeMethod,
      ...(commitHeadline?.trim() ? { commitHeadline: commitHeadline.trim() } : {}),
    },
  )
  return data.mergePullRequest.pullRequest.state
}

export async function closePullRequest(pat: string, pullRequestId: string): Promise<'CLOSED'> {
  const mutation = `
    mutation ClosePullRequest($pullRequestId: ID!) {
      closePullRequest(input: { pullRequestId: $pullRequestId }) {
        pullRequest { state }
      }
    }
  `
  const data = await graphql<{ closePullRequest: { pullRequest: { state: 'CLOSED' } } }>(
    pat,
    mutation,
    { pullRequestId },
  )
  return data.closePullRequest.pullRequest.state
}

export async function reopenPullRequest(pat: string, pullRequestId: string): Promise<'OPEN'> {
  const mutation = `
    mutation ReopenPullRequest($pullRequestId: ID!) {
      reopenPullRequest(input: { pullRequestId: $pullRequestId }) {
        pullRequest { state }
      }
    }
  `
  const data = await graphql<{ reopenPullRequest: { pullRequest: { state: 'OPEN' } } }>(
    pat,
    mutation,
    { pullRequestId },
  )
  return data.reopenPullRequest.pullRequest.state
}

export async function setPullRequestDraft(
  pat: string,
  pullRequestId: string,
  isDraft: boolean,
): Promise<boolean> {
  const mutation = isDraft
    ? `
      mutation ConvertPullRequestToDraft($pullRequestId: ID!) {
        convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
          pullRequest { isDraft }
        }
      }
    `
    : `
      mutation MarkPullRequestReadyForReview($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest { isDraft }
        }
      }
    `
  const data = await graphql<Record<string, { pullRequest: { isDraft: boolean } }>>(
    pat,
    mutation,
    { pullRequestId },
  )
  const key = isDraft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
  return data[key].pullRequest.isDraft
}

async function restJsonRequest<T>(
  pat: string,
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const { restUrl } = getGitHubEndpoints()
  const res = await httpFetch(`${restUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Stroll-Desktop',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GitHub REST ${method} ${path} failed (${res.status}): ${text}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function requestPullRequestReviewers(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  reviewers: string[],
): Promise<PRRequestedReviewer[]> {
  interface Resp {
    requested_reviewers?: Array<{ login: string; avatar_url?: string }>
  }
  const data = await restJsonRequest<Resp>(
    pat,
    'POST',
    `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`,
    { reviewers },
  )
  return (data.requested_reviewers ?? []).map((u) => ({
    type: 'user',
    login: u.login,
    avatarUrl: u.avatar_url ?? '',
  }))
}

export async function removePullRequestReviewers(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  reviewers: string[],
): Promise<void> {
  await restJsonRequest(
    pat,
    'DELETE',
    `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`,
    { reviewers },
  )
}

export async function addPullRequestLabels(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  labels: string[],
): Promise<PRLabel[]> {
  const data = await restJsonRequest<Array<{ name: string; color: string }>>(
    pat,
    'POST',
    `/repos/${owner}/${repo}/issues/${number}/labels`,
    { labels },
  )
  return data.map((l) => ({ name: l.name, color: l.color }))
}

export async function removePullRequestLabel(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  labelName: string,
): Promise<void> {
  await restJsonRequest(
    pat,
    'DELETE',
    `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(labelName)}`,
  )
}

async function hydrateRestFiles(
  pat: string,
  owner: string,
  repo: string,
  baseOid: string,
  headOid: string,
  restFiles: RestPRFile[],
): Promise<PRFile[]> {
  const blobEligible = restFiles.filter(
    (rf) => !isBinaryFilePath(rf.filename) && !isGeneratedOrLockfile(rf.filename),
  )
  const contentsMap =
    blobEligible.length > 0 && baseOid && headOid
      ? await fetchFileContentsBatch(pat, owner, repo, baseOid, headOid, blobEligible)
      : new Map<string, { base: string | null; head: string | null; isBinary: boolean }>()

  return restFiles.map((rf) => {
    const content = contentsMap.get(rf.filename) ?? { base: null, head: null, isBinary: false }
    const status = mapFileStatus(rf.status)
    const patch = rf.patch ?? ''
    const isImage = isImageFilePath(rf.filename)
    const isGenerated = isGeneratedOrLockfile(rf.filename)
    const isPureMove =
      status === 'renamed' && !patch.trim() && rf.additions === 0 && rf.deletions === 0
    const isBinary =
      content.isBinary ||
      isBinaryFilePath(rf.filename) ||
      (!patch.trim() &&
        !isPureMove &&
        !isGenerated &&
        content.base === null &&
        content.head === null &&
        rf.additions === 0 &&
        rf.deletions === 0)

    return {
      path: rf.filename,
      previousPath: rf.previous_filename,
      status,
      additions: rf.additions,
      deletions: rf.deletions,
      sha: rf.sha,
      patch,
      baseContent: content.base,
      headContent: content.head,
      language: detectLanguage(rf.filename),
      isBinary: isBinary || undefined,
      isImage: isImage || undefined,
      isGenerated: isGenerated || undefined,
    }
  })
}

export async function fetchCommitDiffFiles(
  pat: string,
  owner: string,
  repo: string,
  commitOid: string,
): Promise<PRFile[]> {
  const { restUrl } = getGitHubEndpoints()
  const res = await httpFetch(`${restUrl}/repos/${owner}/${repo}/commits/${commitOid}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Stroll-Desktop',
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch commit ${commitOid.slice(0, 7)} (${res.status})`)
  }
  const data = (await res.json()) as {
    parents?: Array<{ sha: string }>
    files?: RestPRFile[]
  }
  const baseOid = data.parents?.[0]?.sha ?? ''
  return hydrateRestFiles(pat, owner, repo, baseOid, commitOid, data.files ?? [])
}

export async function fetchCompareDiffFiles(
  pat: string,
  owner: string,
  repo: string,
  baseOid: string,
  headOid: string,
): Promise<PRFile[]> {
  const { restUrl } = getGitHubEndpoints()
  const res = await httpFetch(
    `${restUrl}/repos/${owner}/${repo}/compare/${encodeURIComponent(baseOid)}...${encodeURIComponent(headOid)}`,
    {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Stroll-Desktop',
      },
    },
  )
  if (!res.ok) {
    throw new Error(`Failed to compare ${baseOid.slice(0, 7)}...${headOid.slice(0, 7)} (${res.status})`)
  }
  const data = (await res.json()) as { files?: RestPRFile[] }
  return hydrateRestFiles(pat, owner, repo, baseOid, headOid, data.files ?? [])
}

export interface PRHeadPulse {
  headRefOid: string
  updatedAt: string
  commentCount: number
  threadCount: number
}

export async function fetchPRHeadPulse(
  pat: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PRHeadPulse | null> {
  const query = `
    query PRHeadPulse($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          headRefOid
          updatedAt
          comments { totalCount }
          reviewThreads { totalCount }
        }
      }
    }
  `
  const resp = await graphql<{
    repository: {
      pullRequest: {
        headRefOid: string
        updatedAt: string
        comments: { totalCount: number }
        reviewThreads: { totalCount: number }
      } | null
    } | null
  }>(pat, query, { owner, repo, number })
  const pr = resp.repository?.pullRequest
  if (!pr) return null
  return {
    headRefOid: pr.headRefOid,
    updatedAt: pr.updatedAt,
    commentCount: pr.comments.totalCount,
    threadCount: pr.reviewThreads.totalCount,
  }
}
