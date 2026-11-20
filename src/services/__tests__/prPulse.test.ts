import { describe, expect, it } from 'vitest'
import type { PRHeadPulse } from '@/services/github'
import {
  baselineFromPR,
  baselineFromPulse,
  completeBaseline,
  detectPulseChange,
} from '@/services/prPulse'

const pr = { headRefOid: 'abc', updatedAt: '2026-11-20T10:00:00Z' }
const pulse: PRHeadPulse = { ...pr, commentCount: 75, threadCount: 12 }

describe('detectPulseChange', () => {
  it('ignores counts until the baseline knows them', () => {
    expect(detectPulseChange(baselineFromPR(pr), pulse)).toBeNull()
  })

  it('detects new commits', () => {
    expect(detectPulseChange(baselineFromPR(pr), { ...pulse, headRefOid: 'def' })).toBe('commits')
  })

  it('detects a later updatedAt', () => {
    expect(
      detectPulseChange(baselineFromPR(pr), { ...pulse, updatedAt: '2026-11-20T10:00:01Z' }),
    ).toBe('activity')
  })

  it('detects increased counts once the baseline is complete', () => {
    const baseline = completeBaseline(baselineFromPR(pr), pulse)
    expect(detectPulseChange(baseline, pulse)).toBeNull()
    expect(detectPulseChange(baseline, { ...pulse, commentCount: 76 })).toBe('activity')
    expect(detectPulseChange(baseline, { ...pulse, threadCount: 13 })).toBe('activity')
  })

  it('treats an acknowledged pulse as unchanged', () => {
    const later = { ...pulse, updatedAt: '2026-11-20T11:00:00Z', commentCount: 80 }
    expect(detectPulseChange(baselineFromPulse(later), later)).toBeNull()
  })
})
