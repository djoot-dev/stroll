import { describe, expect, it } from 'vitest'
import { computeRemainingReviewEstimate } from '@/services/reviewEstimate'
import type { TourStep } from '@/types/pr'

function makeStep(
  path: string,
  additions: number,
  deletions: number,
  overrides: Partial<TourStep> & { isBinary?: boolean; isImage?: boolean } = {},
): TourStep {
  const { isBinary, isImage, ...stepOverrides } = overrides
  return {
    stepIndex: 0,
    layer: 'core',
    reason: 'Core logic',
    dependencies: [],
    dependents: [],
    referencedContexts: [],
    file: {
      path,
      status: 'modified',
      additions,
      deletions,
      patch: '',
      baseContent: null,
      headContent: null,
      language: 'typescript',
      isBinary,
      isImage,
      isGenerated: stepOverrides.isGenerated,
    },
    ...stepOverrides,
  }
}

describe('computeRemainingReviewEstimate', () => {
  it('returns null when there are no tour steps', () => {
    expect(computeRemainingReviewEstimate([], () => false)).toBeNull()
  })

  it('returns all caught up when every step is reviewed', () => {
    const steps = [makeStep('src/a.ts', 20, 5), makeStep('src/b.ts', 10, 0)]
    const estimate = computeRemainingReviewEstimate(steps, () => true)
    expect(estimate).toEqual({
      remainingFiles: 0,
      remainingLines: 0,
      estimatedMinutes: 0,
      timeLabel: '0 min left',
      summary: 'All caught up · 0 files remaining',
    })
  })

  it('computes calm time and effort remaining for unreviewed steps', () => {
    const steps = [
      makeStep('src/a.ts', 30, 10),
      makeStep('src/b.ts', 24, 6),
      makeStep('src/c.ts', 20, 4),
      makeStep('src/done.ts', 100, 50),
    ]
    const reviewed = new Set(['src/done.ts'])
    const estimate = computeRemainingReviewEstimate(steps, (p) => reviewed.has(p))

    expect(estimate).toEqual({
      remainingFiles: 3,
      remainingLines: 94,
      estimatedMinutes: 5,
      timeLabel: '~5 min left',
      summary: '~5 min left · 3 files, 94 lines remaining',
    })
  })

  it('uses singular nouns and < 1 min left for tiny diffs', () => {
    const steps = [makeStep('src/tiny.ts', 1, 0)]
    const estimate = computeRemainingReviewEstimate(steps, () => false)

    expect(estimate?.summary).toBe('< 1 min left · 1 file, 1 line remaining')
  })

  it('discounts generated and binary files so lockfiles do not inflate estimates', () => {
    const steps = [
      makeStep('bun.lock', 4500, 1200, { isGenerated: true }),
      makeStep('assets/logo.png', 0, 0, { isBinary: true, isImage: true }),
    ]
    const estimate = computeRemainingReviewEstimate(steps, () => false)

    expect(estimate?.remainingFiles).toBe(2)
    expect(estimate?.remainingLines).toBe(0)
    expect(estimate?.timeLabel).toBe('< 1 min left')
    expect(estimate?.summary).toBe('< 1 min left · 2 files remaining')
  })

  it('formats hour-scale estimates rounded to 5-minute increments', () => {
    const steps = [
      makeStep('src/big1.ts', 1000, 200),
      makeStep('src/big2.ts', 500, 100),
    ]
    const estimate = computeRemainingReviewEstimate(steps, () => false)

    // 2 * 20s + 1800 * 2.5s = 4540s = 75.67 min -> rounded to 75 min = 1 hr 15 min
    expect(estimate?.timeLabel).toBe('~1 hr 15 min left')
    expect(estimate?.summary).toBe('~1 hr 15 min left · 2 files, 1800 lines remaining')
  })
})
