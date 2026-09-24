import { describe, expect, it, vi } from 'vitest'
import { columnByColumn } from './boardKeyboard'

// Six columns, 200px wide with 16px gaps, starting at x=20, plus one non-column droppable.
const COLUMNS = ['applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn']
const rects = new Map<string, { left: number; width: number }>(COLUMNS.map((s, i) => [`column:${s}`, { left: 20 + i * 216, width: 200 }]))
rects.set('other:thing', { left: 5000, width: 200 })

function press(code: string, cardCentre: number) {
  const preventDefault = vi.fn()
  const cardWidth = 180
  const result = (columnByColumn as unknown as (e: unknown, a: unknown) => { x: number; y: number } | undefined)(
    { code, preventDefault },
    {
      context: {
        droppableRects: rects,
        droppableContainers: { getEnabled: () => [...rects.keys()].map((id) => ({ id })) },
        collisionRect: { left: cardCentre - cardWidth / 2, width: cardWidth },
      },
      currentCoordinates: { x: cardCentre - cardWidth / 2, y: 333 },
    },
  )
  return { result, preventDefault, cardWidth }
}

const centreOf = (index: number) => 20 + index * 216 + 100

describe('columnByColumn (keyboard movement)', () => {
  it('moves one column right per press, centring the card over it', () => {
    const { result, cardWidth } = press('ArrowRight', centreOf(0))
    expect(result).toEqual({ x: centreOf(1) - cardWidth / 2, y: 333 })
  })

  it('moves one column left per press', () => {
    const { result, cardWidth } = press('ArrowLeft', centreOf(3))
    expect(result?.x).toBe(centreOf(2) - cardWidth / 2)
  })

  it('stops at the first and last columns instead of running off the board', () => {
    expect(press('ArrowLeft', centreOf(0)).result?.x).toBe(centreOf(0) - 90)
    expect(press('ArrowRight', centreOf(5)).result?.x).toBe(centreOf(5) - 90)
  })

  it('keeps the card at the same height', () => {
    expect(press('ArrowRight', centreOf(2)).result?.y).toBe(333)
  })

  it('ignores droppables that are not columns', () => {
    // From the last column, "right" must not jump to the droppable at x=5000.
    expect(press('ArrowRight', centreOf(5)).result?.x).toBe(centreOf(5) - 90)
  })

  it('takes over Left and Right (no page scrolling) but leaves other keys alone', () => {
    expect(press('ArrowRight', centreOf(0)).preventDefault).toHaveBeenCalled()
    const up = press('ArrowUp', centreOf(0))
    expect(up.result).toBeUndefined()
    expect(up.preventDefault).not.toHaveBeenCalled()
    expect(press('KeyA', centreOf(0)).result).toBeUndefined()
  })

  it('starts from the first column if the card is not over any column', () => {
    expect(press('ArrowRight', 9999).result?.x).toBe(centreOf(1) - 90)
  })
})
