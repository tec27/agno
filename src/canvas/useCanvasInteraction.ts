import { useEffect, useRef, useState, type RefObject } from 'react'
import { DEFAULT_VIEW_STATE, ZOOM_STEP, zoomToward, type ViewState } from '../zoom'

interface ContainerSize {
  width: number
  height: number
}

interface TouchState {
  type: 'drag' | 'pinch'
  // For drag
  startX?: number
  startY?: number
  startCenterX?: number
  startCenterY?: number
  // For pinch
  startDistance?: number
  startZoom?: number
  pinchCenterX?: number
  pinchCenterY?: number
}

export function useCanvasInteraction(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  containerSize: ContainerSize | undefined,
  imageWidth: number,
  imageHeight: number,
): {
  viewState: ViewState
  setViewState: React.Dispatch<React.SetStateAction<ViewState>>
  isDragging: boolean
  handleMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void
  handleMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void
  handleMouseUp: () => void
  handleZoomIn: () => void
  handleZoomOut: () => void
  handleFitToWindow: () => void
  handleActualSize: () => void
  getActualImageScale: () => number
} {
  const [viewState, setViewState] = useState(DEFAULT_VIEW_STATE)
  const [isDragging, setIsDragging] = useState(false)

  const dragStartRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(
    null,
  )
  const touchStateRef = useRef<TouchState | null>(null)

  // Calculate aspect ratio scale factors (matches shader logic)
  function getAspectScaleFactors(): { scaleX: number; scaleY: number } {
    if (!containerSize) return { scaleX: 1, scaleY: 1 }

    const aspectCanvas = containerSize.width / containerSize.height
    const aspectImage = imageWidth / imageHeight

    if (aspectImage > aspectCanvas) {
      // Image is wider than canvas - letterbox (black bars top/bottom)
      return { scaleX: 1, scaleY: aspectImage / aspectCanvas }
    } else {
      // Image is taller than canvas - pillarbox (black bars left/right)
      return { scaleX: aspectCanvas / aspectImage, scaleY: 1 }
    }
  }

  // Handle scroll-to-zoom (added via useEffect to use { passive: false })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !containerSize) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = canvas.getBoundingClientRect()
      const canvasX = (e.clientX - rect.left) / rect.width
      const canvasY = (e.clientY - rect.top) / rect.height

      // Calculate aspect ratio correction inline (matches shader logic)
      const aspectCanvas = containerSize.width / containerSize.height
      const aspectImage = imageWidth / imageHeight
      const scaleX = aspectImage > aspectCanvas ? 1 : aspectCanvas / aspectImage
      const scaleY = aspectImage > aspectCanvas ? aspectImage / aspectCanvas : 1

      const correctedX = (canvasX - 0.5) * scaleX + 0.5
      const correctedY = (canvasY - 0.5) * scaleY + 0.5

      // Convert to image coords using current view
      const imageX = (correctedX - 0.5) / viewState.zoom + viewState.centerX
      const imageY = (correctedY - 0.5) / viewState.zoom + viewState.centerY

      // Determine zoom direction
      const zoomIn = e.deltaY < 0
      const zoomFactor = zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP
      const newZoom = viewState.zoom * zoomFactor

      setViewState(
        zoomToward({
          newZoom,
          targetX: imageX,
          targetY: imageY,
          currentZoom: viewState.zoom,
          currentCenterX: viewState.centerX,
          currentCenterY: viewState.centerY,
        }),
      )
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
    }
  }, [canvasRef, viewState, containerSize, imageWidth, imageHeight])

  // Handle touch gestures (added via useEffect to use { passive: false })
  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl || !containerSize) return

    // Helper function to get distance between two touch points
    function getTouchDistance(touch1: Touch, touch2: Touch): number {
      return Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
    }

    // Helper function to get center point between two touches
    function getTouchCenter(touch1: Touch, touch2: Touch): { x: number; y: number } {
      return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      }
    }

    // Pre-compute aspect ratio values
    const aspectCanvas = containerSize.width / containerSize.height
    const aspectImage = imageWidth / imageHeight
    const scaleX = aspectImage > aspectCanvas ? 1 : aspectCanvas / aspectImage
    const scaleY = aspectImage > aspectCanvas ? aspectImage / aspectCanvas : 1

    // Convert screen coordinates to image coordinates
    function screenToImageCoords(clientX: number, clientY: number): { x: number; y: number } {
      if (!canvasEl) return { x: 0.5, y: 0.5 }
      const rect = canvasEl.getBoundingClientRect()
      const canvasX = (clientX - rect.left) / rect.width
      const canvasY = (clientY - rect.top) / rect.height

      const correctedX = (canvasX - 0.5) * scaleX + 0.5
      const correctedY = (canvasY - 0.5) * scaleY + 0.5

      // Convert to image coords using current view
      const imageX = (correctedX - 0.5) / viewState.zoom + viewState.centerX
      const imageY = (correctedY - 0.5) / viewState.zoom + viewState.centerY

      return { x: imageX, y: imageY }
    }

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const touches = e.touches

      if (touches.length === 1) {
        // Single touch = drag
        const touch = touches[0]
        touchStateRef.current = {
          type: 'drag',
          startX: touch.clientX,
          startY: touch.clientY,
          startCenterX: viewState.centerX,
          startCenterY: viewState.centerY,
        }
        setIsDragging(true)
      } else if (touches.length === 2) {
        // Two touches = pinch to zoom
        const distance = getTouchDistance(touches[0], touches[1])
        const center = getTouchCenter(touches[0], touches[1])
        const imageCoords = screenToImageCoords(center.x, center.y)

        touchStateRef.current = {
          type: 'pinch',
          startDistance: distance,
          startZoom: viewState.zoom,
          pinchCenterX: imageCoords.x,
          pinchCenterY: imageCoords.y,
          startCenterX: viewState.centerX,
          startCenterY: viewState.centerY,
        }
        setIsDragging(false)
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const touchState = touchStateRef.current
      if (!touchState) return

      const touches = e.touches
      const rect = canvasEl.getBoundingClientRect()

      if (touchState.type === 'drag' && touches.length === 1) {
        // Single touch drag
        const touch = touches[0]

        const rawDeltaX = (touch.clientX - (touchState.startX ?? 0)) / rect.width
        const rawDeltaY = (touch.clientY - (touchState.startY ?? 0)) / rect.height

        // Inline aspect ratio calculation (same as getAspectScaleFactors)
        const deltaX = (rawDeltaX * scaleX) / viewState.zoom
        const deltaY = (rawDeltaY * scaleY) / viewState.zoom

        setViewState({
          zoom: viewState.zoom,
          centerX: (touchState.startCenterX ?? 0.5) - deltaX,
          centerY: (touchState.startCenterY ?? 0.5) - deltaY,
        })
      } else if (touchState.type === 'pinch' && touches.length === 2) {
        // Pinch zoom
        const newDistance = getTouchDistance(touches[0], touches[1])
        const scale = newDistance / (touchState.startDistance ?? 1)
        const newZoom = (touchState.startZoom ?? 1) * scale

        // Zoom toward the pinch center
        setViewState(
          zoomToward({
            newZoom,
            targetX: touchState.pinchCenterX ?? 0.5,
            targetY: touchState.pinchCenterY ?? 0.5,
            currentZoom: touchState.startZoom ?? 1,
            currentCenterX: touchState.startCenterX ?? 0.5,
            currentCenterY: touchState.startCenterY ?? 0.5,
          }),
        )
      } else if (touches.length === 2 && touchState.type === 'drag') {
        // Transition from drag to pinch
        const distance = getTouchDistance(touches[0], touches[1])
        const center = getTouchCenter(touches[0], touches[1])
        const imageCoords = screenToImageCoords(center.x, center.y)

        touchStateRef.current = {
          type: 'pinch',
          startDistance: distance,
          startZoom: viewState.zoom,
          pinchCenterX: imageCoords.x,
          pinchCenterY: imageCoords.y,
          startCenterX: viewState.centerX,
          startCenterY: viewState.centerY,
        }
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault()
      if (e.touches.length === 0) {
        touchStateRef.current = null
        setIsDragging(false)
      } else if (e.touches.length === 1 && touchStateRef.current?.type === 'pinch') {
        // Transition from pinch back to drag
        const touch = e.touches[0]
        touchStateRef.current = {
          type: 'drag',
          startX: touch.clientX,
          startY: touch.clientY,
          startCenterX: viewState.centerX,
          startCenterY: viewState.centerY,
        }
        setIsDragging(true)
      }
    }

    canvasEl.addEventListener('touchstart', handleTouchStart, { passive: false })
    canvasEl.addEventListener('touchmove', handleTouchMove, { passive: false })
    canvasEl.addEventListener('touchend', handleTouchEnd, { passive: false })
    canvasEl.addEventListener('touchcancel', handleTouchEnd, { passive: false })

    return () => {
      canvasEl.removeEventListener('touchstart', handleTouchStart)
      canvasEl.removeEventListener('touchmove', handleTouchMove)
      canvasEl.removeEventListener('touchend', handleTouchEnd)
      canvasEl.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [canvasRef, viewState, containerSize, imageWidth, imageHeight])

  // Handle drag start
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return // Left click only

    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      centerX: viewState.centerX,
      centerY: viewState.centerY,
    }
  }

  // Handle drag move
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDragging || !dragStartRef.current) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()

    // Calculate drag delta in normalized canvas units
    const rawDeltaX = (e.clientX - dragStartRef.current.x) / rect.width
    const rawDeltaY = (e.clientY - dragStartRef.current.y) / rect.height

    // Apply aspect ratio correction and zoom to get image-space delta
    const { scaleX, scaleY } = getAspectScaleFactors()
    const deltaX = (rawDeltaX * scaleX) / viewState.zoom
    const deltaY = (rawDeltaY * scaleY) / viewState.zoom

    setViewState({
      zoom: viewState.zoom,
      centerX: dragStartRef.current.centerX - deltaX,
      centerY: dragStartRef.current.centerY - deltaY,
    })
  }

  // Handle drag end
  function handleMouseUp() {
    setIsDragging(false)
    dragStartRef.current = null
  }

  // Zoom control functions for toolbar
  function handleZoomIn() {
    const newZoom = viewState.zoom * ZOOM_STEP
    setViewState(
      zoomToward({
        newZoom,
        targetX: viewState.centerX,
        targetY: viewState.centerY,
        currentZoom: viewState.zoom,
        currentCenterX: viewState.centerX,
        currentCenterY: viewState.centerY,
      }),
    )
  }

  function handleZoomOut() {
    const newZoom = viewState.zoom / ZOOM_STEP
    setViewState(
      zoomToward({
        newZoom,
        targetX: viewState.centerX,
        targetY: viewState.centerY,
        currentZoom: viewState.zoom,
        currentCenterX: viewState.centerX,
        currentCenterY: viewState.centerY,
      }),
    )
  }

  function handleFitToWindow() {
    setViewState(DEFAULT_VIEW_STATE)
  }

  function handleActualSize() {
    if (!containerSize) return

    const imageAspect = imageWidth / imageHeight
    const canvasAspect = containerSize.width / containerSize.height

    // Calculate the base scale at zoom=1 (fit to window)
    let baseScale: number
    if (imageAspect > canvasAspect) {
      baseScale = containerSize.width / imageWidth
    } else {
      baseScale = containerSize.height / imageHeight
    }

    // To show 100% native pixels, we need zoom = 1 / baseScale
    const targetZoom = 1 / baseScale
    setViewState(
      zoomToward({
        newZoom: targetZoom,
        targetX: viewState.centerX,
        targetY: viewState.centerY,
        currentZoom: viewState.zoom,
        currentCenterX: viewState.centerX,
        currentCenterY: viewState.centerY,
      }),
    )
  }

  // Calculate actual image scale (percentage of native image size)
  function getActualImageScale(): number {
    if (!containerSize) return 100

    const imageAspect = imageWidth / imageHeight
    const canvasAspect = containerSize.width / containerSize.height

    let baseScale: number
    if (imageAspect > canvasAspect) {
      baseScale = containerSize.width / imageWidth
    } else {
      baseScale = containerSize.height / imageHeight
    }

    return baseScale * viewState.zoom * 100
  }

  return {
    viewState,
    setViewState,
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleZoomIn,
    handleZoomOut,
    handleFitToWindow,
    handleActualSize,
    getActualImageScale,
  }
}
