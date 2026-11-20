export interface PopoverPositionInput {
  /** Cursor / anchor X in viewport coordinates. */
  x: number
  /** Cursor / anchor Y in viewport coordinates. */
  y: number
  /** Preferred popover width. */
  width: number
  /** Measured (natural) popover height. */
  height: number
  viewportWidth: number
  viewportHeight: number
  /** Minimum distance kept from every viewport edge. */
  margin?: number
  /** Vertical gap between the anchor point and the popover. */
  offset?: number
}

export interface PopoverPosition {
  left: number
  top: number
  width: number
  /** Set when the popover cannot fit at its natural height and must scroll. */
  maxHeight: number | null
  placement: 'above' | 'below'
}

/**
 * Places a floating popover next to an anchor point so that it always stays
 * fully inside the viewport. Prefers rendering below the anchor, flips above
 * when there is more room there, and as a last resort clamps the popover into
 * the viewport (capping its height so it scrolls instead of overflowing).
 */
export function computePopoverPosition(input: PopoverPositionInput): PopoverPosition {
  const margin = input.margin ?? 12
  const offset = input.offset ?? 14
  const vw = input.viewportWidth
  const vh = input.viewportHeight

  const width = Math.max(0, Math.min(input.width, vw - margin * 2))
  const left = clamp(input.x, margin, vw - width - margin)

  const available = Math.max(0, vh - margin * 2)
  const height = Math.min(input.height, available)
  const maxHeight = input.height > available ? available : null

  const spaceBelow = vh - margin - (input.y + offset)
  const spaceAbove = input.y - offset - margin

  let placement: 'above' | 'below'
  let top: number
  if (height <= spaceBelow) {
    placement = 'below'
    top = input.y + offset
  } else if (height <= spaceAbove) {
    placement = 'above'
    top = input.y - offset - height
  } else {
    // Fits on neither side: favour the roomier side, then clamp into view.
    placement = spaceAbove > spaceBelow ? 'above' : 'below'
    top = placement === 'below' ? input.y + offset : input.y - offset - height
  }
  top = clamp(top, margin, vh - height - margin)

  return { left, top, width, maxHeight, placement }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}
