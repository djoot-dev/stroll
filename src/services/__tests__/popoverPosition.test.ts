import { describe, expect, it } from 'vitest'
import { computePopoverPosition } from '../popoverPosition'

const base = { width: 460, viewportWidth: 1280, viewportHeight: 800, margin: 12, offset: 14 }

describe('computePopoverPosition', () => {
  it('places the popover below the cursor when it fits', () => {
    const pos = computePopoverPosition({ ...base, x: 100, y: 100, height: 300 })
    expect(pos.placement).toBe('below')
    expect(pos.top).toBe(114)
    expect(pos.maxHeight).toBeNull()
  })

  it('flips above the cursor near the bottom edge using the measured height', () => {
    const pos = computePopoverPosition({ ...base, x: 100, y: 700, height: 500 })
    expect(pos.placement).toBe('above')
    expect(pos.top).toBe(700 - 14 - 500)
    expect(pos.top + 500).toBeLessThanOrEqual(800 - 12)
  })

  it('keeps a tall popover fully on screen when neither side fits', () => {
    const pos = computePopoverPosition({ ...base, x: 100, y: 400, height: 600 })
    expect(pos.top).toBeGreaterThanOrEqual(12)
    expect(pos.top + 600).toBeLessThanOrEqual(800 - 12)
    expect(pos.maxHeight).toBeNull()
  })

  it('caps the height when the popover is taller than the viewport', () => {
    const pos = computePopoverPosition({ ...base, x: 100, y: 400, height: 1000 })
    expect(pos.maxHeight).toBe(800 - 24)
    expect(pos.top).toBe(12)
  })

  it('clamps horizontally against the right edge', () => {
    const pos = computePopoverPosition({ ...base, x: 1200, y: 100, height: 200 })
    expect(pos.left).toBe(1280 - 460 - 12)
  })

  it('shrinks the width on narrow viewports', () => {
    const pos = computePopoverPosition({ ...base, viewportWidth: 400, x: 50, y: 100, height: 200 })
    expect(pos.width).toBe(400 - 24)
    expect(pos.left).toBe(12)
  })
})
