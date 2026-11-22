import { describe, expect, it } from 'vitest'
import { getContextualShortcutHints, type ShortcutBarContext } from '@/services/shortcutsBar'

function hintMap(ctx: ShortcutBarContext) {
  return new Map(getContextualShortcutHints(ctx).map((h) => [h.id, h]))
}

describe('getContextualShortcutHints', () => {
  it('dims diff-only shortcuts (prev, mark-reviewed, find) on the Overview screen', () => {
    const hints = hintMap({
      hasPR: true,
      activeView: 'overview',
      stepCount: 5,
      currentStepIndex: 0,
      hasUnreviewedSteps: true,
      currentStepReviewed: false,
      isMac: true,
    })

    expect(hints.get('overview')?.enabled).toBe(true)
    expect(hints.get('overview')?.label).toBe('Open Tour')
    expect(hints.get('next')?.enabled).toBe(true)
    expect(hints.get('next')?.label).toBe('Start Tour')
    expect(hints.get('scroll')?.enabled).toBe(true)
    expect(hints.get('next-unreviewed')?.enabled).toBe(true)
    expect(hints.get('finish-review')?.enabled).toBe(true)
    expect(hints.get('jump')?.enabled).toBe(true)
    expect(hints.get('jump')?.keys).toEqual(['⌘K'])

    expect(hints.get('prev')?.enabled).toBe(false)
    expect(hints.get('mark-reviewed')?.enabled).toBe(false)
    expect(hints.get('find')?.enabled).toBe(false)
    expect(hints.get('find')?.keys).toEqual(['⌘F'])
  })

  it('enables diff shortcuts on a middle step and reflects reviewed state', () => {
    const hints = hintMap({
      hasPR: true,
      activeView: 'step',
      stepCount: 5,
      currentStepIndex: 2,
      hasUnreviewedSteps: true,
      currentStepReviewed: true,
      isMac: false,
    })

    expect(hints.get('overview')?.label).toBe('Overview')
    expect(hints.get('next')?.enabled).toBe(true)
    expect(hints.get('next')?.label).toBe('Next')
    expect(hints.get('prev')?.enabled).toBe(true)
    expect(hints.get('mark-reviewed')?.enabled).toBe(true)
    expect(hints.get('mark-reviewed')?.label).toBe('Unmark Reviewed')
    expect(hints.get('find')?.enabled).toBe(true)
    expect(hints.get('find')?.keys).toEqual(['Ctrl+F'])
    expect(hints.get('jump')?.keys).toEqual(['Ctrl+K'])
  })

  it('dims prev on the first step and next on the last step', () => {
    const first = hintMap({
      hasPR: true,
      activeView: 'step',
      stepCount: 3,
      currentStepIndex: 0,
      hasUnreviewedSteps: true,
      currentStepReviewed: false,
      isMac: true,
    })
    expect(first.get('prev')?.enabled).toBe(false)
    expect(first.get('next')?.enabled).toBe(true)

    const last = hintMap({
      hasPR: true,
      activeView: 'step',
      stepCount: 3,
      currentStepIndex: 2,
      hasUnreviewedSteps: false,
      currentStepReviewed: true,
      isMac: true,
    })
    expect(last.get('prev')?.enabled).toBe(true)
    expect(last.get('next')?.enabled).toBe(false)
    expect(last.get('next-unreviewed')?.enabled).toBe(false)
  })

  it('dims all PR shortcuts when no PR is loaded', () => {
    const hints = getContextualShortcutHints({
      hasPR: false,
      activeView: 'overview',
      stepCount: 0,
      currentStepIndex: 0,
      hasUnreviewedSteps: false,
      currentStepReviewed: false,
      isMac: true,
    })

    expect(hints.every((h) => !h.enabled)).toBe(true)
  })
})
