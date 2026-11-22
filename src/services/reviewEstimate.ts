import type { TourStep } from '@/types/pr'

const BASE_SECONDS_PER_FILE = 20
const SECONDS_PER_LINE = 2.5
const GENERATED_FILE_SECONDS = 10
const BINARY_FILE_SECONDS = 15

export interface ReviewEstimate {
  remainingFiles: number
  remainingLines: number
  estimatedMinutes: number
  timeLabel: string
  summary: string
}

function formatDurationLeft(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0 min left'
  if (totalSeconds < 45) return '< 1 min left'

  const minutes = Math.max(1, Math.round(totalSeconds / 60))
  if (minutes < 60) {
    return `~${minutes} min left`
  }

  const rounded = Math.round(minutes / 5) * 5
  const hrs = Math.floor(rounded / 60)
  const mins = rounded % 60
  return mins === 0 ? `~${hrs} hr left` : `~${hrs} hr ${mins} min left`
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Estimates the remaining review time and effort across unreviewed tour steps.
 * Generated and binary/image files contribute a small flat skim cost so lockfiles
 * do not inflate the time estimate.
 */
export function computeRemainingReviewEstimate(
  tourSteps: readonly TourStep[],
  isReviewed: (path: string) => boolean,
): ReviewEstimate | null {
  if (tourSteps.length === 0) return null

  let remainingFiles = 0
  let remainingLines = 0
  let totalSeconds = 0

  for (const step of tourSteps) {
    if (isReviewed(step.file.path)) continue

    remainingFiles += 1
    const isGenerated = Boolean(step.isGenerated || step.file.isGenerated)
    const isBinary = Boolean(step.file.isBinary || step.file.isImage)

    if (isBinary) {
      totalSeconds += BINARY_FILE_SECONDS
    } else if (isGenerated) {
      totalSeconds += GENERATED_FILE_SECONDS
    } else {
      const lines = Math.max(0, step.file.additions + step.file.deletions)
      remainingLines += lines
      totalSeconds += BASE_SECONDS_PER_FILE + lines * SECONDS_PER_LINE
    }
  }

  if (remainingFiles === 0) {
    return {
      remainingFiles: 0,
      remainingLines: 0,
      estimatedMinutes: 0,
      timeLabel: '0 min left',
      summary: 'All caught up · 0 files remaining',
    }
  }

  const timeLabel = formatDurationLeft(totalSeconds)
  const estimatedMinutes = Math.max(1, Math.round(totalSeconds / 60))
  const filePart = pluralize(remainingFiles, 'file')
  const effortPart =
    remainingLines > 0
      ? `${filePart}, ${pluralize(remainingLines, 'line')} remaining`
      : `${filePart} remaining`

  return {
    remainingFiles,
    remainingLines,
    estimatedMinutes,
    timeLabel,
    summary: `${timeLabel} · ${effortPart}`,
  }
}
