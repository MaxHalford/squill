export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function calculateBoundingBox(
  boxes: { x: number; y: number; width: number; height: number }[],
): BoundingBox | null {
  if (!boxes.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { minX, minY, maxX, maxY }
}
