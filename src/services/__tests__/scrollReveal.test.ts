import { describe, expect, it } from 'vitest'
import { computeRevealScrollTop } from '../scrollReveal'

// 20 items, 50px tall each, in a 200px viewport → 1000px content.
const item = (i: number) => ({ top: i * 50, bottom: i * 50 + 50 })
const base = { viewportHeight: 200, scrollHeight: 1000 }

function reveal(scrollTop: number, i: number, margin = 0) {
  return computeRevealScrollTop({
    ...base,
    scrollTop,
    activeTop: item(i).top,
    activeBottom: item(i).bottom,
    rangeTop: i > 0 ? item(i - 1).top : undefined,
    rangeBottom: i < 19 ? item(i + 1).bottom : undefined,
    margin,
  })
}

describe('computeRevealScrollTop', () => {
  it('does not move when active and neighbours are already visible', () => {
    expect(reveal(0, 1)).toBe(0)
    expect(reveal(100, 3)).toBe(100)
  })

  it('scrolls down just enough to show the next item', () => {
    // Item 3 is visible at scrollTop 0 (0-200), but item 4 (200-250) is not.
    expect(reveal(0, 3)).toBe(50)
  })

  it('scrolls up just enough to show the previous item', () => {
    // At scrollTop 300 (300-500), moving to item 6 needs item 5 (250) visible.
    expect(reveal(300, 6)).toBe(250)
  })

  it('jumps to a far-away item and keeps both neighbours in view', () => {
    expect(reveal(0, 15)).toBe(15 * 50 + 100 - 200)
    expect(reveal(800, 2)).toBe(50)
  })

  it('clamps at the top and bottom of the content', () => {
    expect(reveal(500, 0)).toBe(0)
    expect(reveal(0, 19)).toBe(800)
  })

  it('honours the margin', () => {
    expect(reveal(0, 3, 8)).toBe(58)
  })

  it('prioritises the active item when the range does not fit', () => {
    const top = computeRevealScrollTop({
      scrollTop: 0,
      viewportHeight: 100,
      scrollHeight: 1000,
      activeTop: 400,
      activeBottom: 480,
      rangeTop: 300,
      rangeBottom: 560,
    })
    expect(top).toBeLessThanOrEqual(400)
    expect(top + 100).toBeGreaterThanOrEqual(480)
  })
})
