import type { KeyboardCoordinateGetter } from '@dnd-kit/core'

// With the keyboard, Left and Right arrows carry the card to the neighbouring
// column, so getting from Applied to Interview is two key presses rather than
// dozens (the library's default moves 25 pixels at a time). Up and Down do nothing:
// cards have no order within a column.
export const columnByColumn: KeyboardCoordinateGetter = (event, { context: { droppableRects, droppableContainers, collisionRect }, currentCoordinates }) => {
  if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return undefined
  event.preventDefault()
  if (!collisionRect) return undefined
  const columns = droppableContainers
    .getEnabled()
    .filter((c) => String(c.id).startsWith('column:'))
    .flatMap((c) => {
      const rect = droppableRects.get(c.id)
      return rect ? [rect] : []
    })
    .sort((a, b) => a.left - b.left)
  const centre = collisionRect.left + collisionRect.width / 2
  const current = columns.findIndex((r) => centre >= r.left && centre <= r.left + r.width)
  const next = columns[Math.max(0, Math.min(columns.length - 1, (current === -1 ? 0 : current) + (event.code === 'ArrowRight' ? 1 : -1)))]
  if (!next) return undefined
  // Coordinates are the card's top-left corner: centre the card over the column.
  return { x: next.left + next.width / 2 - collisionRect.width / 2, y: currentCoordinates.y }
}
