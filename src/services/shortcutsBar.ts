import type { ReviewViewMode } from '@/stores/review'

export interface ShortcutBarContext {
  hasPR: boolean
  activeView: ReviewViewMode
  stepCount: number
  currentStepIndex: number
  hasUnreviewedSteps: boolean
  currentStepReviewed: boolean
  isMac: boolean
}

export interface ShortcutBarHint {
  id: string
  keys: string[]
  label: string
  enabled: boolean
  disabledReason?: string
}

/**
 * Build the contextual footer shortcut hints for the current review screen state.
 * Inapplicable hints stay in place but are marked disabled so the bar dims them
 * without shifting layout between Overview and Diff views.
 */
export function getContextualShortcutHints(ctx: ShortcutBarContext): ShortcutBarHint[] {
  const {
    hasPR,
    activeView,
    stepCount,
    currentStepIndex,
    hasUnreviewedSteps,
    currentStepReviewed,
    isMac,
  } = ctx

  const hasSteps = hasPR && stepCount > 0
  const isOverview = activeView === 'overview'
  const isStep = activeView === 'step' && hasSteps
  const diffOnlyReason = !hasPR ? 'Load a Pull Request first' : 'Available when viewing a file diff'

  const overviewEnabled = hasSteps
  const nextEnabled = hasSteps && (isOverview || currentStepIndex < stepCount - 1)
  const prevEnabled = isStep && currentStepIndex > 0
  const nextUnreviewedEnabled = hasSteps && hasUnreviewedSteps
  const markReviewedEnabled = isStep
  const findEnabled = isStep

  return [
    {
      id: 'overview',
      keys: ['O'],
      label: isOverview ? 'Open Tour' : 'Overview',
      enabled: overviewEnabled,
      disabledReason: overviewEnabled
        ? undefined
        : !hasPR
          ? 'Load a Pull Request first'
          : 'No tour steps available',
    },
    {
      id: 'next',
      keys: ['L', '→'],
      label: isOverview ? 'Start Tour' : 'Next',
      enabled: nextEnabled,
      disabledReason: nextEnabled
        ? undefined
        : !hasSteps
          ? 'No tour steps available'
          : 'Already on the last step',
    },
    {
      id: 'prev',
      keys: ['H', '←'],
      label: 'Prev',
      enabled: prevEnabled,
      disabledReason: prevEnabled
        ? undefined
        : isOverview || !hasPR
          ? diffOnlyReason
          : 'Already on the first step',
    },
    {
      id: 'scroll',
      keys: ['J', 'K'],
      label: 'Scroll',
      enabled: hasPR,
      disabledReason: hasPR ? undefined : 'Load a Pull Request first',
    },
    {
      id: 'next-unreviewed',
      keys: ['N'],
      label: 'Next unreviewed',
      enabled: nextUnreviewedEnabled,
      disabledReason: nextUnreviewedEnabled
        ? undefined
        : !hasSteps
          ? 'No tour steps available'
          : 'All steps reviewed',
    },
    {
      id: 'mark-reviewed',
      keys: ['M'],
      label: isStep && currentStepReviewed ? 'Unmark Reviewed' : 'Mark Reviewed',
      enabled: markReviewedEnabled,
      disabledReason: markReviewedEnabled ? undefined : diffOnlyReason,
    },
    {
      id: 'finish-review',
      keys: ['R'],
      label: 'Finish Review',
      enabled: hasPR,
      disabledReason: hasPR ? undefined : 'Load a Pull Request first',
    },
    {
      id: 'jump',
      keys: [isMac ? '⌘K' : 'Ctrl+K'],
      label: 'Jump',
      enabled: hasPR,
      disabledReason: hasPR ? undefined : 'Load a Pull Request first',
    },
    {
      id: 'find',
      keys: [isMac ? '⌘F' : 'Ctrl+F'],
      label: 'Find',
      enabled: findEnabled,
      disabledReason: findEnabled ? undefined : diffOnlyReason,
    },
  ]
}
