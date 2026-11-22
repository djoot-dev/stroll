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
