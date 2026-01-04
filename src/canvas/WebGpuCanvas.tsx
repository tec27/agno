import { useEffect, useRef } from 'react'
import type { EffectParams } from '../effectParams'
import { configureCanvasContext } from '../gpu/context'
import type { Renderer } from '../gpu/Renderer'
import { useObservedDimensions } from '../hooks/useObservedDimensions'
import { useCanvasInteraction } from './useCanvasInteraction'
import { useRendererSync } from './useRendererSync'

export function WebGpuCanvas({
  image,
  params,
  showOriginal,
  onToggleOriginal,
  renderer,
}: {
  image: ImageBitmap
  params: EffectParams
  showOriginal: boolean
  onToggleOriginal: () => void
  renderer: Renderer
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasContextRef = useRef<GPUCanvasContext | null>(null)

  // Container dimensions for canvas sizing and zoom percentage calculation
  const [containerRef, containerSize] = useObservedDimensions<HTMLDivElement>()

  // Pan/zoom interaction
  const {
    viewState,
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleZoomIn,
    handleZoomOut,
    handleFitToWindow,
    handleActualSize,
    getActualImageScale,
  } = useCanvasInteraction(canvasRef, containerSize, image.width, image.height)

  // Sync params with renderer
  useRendererSync(renderer, params, showOriginal, image, viewState, canvasContextRef)

  // Configure canvas when container size changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !containerSize) return

    // Guard against zero-sized containers (can happen during initial layout)
    if (containerSize.width <= 0 || containerSize.height <= 0) return

    // Size canvas to fill container (shader handles aspect ratio)
    canvas.width = Math.round(containerSize.width * window.devicePixelRatio)
    canvas.height = Math.round(containerSize.height * window.devicePixelRatio)
    canvas.style.width = `${String(containerSize.width)}px`
    canvas.style.height = `${String(containerSize.height)}px`

    const canvasContext = configureCanvasContext(canvas, renderer.getContext())
    canvasContextRef.current = canvasContext

    // Re-render after resize
    renderer.render(canvasContext)
  }, [renderer, containerSize])

  // Keyboard shortcuts
  // O: toggle original image (no effects)
  // Shift+D: toggle debug mode (secret!)
  // 0: turn off debug view (show image)
  // 1-8: show grain tile 0-7
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore keyboard shortcuts when typing in a text input
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      if (target.tagName === 'INPUT') {
        const inputType = (target as HTMLInputElement).type
        // Allow hotkeys for non-text inputs like range sliders
        if (inputType !== 'range' && inputType !== 'checkbox' && inputType !== 'radio') {
          return
        }
      }

      // O: toggle original image view
      if (e.key === 'o' || e.key === 'O') {
        onToggleOriginal()
        return
      }

      const canvasContext = canvasContextRef.current
      if (!canvasContext) return

      // Shift+D: toggle debug mode
      if (e.key === 'D' && e.shiftKey) {
        const currentState = renderer.getDebugState()
        renderer.setDebugState({ showGrainTile: !currentState.showGrainTile })
        renderer.render(canvasContext)
        return
      }

      // 0: turn off debug mode
      if (e.key === '0') {
        renderer.setDebugState({ showGrainTile: false })
        renderer.render(canvasContext)
        return
      }

      // 1-8: change grain tile (only if already in debug mode)
      const currentState = renderer.getDebugState()
      if (e.key >= '1' && e.key <= '8' && currentState.showGrainTile) {
        renderer.setDebugState({
          tileIndex: parseInt(e.key, 10) - 1,
        })
        renderer.render(canvasContext)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [renderer, onToggleOriginal])

  // Determine cursor style based on zoom and drag state
  const canZoom = viewState.zoom > 1.0
  const cursorClass = isDragging ? 'cursor-grabbing' : canZoom ? 'cursor-grab' : 'cursor-default'

  return (
    <div ref={containerRef} className='relative h-full w-full'>
      <canvas
        ref={canvasRef}
        className={`h-full w-full touch-none ${cursorClass}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Zoom toolbar - hidden on mobile (pinch-to-zoom + header controls) */}
      <div className='absolute bottom-3 right-3 hidden items-center gap-1 rounded-lg bg-base-300/80 p-1 backdrop-blur-sm md:flex'>
        <button
          className={`btn btn-sm px-2 text-xs font-normal ${showOriginal ? 'btn-primary' : 'btn-ghost text-base-content/70'}`}
          onClick={onToggleOriginal}
          title='Show original (O)'>
          original
        </button>

        <div className='mx-1 h-4 w-px bg-base-content/20' />

        <button
          className='btn btn-ghost btn-sm btn-square'
          onClick={handleZoomOut}
          title='Zoom out'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 20 20'
            fill='currentColor'
            className='h-5 w-5'>
            <path d='M4 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H4.75A.75.75 0 0 1 4 10Z' />
          </svg>
        </button>

        <span className='min-w-12 text-center font-mono text-sm text-base-content/70'>
          {Math.round(getActualImageScale())}%
        </span>

        <button className='btn btn-ghost btn-sm btn-square' onClick={handleZoomIn} title='Zoom in'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 20 20'
            fill='currentColor'
            className='h-5 w-5'>
            <path d='M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z' />
          </svg>
        </button>

        <div className='mx-1 h-4 w-px bg-base-content/20' />

        <button
          className='btn btn-ghost btn-sm btn-square'
          onClick={handleFitToWindow}
          title='Fit to window'>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 20 20'
            fill='currentColor'
            className='h-5 w-5'>
            <path d='M13.28 7.78l3.22-3.22v2.69a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.69l-3.22 3.22a.75.75 0 0 0 1.06 1.06ZM2 12.25v4.5c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5H4.56l3.22-3.22a.75.75 0 0 0-1.06-1.06L3.5 14.94v-2.69a.75.75 0 0 0-1.5 0Z' />
          </svg>
        </button>

        <button
          className='btn btn-ghost btn-sm px-2 font-mono text-xs font-normal text-base-content/70'
          onClick={handleActualSize}
          title='Actual size'>
          1:1
        </button>
      </div>
    </div>
  )
}
