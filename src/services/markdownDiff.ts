import type { DiffLine, DiffSegment } from '@/services/diffParser'
import {
  escapeMarkdownHtml,
  renderCodeBlockShell,
  renderSafeMarkdownBlocks,
  tableAlignmentClass,
  type MarkdownBlock,
  type MarkdownListItemBlock,
  type MarkdownTableRowBlock,
} from '@/services/markdown'
import type { DiffSide, FileChangeStatus } from '@/types/pr'

export type MarkdownDiffChangeKind = 'unchanged' | 'added' | 'removed' | 'modified'

export interface MarkdownDiffLineAnchor {
  line: number
  side: DiffSide
}

export interface MarkdownDiffLineRange {
  startLine: number
  endLine: number
}

export interface MarkdownDiffBlock {
  id: string
  changeKind: MarkdownDiffChangeKind
  /** Rendered HTML for unchanged/added/removed blocks, or sub-block diffed modified blocks (list/table/code). */
  html?: string
  /** Rendered base HTML when a modified block is shown as a removed + added pair. */
  removedHtml?: string
  /** Rendered head HTML when a modified block is shown as a removed + added pair. */
  addedHtml?: string
  baseRange?: MarkdownDiffLineRange
  headRange?: MarkdownDiffLineRange
  /** Last changed line in this block (RIGHT for added/modified, LEFT for removed). */
  commentAnchor?: MarkdownDiffLineAnchor
  /** First changed line in this block for Preview -> Source jump. */
  jumpAnchor?: MarkdownDiffLineAnchor
}

export interface BuildMarkdownDiffOptions {
  baseContent: string | null
  headContent: string | null
  status: FileChangeStatus
  segments: DiffSegment[]
  repoContext?: { owner: string; repo: string }
}

interface ChangeCluster {
  id: number
  oldLines: Set<number>
  newLines: Set<number>
  anchorNewLine: number
  nextContextNewLine: number
  anchorOldLine: number
  nextContextOldLine: number
}

function rangeHasAnyLine(start: number, end: number, set: Set<number>): boolean {
  for (let ln = start; ln <= end; ln += 1) {
    if (set.has(ln)) return true
  }
  return false
}

function firstChangedLineInRange(start: number, end: number, set: Set<number>): number | null {
  for (let ln = start; ln <= end; ln += 1) {
    if (set.has(ln)) return ln
  }
  return null
}

function lastChangedLineInRange(start: number, end: number, set: Set<number>): number | null {
  for (let ln = end; ln >= start; ln -= 1) {
    if (set.has(ln)) return ln
  }
  return null
}

function buildChangeClusters(segments: DiffSegment[]): {
  clusters: ChangeCluster[]
  addedNewLines: Set<number>
  removedOldLines: Set<number>
  allLines: DiffLine[]
} {
  const allLines = segments.flatMap((seg) => seg.lines)
  const addedNewLines = new Set<number>()
  const removedOldLines = new Set<number>()
  const clusters: ChangeCluster[] = []

  let lastContextNewLine = 0
  let lastContextOldLine = 0
  let current: ChangeCluster | null = null

  for (const line of allLines) {
    if (line.type === 'context') {
      if (current) {
        current.nextContextNewLine = line.newLineNumber ?? Number.POSITIVE_INFINITY
        current.nextContextOldLine = line.oldLineNumber ?? Number.POSITIVE_INFINITY
        clusters.push(current)
        current = null
      }
      if (line.newLineNumber !== null) {
        lastContextNewLine = line.newLineNumber
      }
      if (line.oldLineNumber !== null) {
        lastContextOldLine = line.oldLineNumber
      }
      continue
    }

    if (!current) {
      current = {
        id: clusters.length,
        oldLines: new Set<number>(),
        newLines: new Set<number>(),
        anchorNewLine: lastContextNewLine,
        nextContextNewLine: Number.POSITIVE_INFINITY,
        anchorOldLine: lastContextOldLine,
        nextContextOldLine: Number.POSITIVE_INFINITY,
      }
    }

    if (line.type === 'del' && line.oldLineNumber !== null) {
      current.oldLines.add(line.oldLineNumber)
      removedOldLines.add(line.oldLineNumber)
    } else if (line.type === 'add' && line.newLineNumber !== null) {
      current.newLines.add(line.newLineNumber)
      addedNewLines.add(line.newLineNumber)
    }
  }

  if (current) {
    clusters.push(current)
  }

  return { clusters, addedNewLines, removedOldLines, allLines }
}

function clusterIdsForRange(
  start: number,
  end: number,
  clusters: ChangeCluster[],
  side: 'old' | 'new',
): Set<number> {
  const ids = new Set<number>()
  for (const cluster of clusters) {
    const lines = side === 'old' ? cluster.oldLines : cluster.newLines
    if (rangeHasAnyLine(start, end, lines)) {
      ids.add(cluster.id)
    }
  }
  return ids
}

function setsIntersect(a: Set<number>, b: Set<number>): boolean {
  for (const item of a) {
    if (b.has(item)) return true
  }
  return false
}

function tablesShareSchema(
  baseBlock: MarkdownBlock,
  headBlock: MarkdownBlock,
  removedOldLines: Set<number>,
  addedNewLines: Set<number>,
): boolean {
  const bMeta = baseBlock.tableMeta
  const hMeta = headBlock.tableMeta
  if (!bMeta || !hMeta) return false
  if (
    removedOldLines.has(bMeta.headerStartLine) ||
    removedOldLines.has(bMeta.separatorLine) ||
    addedNewLines.has(hMeta.headerStartLine) ||
    addedNewLines.has(hMeta.separatorLine)
  ) {
    return false
  }
  if (bMeta.headers.length !== hMeta.headers.length) return false
  return bMeta.headers.every((hdr, idx) => hdr === hMeta.headers[idx])
}

function renderDiffCodeBlock(
  baseBlock: MarkdownBlock,
  headBlock: MarkdownBlock,
  allLines: DiffLine[],
): string | null {
  const bCode = baseBlock.codeMeta
  const hCode = headBlock.codeMeta
  if (!bCode || !hCode) return null

  const bContentStart = bCode.contentStartLine
  const bContentEnd = bContentStart + bCode.codeLines.length - 1
  const hContentStart = hCode.contentStartLine
  const hContentEnd = hContentStart + hCode.codeLines.length - 1

  const innerLines: string[] = []
  let hasDiffLine = false

  for (const line of allLines) {
    const inBase =
      line.oldLineNumber !== null &&
      line.oldLineNumber >= bContentStart &&
      line.oldLineNumber <= bContentEnd
    const inHead =
      line.newLineNumber !== null &&
      line.newLineNumber >= hContentStart &&
      line.newLineNumber <= hContentEnd

    if (line.type === 'del' && inBase) {
      hasDiffLine = true
      innerLines.push(
        `<div data-code-line-row="del" class="-mx-3 flex gap-2 bg-diff-del px-3 text-diff-del-text line-through decoration-crimson/50"><span class="w-4 shrink-0 select-none opacity-75">-</span><span data-code-line="del" class="whitespace-pre-wrap">${escapeMarkdownHtml(line.content) || ' '}</span></div>`,
      )
    } else if (line.type === 'add' && inHead) {
      hasDiffLine = true
      innerLines.push(
        `<div data-code-line-row="add" class="-mx-3 flex gap-2 bg-diff-add px-3 text-diff-add-text"><span class="w-4 shrink-0 select-none opacity-75">+</span><span data-code-line="keep" class="whitespace-pre-wrap">${escapeMarkdownHtml(line.content) || ' '}</span></div>`,
      )
    } else if (line.type === 'context' && (inBase || inHead)) {
      innerLines.push(
        `<div class="flex gap-2"><span class="w-4 shrink-0 select-none text-ink-faint"> </span><span data-code-line="keep" class="whitespace-pre-wrap">${escapeMarkdownHtml(line.content) || ' '}</span></div>`,
      )
    }
  }

  if (!hasDiffLine) {
    // Only the fence header/lang or closing fence changed
    return null
  }

  return renderCodeBlockShell(hCode.lang, innerLines.join(''))
}

function renderTableRow(
  row: MarkdownTableRowBlock,
  alignments: Array<'left' | 'center' | 'right'>,
  colCount: number,
  kind: 'unchanged' | 'added' | 'removed',
): string {
  const rowClass =
    kind === 'removed'
      ? 'bg-diff-del/70 text-diff-del-text line-through opacity-85 last:[&>td]:border-b-0'
      : kind === 'added'
        ? 'bg-diff-add/70 last:[&>td]:border-b-0'
        : 'last:[&>td]:border-b-0'
  const firstBorder =
    kind === 'removed'
      ? 'first:border-l-2 first:border-l-diff-del-border'
      : kind === 'added'
        ? 'first:border-l-2 first:border-l-diff-add-border'
        : ''
  const textTone = kind === 'removed' ? 'text-diff-del-text' : 'text-ink-secondary'

  const tds = Array.from({ length: colCount }, (_v, idx) => {
    const html = row.cellsHtml[idx] ?? ''
    return `<td class="border-b border-border-muted px-3 py-1.5 ${textTone} ${firstBorder} ${tableAlignmentClass(alignments[idx])}">${html}</td>`
  }).join('')
  return `<tr class="${rowClass}">${tds}</tr>`
}

function renderDiffTableBlock(
  baseBlock: MarkdownBlock,
  headBlock: MarkdownBlock,
  removedOldLines: Set<number>,
  addedNewLines: Set<number>,
): string {
  const bMeta = baseBlock.tableMeta!
  const hMeta = headBlock.tableMeta!
  const bRows = bMeta.rows
  const hRows = hMeta.rows
  const colCount = hMeta.headers.length

  const bRemoved = bRows.map((r) => removedOldLines.has(r.line))
  const hAdded = hRows.map((r) => addedNewLines.has(r.line))

  const trs: string[] = []
  let bi = 0
  let hi = 0

  while (hi < hRows.length) {
    if (!hAdded[hi]) {
      while (bi < bRows.length && bRemoved[bi]) {
        trs.push(renderTableRow(bRows[bi], bMeta.alignments, colCount, 'removed'))
        bi += 1
      }
      trs.push(renderTableRow(hRows[hi], hMeta.alignments, colCount, 'unchanged'))
      if (bi < bRows.length) bi += 1
      hi += 1
      continue
    }

    while (bi < bRows.length && bRemoved[bi]) {
      trs.push(renderTableRow(bRows[bi], bMeta.alignments, colCount, 'removed'))
      bi += 1
    }
    while (hi < hRows.length && hAdded[hi]) {
      trs.push(renderTableRow(hRows[hi], hMeta.alignments, colCount, 'added'))
      hi += 1
    }
  }

  while (bi < bRows.length) {
    if (bRemoved[bi]) {
      trs.push(renderTableRow(bRows[bi], bMeta.alignments, colCount, 'removed'))
    }
    bi += 1
  }

  return `<div class="my-3 overflow-x-auto rounded-lg border border-border"><table class="w-full border-collapse text-xs"><thead>${hMeta.headerHtml}</thead><tbody>${trs.join('')}</tbody></table></div>`
}

function renderListItem(item: MarkdownListItemBlock, kind: 'unchanged' | 'added' | 'removed'): string {
  if (kind === 'removed') {
    return `<li class="my-0.5 rounded border-l-2 border-l-diff-del-border bg-diff-del/65 px-2 py-0.5 text-diff-del-text line-through opacity-85">${item.innerHtml}</li>`
  }
  if (kind === 'added') {
    return `<li class="my-0.5 rounded border-l-2 border-l-diff-add-border bg-diff-add/65 px-2 py-0.5">${item.innerHtml}</li>`
  }
  return `<li>${item.innerHtml}</li>`
}

function renderDiffListBlock(
  baseBlock: MarkdownBlock,
  headBlock: MarkdownBlock,
  removedOldLines: Set<number>,
  addedNewLines: Set<number>,
): string {
  const bMeta = baseBlock.listMeta!
  const hMeta = headBlock.listMeta!
  const bItems = bMeta.items
  const hItems = hMeta.items

  const bRemoved = bItems.map((it) => rangeHasAnyLine(it.startLine, it.endLine, removedOldLines))
  const hAdded = hItems.map((it) => rangeHasAnyLine(it.startLine, it.endLine, addedNewLines))

  const lis: string[] = []
  let bi = 0
  let hi = 0

  while (hi < hItems.length) {
    if (!hAdded[hi]) {
      while (bi < bItems.length && bRemoved[bi]) {
        lis.push(renderListItem(bItems[bi], 'removed'))
        bi += 1
      }
      lis.push(renderListItem(hItems[hi], 'unchanged'))
      if (bi < bItems.length) bi += 1
      hi += 1
      continue
    }

    while (bi < bItems.length && bRemoved[bi]) {
      lis.push(renderListItem(bItems[bi], 'removed'))
      bi += 1
    }
    while (hi < hItems.length && hAdded[hi]) {
      lis.push(renderListItem(hItems[hi], 'added'))
      hi += 1
    }
  }

  while (bi < bItems.length) {
    if (bRemoved[bi]) {
      lis.push(renderListItem(bItems[bi], 'removed'))
    }
    bi += 1
  }

  const tag = hMeta.ordered ? 'ol' : 'ul'
  return `<${tag} class="${hMeta.listClass}">${lis.join('')}</${tag}>`
}

function makeRemovedBlock(
  block: MarkdownBlock,
  id: string,
  removedOldLines: Set<number>,
): MarkdownDiffBlock {
  const firstDel =
    firstChangedLineInRange(block.startLine, block.endLine, removedOldLines) ?? block.startLine
  const lastDel =
    lastChangedLineInRange(block.startLine, block.endLine, removedOldLines) ?? block.endLine
  return {
    id,
    changeKind: 'removed',
    html: block.html,
    baseRange: { startLine: block.startLine, endLine: block.endLine },
    commentAnchor: { line: lastDel, side: 'LEFT' },
    jumpAnchor: { line: firstDel, side: 'LEFT' },
  }
}

function makeAddedBlock(
  block: MarkdownBlock,
  id: string,
  addedNewLines: Set<number>,
): MarkdownDiffBlock {
  const firstAdd =
    firstChangedLineInRange(block.startLine, block.endLine, addedNewLines) ?? block.startLine
  const lastAdd =
    lastChangedLineInRange(block.startLine, block.endLine, addedNewLines) ?? block.endLine
  return {
    id,
    changeKind: 'added',
    html: block.html,
    headRange: { startLine: block.startLine, endLine: block.endLine },
    commentAnchor: { line: lastAdd, side: 'RIGHT' },
    jumpAnchor: { line: firstAdd, side: 'RIGHT' },
  }
}

function makeModifiedPairBlock(
  baseBlock: MarkdownBlock,
  headBlock: MarkdownBlock,
  id: string,
  removedOldLines: Set<number>,
  addedNewLines: Set<number>,
  allLines: DiffLine[],
): MarkdownDiffBlock {
  const firstAdd = firstChangedLineInRange(headBlock.startLine, headBlock.endLine, addedNewLines)
  const lastAdd = lastChangedLineInRange(headBlock.startLine, headBlock.endLine, addedNewLines)
  const firstDel = firstChangedLineInRange(baseBlock.startLine, baseBlock.endLine, removedOldLines)
  const lastDel = lastChangedLineInRange(baseBlock.startLine, baseBlock.endLine, removedOldLines)

  const baseRange = { startLine: baseBlock.startLine, endLine: baseBlock.endLine }
  const headRange = { startLine: headBlock.startLine, endLine: headBlock.endLine }
  const commentAnchor: MarkdownDiffLineAnchor =
    lastAdd !== null
      ? { line: lastAdd, side: 'RIGHT' }
      : { line: lastDel ?? baseBlock.endLine, side: 'LEFT' }
  const jumpAnchor: MarkdownDiffLineAnchor =
    firstAdd !== null
      ? { line: firstAdd, side: 'RIGHT' }
      : { line: firstDel ?? baseBlock.startLine, side: 'LEFT' }

  if (baseBlock.kind === 'code' && headBlock.kind === 'code') {
    const diffCodeHtml = renderDiffCodeBlock(baseBlock, headBlock, allLines)
    if (diffCodeHtml) {
      return {
        id,
        changeKind: 'modified',
        html: diffCodeHtml,
        baseRange,
        headRange,
        commentAnchor,
        jumpAnchor,
      }
    }
  }

  if (
    baseBlock.kind === 'table' &&
    headBlock.kind === 'table' &&
    tablesShareSchema(baseBlock, headBlock, removedOldLines, addedNewLines)
  ) {
    return {
      id,
      changeKind: 'modified',
      html: renderDiffTableBlock(baseBlock, headBlock, removedOldLines, addedNewLines),
      baseRange,
      headRange,
      commentAnchor,
      jumpAnchor,
    }
  }

  if (
    baseBlock.kind === 'list' &&
    headBlock.kind === 'list' &&
    baseBlock.listMeta?.ordered === headBlock.listMeta?.ordered
  ) {
    return {
      id,
      changeKind: 'modified',
      html: renderDiffListBlock(baseBlock, headBlock, removedOldLines, addedNewLines),
      baseRange,
      headRange,
      commentAnchor,
      jumpAnchor,
    }
  }

  return {
    id,
    changeKind: 'modified',
    removedHtml: baseBlock.html,
    addedHtml: headBlock.html,
    baseRange,
    headRange,
    commentAnchor,
    jumpAnchor,
  }
}

function pairWeight(
  b: MarkdownBlock,
  h: MarkdownBlock,
  removedOldLines: Set<number>,
  addedNewLines: Set<number>,
): number {
  if (b.kind !== h.kind) return 0
  if (b.kind === 'table') {
    return tablesShareSchema(b, h, removedOldLines, addedNewLines) ? 10 : 0
  }
  if (b.kind === 'list') {
    return b.listMeta?.ordered === h.listMeta?.ordered ? 10 : 0
  }
  if (b.kind === 'code') return 10
  return 1
}

function emitMatchedGroup(
  groupBase: MarkdownBlock[],
  groupHead: MarkdownBlock[],
  out: MarkdownDiffBlock[],
  nextId: () => string,
  removedOldLines: Set<number>,
  addedNewLines: Set<number>,
  allLines: DiffLine[],
) {
  const m = groupBase.length
  const n = groupHead.length

  if (m === 0) {
    for (const h of groupHead) out.push(makeAddedBlock(h, nextId(), addedNewLines))
    return
  }
  if (n === 0) {
    for (const b of groupBase) out.push(makeRemovedBlock(b, nextId(), removedOldLines))
    return
  }
  if (m === 1 && n === 1) {
    out.push(
      makeModifiedPairBlock(
        groupBase[0],
        groupHead[0],
        nextId(),
        removedOldLines,
        addedNewLines,
        allLines,
      ),
    )
    return
  }

  // Maximum-weight order-preserving pairing between groupBase and groupHead
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      const w = pairWeight(groupBase[i], groupHead[j], removedOldLines, addedNewLines)
      const pairScore = w > 0 ? w + dp[i + 1][j + 1] : -1
      dp[i][j] = Math.max(pairScore, dp[i + 1][j], dp[i][j + 1])
    }
  }

  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    const w = pairWeight(groupBase[i], groupHead[j], removedOldLines, addedNewLines)
    if (w > 0 && dp[i][j] === w + dp[i + 1][j + 1]) {
      pairs.push([i, j])
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }

  let bi = 0
  let hi = 0
  for (const [mb, mh] of pairs) {
    while (bi < mb) {
      out.push(makeRemovedBlock(groupBase[bi], nextId(), removedOldLines))
      bi += 1
    }
    while (hi < mh) {
      out.push(makeAddedBlock(groupHead[hi], nextId(), addedNewLines))
      hi += 1
    }
    out.push(
      makeModifiedPairBlock(
        groupBase[mb],
        groupHead[mh],
        nextId(),
        removedOldLines,
        addedNewLines,
        allLines,
      ),
    )
    bi += 1
    hi += 1
  }

  while (bi < m) {
    out.push(makeRemovedBlock(groupBase[bi], nextId(), removedOldLines))
    bi += 1
  }
  while (hi < n) {
    out.push(makeAddedBlock(groupHead[hi], nextId(), addedNewLines))
    hi += 1
  }
}

export function buildMarkdownDiffBlocks(options: BuildMarkdownDiffOptions): MarkdownDiffBlock[] {
  const { baseContent, headContent, status, segments, repoContext } = options
  const mdOpts = repoContext ? { repoContext } : undefined

  if (status === 'deleted') {
    const baseBlocks = renderSafeMarkdownBlocks(baseContent ?? '', mdOpts)
    return baseBlocks.map((b, idx) => ({
      id: `del-${idx}`,
      changeKind: 'removed',
      html: b.html,
      baseRange: { startLine: b.startLine, endLine: b.endLine },
      commentAnchor: { line: b.endLine, side: 'LEFT' },
      jumpAnchor: { line: b.startLine, side: 'LEFT' },
    }))
  }

  if (status === 'added' || (!baseContent && headContent)) {
    const headBlocks = renderSafeMarkdownBlocks(headContent ?? '', mdOpts)
    return headBlocks.map((b, idx) => ({
      id: `add-${idx}`,
      changeKind: 'added',
      html: b.html,
      headRange: { startLine: b.startLine, endLine: b.endLine },
      commentAnchor: { line: b.endLine, side: 'RIGHT' },
      jumpAnchor: { line: b.startLine, side: 'RIGHT' },
    }))
  }

  const headBlocks = renderSafeMarkdownBlocks(headContent ?? '', mdOpts)
  const baseBlocks = renderSafeMarkdownBlocks(baseContent ?? '', mdOpts)
  const { clusters, addedNewLines, removedOldLines, allLines } = buildChangeClusters(segments)

  if (addedNewLines.size === 0 && removedOldLines.size === 0) {
    return headBlocks.map((b, idx) => ({
      id: `head-${idx}`,
      changeKind: 'unchanged',
      html: b.html,
      headRange: { startLine: b.startLine, endLine: b.endLine },
    }))
  }

  const baseClusterIds = baseBlocks.map((b) => {
    const ids = clusterIdsForRange(b.startLine, b.endLine, clusters, 'old')
    // Pure-addition edits inside an existing base block (e.g. added line in a code fence, list item, or table row)
    for (const c of clusters) {
      if (c.oldLines.size === 0 && c.newLines.size > 0) {
        const insideBlock = c.anchorOldLine >= b.startLine && c.nextContextOldLine <= b.endLine
        const appendedToSubBlock =
          (b.kind === 'list' || b.kind === 'table') &&
          c.anchorOldLine >= b.startLine &&
          c.anchorOldLine <= b.endLine
        if (insideBlock || appendedToSubBlock) {
          ids.add(c.id)
        }
      }
    }
    return ids
  })
  const headClusterIds = headBlocks.map((h) => {
    const ids = clusterIdsForRange(h.startLine, h.endLine, clusters, 'new')
    // Pure-deletion edits inside an existing block (e.g. a deleted list item, table row, or prose line)
    for (const c of clusters) {
      if (
        c.newLines.size === 0 &&
        c.oldLines.size > 0 &&
        c.anchorNewLine >= h.startLine &&
        c.nextContextNewLine <= h.endLine
      ) {
        ids.add(c.id)
      }
    }
    return ids
  })

  const baseAnchorNewLine = baseBlocks.map((_b, idx) => {
    const ids = baseClusterIds[idx]
    let minAnchor = Number.POSITIVE_INFINITY
    for (const id of ids) {
      const c = clusters[id]
      if (c && c.anchorNewLine < minAnchor) minAnchor = c.anchorNewLine
    }
    return Number.isFinite(minAnchor) ? minAnchor : 0
  })

  const out: MarkdownDiffBlock[] = []
  let bi = 0
  let hi = 0
  let seq = 0

  while (hi < headBlocks.length) {
    const hClusters = headClusterIds[hi]

    if (hClusters.size === 0) {
      // Unchanged head block: emit any preceding pure-deletion base blocks first
      while (bi < baseBlocks.length) {
        const bClusters = baseClusterIds[bi]
        if (bClusters.size === 0) {
          // Consume matching untouched base block
          bi += 1
          break
        }
        if (baseAnchorNewLine[bi] < headBlocks[hi].startLine) {
          out.push(makeRemovedBlock(baseBlocks[bi], `md-block-${seq++}`, removedOldLines))
          bi += 1
          continue
        }
        break
      }

      out.push({
        id: `md-block-${seq++}`,
        changeKind: 'unchanged',
        html: headBlocks[hi].html,
        headRange: { startLine: headBlocks[hi].startLine, endLine: headBlocks[hi].endLine },
      })
      hi += 1
      continue
    }

    // Touched head block: collect connected cluster group
    const groupClusters = new Set<number>(hClusters)
    const groupBaseIndices: number[] = []
    const groupHeadIndices: number[] = [hi]
    hi += 1

    // Skip any untouched base blocks before this change region, and emit any pure deletions strictly before it
    while (bi < baseBlocks.length) {
      const bClusters = baseClusterIds[bi]
      if (bClusters.size === 0) {
        bi += 1
        continue
      }
      if (!setsIntersect(bClusters, groupClusters) && baseAnchorNewLine[bi] < headBlocks[groupHeadIndices[0]].startLine) {
        out.push(makeRemovedBlock(baseBlocks[bi], `md-block-${seq++}`, removedOldLines))
        bi += 1
        continue
      }
      break
    }

    // Expand connected component across touched base & head blocks sharing clusters
    let expanded = true
    while (expanded) {
      expanded = false
      while (bi < baseBlocks.length) {
        if (baseClusterIds[bi].size === 0) break
        if (setsIntersect(baseClusterIds[bi], groupClusters)) {
          groupBaseIndices.push(bi)
          for (const cid of baseClusterIds[bi]) groupClusters.add(cid)
          bi += 1
          expanded = true
        } else {
          break
        }
      }
      while (hi < headBlocks.length) {
        if (headClusterIds[hi].size === 0) break
        if (setsIntersect(headClusterIds[hi], groupClusters)) {
          groupHeadIndices.push(hi)
          for (const cid of headClusterIds[hi]) groupClusters.add(cid)
          hi += 1
          expanded = true
        } else {
          break
        }
      }
    }

    const nextId = () => `md-block-${seq++}`
    emitMatchedGroup(
      groupBaseIndices.map((idx) => baseBlocks[idx]),
      groupHeadIndices.map((idx) => headBlocks[idx]),
      out,
      nextId,
      removedOldLines,
      addedNewLines,
      allLines,
    )
  }

  // Trailing deletions after the last head block
  while (bi < baseBlocks.length) {
    if (baseClusterIds[bi].size > 0) {
      out.push(makeRemovedBlock(baseBlocks[bi], `md-block-${seq++}`, removedOldLines))
    }
    bi += 1
  }

  return out
}
