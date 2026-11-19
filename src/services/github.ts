import { httpFetch } from './http'
import { gitReadBlobs, isTauriRuntime, type GitBlobSpec } from './native'
import { isGeneratedOrLockfile } from './readingOrder'
import type {
  DiffSide,
  FileChangeStatus,
  GitHubUser,
  PRCommit,
  PRFile,
  PRFilterMode,
  PRSummary,
  PullRequestData,
  ReviewComment,
  ReviewEvent,
  ReviewThread,
} from '@/types/pr'

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'
const GITHUB_REST_URL = 'https://api.github.com'
const MAX_PR_FILES = 3000
const MAX_COMMIT_PAGES = 10
const MAX_THREAD_PAGES = 20

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
  const perPage = 100
  const allFiles: RestPRFile[] = []
  let page = 1
  let nextUrl: string | null =
    `${GITHUB_REST_URL}/repos/${owner}/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`

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
      nextUrl = `${GITHUB_REST_URL}/repos/${owner}/${repo}/pulls/${number}/files?per_page=${perPage}&page=${page}`
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
  const mime = getImageMimeType(path) ?? 'application/octet-stream'
  const headers = {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Stroll-Desktop',
  }

  // Prefer Git Blobs API when blob SHA is already known (works for files > 1MB too)
  if (blobSha) {
    const blobRes = await httpFetch(
      `${GITHUB_REST_URL}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(blobSha)}`,
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
    `${GITHUB_REST_URL}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(refOid)}`,
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
      `${GITHUB_REST_URL}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(contentsJson.sha)}`,
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
    }>
  }
}

interface PageInfo {
  hasNextPage: boolean
  endCursor: string | null
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
          baseRefName
          headRefName
          baseRefOid
          headRefOid
          author {
            login
            avatarUrl
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
          reviews(first: 20, states: [PENDING]) {
            nodes {
              id
              author {
                login
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
          pageInfo?: PageInfo
          nodes: RawCommitNode[]
        }
        reviews: {
          nodes: Array<{ id: string; author: { login: string } | null }>
        }
        reviewThreads: {
          pageInfo?: PageInfo
          nodes: RawThreadNode[]
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

  // Paginate remaining commits & reviewThreads if truncated
  const [extraCommits, extraThreads] = await Promise.all([
    pr.commits.pageInfo?.hasNextPage && pr.commits.pageInfo.endCursor
      ? fetchRemainingCommits(pat, owner, repo, number, pr.commits.pageInfo.endCursor)
      : Promise.resolve([] as RawCommitNode[]),
    pr.reviewThreads.pageInfo?.hasNextPage && pr.reviewThreads.pageInfo.endCursor
      ? fetchRemainingReviewThreads(pat, owner, repo, number, pr.reviewThreads.pageInfo.endCursor)
      : Promise.resolve([] as RawThreadNode[]),
  ])

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
