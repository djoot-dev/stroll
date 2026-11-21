import type { DiffLine } from './diffParser'

export interface SplitDiffRow {
  key: string
  left: DiffLine | null
  right: DiffLine | null
}

/**
 * Pairs unified `DiffLine` entries into side-by-side `SplitDiffRow` entries.
 * Context lines appear on both sides; contiguous deletion/addition blocks are
 * zipped row-by-row and padded with `null` on the shorter side.
 */
export function buildSplitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.type === 'context') {
      rows.push({ key: line.key, left: line, right: line })
      i += 1
      continue
    }

    const dels: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') {
      dels.push(lines[i])
      i += 1
    }

    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'add') {
      adds.push(lines[i])
      i += 1
    }

    const count = Math.max(dels.length, adds.length)
    for (let k = 0; k < count; k += 1) {
      const left = k < dels.length ? dels[k] : null
      const right = k < adds.length ? adds[k] : null
      const key = left && right ? `${left.key}__${right.key}` : (left?.key ?? right!.key)
      rows.push({ key, left, right })
    }
  }

  return rows
}
