export interface ViewState {
  zoom: number
  centerX: number
  centerY: number
}

export const DEFAULT_VIEW_STATE: ViewState = { zoom: 1.0, centerX: 0.5, centerY: 0.5 }
export const ZOOM_STEP = 1.2 // Multiplier per scroll tick or button click

const MIN_ZOOM = 0.1
const MAX_ZOOM = 32

// Zoom toward a specific point
export function zoomToward({
  newZoom,
  targetX,
  targetY,
  currentZoom,
  currentCenterX,
  currentCenterY,
}: {
  newZoom: number
  targetX: number
  targetY: number
  currentZoom: number
  currentCenterX: number
  currentCenterY: number
}): ViewState {
  // Clamp zoom
  const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))

  // Calculate new center to keep targetX/targetY at the same screen position
  // Before: screen_pos = (target - center) * zoom + 0.5
  // After:  screen_pos = (target - new_center) * new_zoom + 0.5
  // Solving: new_center = target - (target - center) * (zoom / new_zoom)
  const zoomRatio = currentZoom / clampedZoom
  const newCenterX = targetX - (targetX - currentCenterX) * zoomRatio
  const newCenterY = targetY - (targetY - currentCenterY) * zoomRatio

  return { zoom: clampedZoom, centerX: newCenterX, centerY: newCenterY }
}
