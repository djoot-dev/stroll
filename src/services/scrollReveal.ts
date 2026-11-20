export interface ScrollRevealInput {
  /** Current scrollTop of the scroll container. */
  scrollTop: number
  /** Visible height of the scroll container. */
  viewportHeight: number
  /** Total scrollable height of the container content. */
  scrollHeight: number
  /** Active item's top/bottom in content coordinates (relative to the scroll origin). */
  activeTop: number
  activeBottom: number
  /** Top of the range to keep visible (e.g. the previous item's top). Defaults to activeTop. */
  rangeTop?: number
  /** Bottom of the range to keep visible (e.g. the next item's bottom). Defaults to activeBottom. */
  rangeBottom?: number
  /** Extra breathing room kept between the range and the viewport edges. */
  margin?: number
}

/**
 * Computes the minimal scrollTop that keeps `[rangeTop, rangeBottom]` visible,
 * falling back to keeping the active item itself visible when the whole range
 * does not fit. Returns the current scrollTop if nothing needs to move.
 */
export function computeRevealScrollTop(input: ScrollRevealInput): number {
  const { scrollTop, viewportHeight, scrollHeight, activeTop, activeBottom, margin = 0 } = input
  const rangeTop = Math.min(input.rangeTop ?? activeTop, activeTop) - margin
  const rangeBottom = Math.max(input.rangeBottom ?? activeBottom, activeBottom) + margin

  let target = scrollTop
  if (rangeTop < target) {
    target = rangeTop
  } else if (rangeBottom > target + viewportHeight) {
    target = rangeBottom - viewportHeight
  }

  // If the full range can't fit, make sure the active item itself stays in view.
  if (activeTop < target) target = activeTop
  if (activeBottom > target + viewportHeight) target = activeBottom - viewportHeight

  const maxScroll = Math.max(0, scrollHeight - viewportHeight)
  return Math.min(Math.max(0, target), maxScroll)
}
