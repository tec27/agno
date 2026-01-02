import { useEffect, useRef, useState } from 'react'
import { configureCanvasContext, type GpuContext } from './gpu/context'
import { Renderer } from './gpu/Renderer'
import { useWebGpu } from './gpu/useWebGpu'
import { useObservedDimensions } from './hooks/useObservedDimensions'

const DEFAULT_PARAMS = {
  grainEnabled: true,
  grainStrength: 0.5,
  grainSize: 1.0,
  grainSaturation: 0.7,

  filmEnabled: true,
  filmToe: 0.0,
  filmMidtoneBias: 1.0,

  halationEnabled: false,
  halationStrength: 0.3,
  halationThreshold: 0.8,
}

export type EffectParams = typeof DEFAULT_PARAMS

export default function App() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const gpu = useWebGpu()

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file')
      return
    }

    try {
      setError(null)
      const bitmap = await createImageBitmap(file)
      setImage(bitmap)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image')
    }
  }

  // Show WebGPU error state
  if (gpu.status === 'error') {
    return (
      <div className='bg-base-100 text-base-content flex min-h-screen items-center justify-center'>
        <div className='alert alert-error max-w-md'>
          <span>{gpu.error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className='bg-base-100 text-base-content flex h-screen flex-col'>
      <header className='border-base-300 shrink-0 px-6 py-3'>
        <h1 className='text-3xl font-semibold'>agno</h1>
      </header>

      <main className='flex min-h-0 flex-1 gap-4 pt-2 pb-6 pr-6 pl-2'>
        {/* Controls Panel */}
        <aside className='w-72 shrink-0 space-y-3 overflow-y-auto'>
          <button
            className='btn btn-primary mx-4 w-[calc(100%-2rem)]'
            onClick={() => fileInputRef.current?.click()}>
            {image ? 'change image' : 'upload image'}
          </button>

          <EffectSection
            label='grain'
            enabled={params.grainEnabled}
            onToggle={v => {
              setParams(p => ({ ...p, grainEnabled: v }))
            }}>
            <SliderControl
              label='strength'
              value={params.grainStrength}
              min={0}
              max={5}
              onChange={v => {
                setParams(p => ({ ...p, grainStrength: v }))
              }}
            />
            <SliderControl
              label='size'
              value={params.grainSize}
              min={0.25}
              max={4}
              onChange={v => {
                setParams(p => ({ ...p, grainSize: v }))
              }}
            />
            <SliderControl
              label='saturation'
              value={params.grainSaturation}
              min={0}
              max={2}
              onChange={v => {
                setParams(p => ({ ...p, grainSaturation: v }))
              }}
            />
          </EffectSection>

          <EffectSection
            label='film'
            enabled={params.filmEnabled}
            onToggle={v => {
              setParams(p => ({ ...p, filmEnabled: v }))
            }}>
            <SliderControl
              label='toe'
              value={params.filmToe}
              min={-0.2}
              max={0.5}
              precision={3}
              onChange={v => {
                setParams(p => ({ ...p, filmToe: v }))
              }}
            />
            <SliderControl
              label='midtone bias'
              value={params.filmMidtoneBias}
              min={0}
              max={2}
              onChange={v => {
                setParams(p => ({ ...p, filmMidtoneBias: v }))
              }}
            />
          </EffectSection>

          <EffectSection
            label='halation'
            enabled={params.halationEnabled}
            onToggle={v => {
              setParams(p => ({ ...p, halationEnabled: v }))
            }}>
            <SliderControl
              label='strength'
              value={params.halationStrength}
              min={0}
              max={1}
              onChange={v => {
                setParams(p => ({ ...p, halationStrength: v }))
              }}
            />
            <SliderControl
              label='threshold'
              value={params.halationThreshold}
              min={0}
              max={1}
              onChange={v => {
                setParams(p => ({ ...p, halationThreshold: v }))
              }}
            />
          </EffectSection>
        </aside>

        {/* Preview Area */}
        <div
          className={`border-base-300 bg-base-200/50 relative flex flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-lg border transition-colors ${
            isDragging
              ? 'border-primary bg-primary/10 border-solid'
              : image
                ? 'border-solid'
                : 'border-dashed'
          }`}
          onDrop={e => {
            e.preventDefault()
            setIsDragging(false)
            const file = e.dataTransfer.files[0] as File | undefined
            if (file) handleFile(file).catch(console.error)
          }}
          onDragOver={e => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={e => {
            e.preventDefault()
            setIsDragging(false)
          }}
          onClick={() => {
            if (!image) fileInputRef.current?.click()
          }}>
          <input
            ref={fileInputRef}
            type='file'
            accept='image/*'
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) handleFile(file).catch(console.error)
            }}
            className='hidden'
          />

          {error && (
            <div className='alert alert-error absolute top-4 left-4 right-4 z-10 w-auto'>
              <span>{error}</span>
            </div>
          )}

          {gpu.status === 'loading' ? (
            <p className='text-base-content/40'>Initializing WebGPU...</p>
          ) : image ? (
            <WebGpuCanvas image={image} ctx={gpu.ctx} params={params} />
          ) : (
            <p className='text-base-content/40'>drop an image here or click to upload</p>
          )}
        </div>
      </main>
    </div>
  )
}

interface ViewState {
  zoom: number
  centerX: number
  centerY: number
}

const DEFAULT_VIEW_STATE: ViewState = { zoom: 1.0, centerX: 0.5, centerY: 0.5 }
const MIN_ZOOM = 0.1
const MAX_ZOOM = 32
const ZOOM_STEP = 1.2 // Multiplier per scroll tick or button click

function WebGpuCanvas({
  image,
  ctx,
  params,
}: {
  image: ImageBitmap
  ctx: GpuContext
  params: EffectParams
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const canvasContextRef = useRef<GPUCanvasContext | null>(null)

  // View state (zoom and pan)
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE)

  // Container dimensions for canvas sizing and zoom percentage calculation
  const [containerRef, containerSize] = useObservedDimensions<HTMLDivElement>()

  // Drag state for panning
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(
    null,
  )

  // Initialize renderer once
  useEffect(() => {
    rendererRef.current = new Renderer(ctx)
    return () => {
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [ctx])

  // Sync view state with renderer and trigger re-render
  useEffect(() => {
    const renderer = rendererRef.current
    const canvasContext = canvasContextRef.current
    if (!renderer || !canvasContext) return

    renderer.setViewState(viewState)
    renderer.render(canvasContext)
  }, [viewState])

  // Zoom toward a specific point
  function zoomToward(
    newZoom: number,
    targetX: number,
    targetY: number,
    currentZoom: number,
    currentCenterX: number,
    currentCenterY: number,
  ): ViewState {
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

  // Calculate aspect ratio scale factors (matches shader logic)
  function getAspectScaleFactors(): { scaleX: number; scaleY: number } {
    if (!containerSize) return { scaleX: 1, scaleY: 1 }

    const aspectCanvas = containerSize.width / containerSize.height
    const aspectImage = image.width / image.height

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
      const aspectImage = image.width / image.height
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
        zoomToward(newZoom, imageX, imageY, viewState.zoom, viewState.centerX, viewState.centerY),
      )
    }

    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', handleWheel)
    }
  }, [viewState, containerSize, image.width, image.height])

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
      zoomToward(
        newZoom,
        viewState.centerX,
        viewState.centerY,
        viewState.zoom,
        viewState.centerX,
        viewState.centerY,
      ),
    )
  }

  function handleZoomOut() {
    const newZoom = viewState.zoom / ZOOM_STEP
    setViewState(
      zoomToward(
        newZoom,
        viewState.centerX,
        viewState.centerY,
        viewState.zoom,
        viewState.centerX,
        viewState.centerY,
      ),
    )
  }

  function handleFitToWindow() {
    setViewState(DEFAULT_VIEW_STATE)
  }

  function handleActualSize() {
    if (!containerSize) return

    const imageAspect = image.width / image.height
    const canvasAspect = containerSize.width / containerSize.height

    // Calculate the base scale at zoom=1 (fit to window)
    let baseScale: number
    if (imageAspect > canvasAspect) {
      baseScale = containerSize.width / image.width
    } else {
      baseScale = containerSize.height / image.height
    }

    // To show 100% native pixels, we need zoom = 1 / baseScale
    const targetZoom = 1 / baseScale
    setViewState(
      zoomToward(
        targetZoom,
        viewState.centerX,
        viewState.centerY,
        viewState.zoom,
        viewState.centerX,
        viewState.centerY,
      ),
    )
  }

  // Calculate actual image scale (percentage of native image size)
  // At zoom=1 (fit to window), the image is scaled to fit the canvas
  // This calculates what percentage of the native image pixels we're showing
  function getActualImageScale(): number {
    if (!containerSize) return 100

    const imageAspect = image.width / image.height
    const canvasAspect = containerSize.width / containerSize.height

    // The shader fits the image within the canvas, so we need to figure out
    // which dimension is the limiting factor
    let baseScale: number
    if (imageAspect > canvasAspect) {
      // Image is wider than canvas - width is the limiting factor
      baseScale = containerSize.width / image.width
    } else {
      // Image is taller than canvas - height is the limiting factor
      baseScale = containerSize.height / image.height
    }

    // Multiply by current zoom to get actual scale
    return baseScale * viewState.zoom * 100
  }

  // Configure canvas when container size changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !containerSize) return

    // Size canvas to fill container (shader handles aspect ratio)
    canvas.width = Math.round(containerSize.width * window.devicePixelRatio)
    canvas.height = Math.round(containerSize.height * window.devicePixelRatio)
    canvas.style.width = `${String(containerSize.width)}px`
    canvas.style.height = `${String(containerSize.height)}px`

    const canvasContext = configureCanvasContext(canvas, ctx)
    canvasContextRef.current = canvasContext

    // Re-render after resize
    const renderer = rendererRef.current
    if (renderer) {
      renderer.render(canvasContext)
    }
  }, [ctx, containerSize])

  // Update grain params and regenerate tiles when grain settings change (debounced)
  useEffect(() => {
    const renderer = rendererRef.current
    const canvasContext = canvasContextRef.current
    if (!renderer) return

    renderer.setGrainParams({
      seed: 0, // TODO: add seed UI control
      grainSize: params.grainSize,
      arLag: 2,
    })

    // Debounce tile generation to avoid overwhelming the GPU while dragging
    const timeoutId = setTimeout(() => {
      renderer
        .updateGrain()
        .then(() => {
          if (canvasContext) {
            renderer.render(canvasContext)
          }
        })
        .catch(console.error)
    }, 60)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [params.grainSize])

  // Update blend params when effect settings change
  useEffect(() => {
    const renderer = rendererRef.current
    const canvasContext = canvasContextRef.current
    if (!renderer) return

    renderer.setBlendParams({
      enabled: params.grainEnabled,
      strength: params.grainStrength,
      saturation: params.grainSaturation,
      toe: params.filmEnabled ? params.filmToe : 0,
      midtoneBias: params.filmEnabled ? params.filmMidtoneBias : 1,
    })

    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [
    params.grainEnabled,
    params.grainStrength,
    params.grainSaturation,
    params.filmEnabled,
    params.filmToe,
    params.filmMidtoneBias,
  ])

  // Upload image when it changes
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    renderer.uploadImage(image)

    // Trigger a render if canvas context is ready
    const canvasContext = canvasContextRef.current
    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [image])

  // Debug mode keyboard shortcuts (secret!)
  // Shift+D: toggle debug mode
  // 0: turn off debug view (show image)
  // 1-8: show grain tile 0-7
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore keyboard shortcuts when typing in an input
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const renderer = rendererRef.current
      const canvasContext = canvasContextRef.current
      if (!renderer || !canvasContext) return

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
  }, [])

  // Determine cursor style based on zoom and drag state
  const canZoom = viewState.zoom > 1.0
  const cursorClass = isDragging ? 'cursor-grabbing' : canZoom ? 'cursor-grab' : 'cursor-default'

  return (
    <div ref={containerRef} className='relative h-full w-full'>
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${cursorClass}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Zoom toolbar */}
      <div className='absolute right-3 bottom-3 flex items-center gap-1 rounded-lg bg-base-300/80 p-1 backdrop-blur-sm'>
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

function EffectSection({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className='card bg-base-200 border-primary/30 mx-2 border'>
      <div className='card-body p-0'>
        <label className='flex cursor-pointer items-center justify-between py-4 pr-3 pl-4'>
          <span className='card-title text-base'>{label}</span>
          <input
            type='checkbox'
            checked={enabled}
            onChange={e => {
              onToggle(e.target.checked)
            }}
            className='toggle toggle-primary'
          />
        </label>
        {enabled && <div className='space-y-4 pb-4'>{children}</div>}
      </div>
    </div>
  )
}

function SliderControl({
  label,
  value,
  min,
  max,
  onChange,
  precision = 2,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  precision?: number
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const step = (max - min) / 100
  const fineStep = Math.pow(10, -precision)

  function commitEdit() {
    const parsed = parseFloat(editValue)
    if (!isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, parsed)))
    }
    setIsEditing(false)
  }

  return (
    <div className='px-3'>
      <div className='px-1 mb-1 flex justify-between text-sm'>
        <span className='text-base-content/60'>{label}</span>
        {isEditing ? (
          <input
            type='text'
            autoFocus
            value={editValue}
            onChange={e => {
              setEditValue(e.target.value)
            }}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') setIsEditing(false)
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                const arrowStep = e.shiftKey ? fineStep : step
                const delta = e.key === 'ArrowUp' ? arrowStep : -arrowStep
                const parsed = parseFloat(editValue)
                if (!isNaN(parsed)) {
                  const newVal = Math.max(min, Math.min(max, parsed + delta))
                  setEditValue(newVal.toFixed(precision))
                  onChange(newVal)
                }
              }
            }}
            className='bg-base-300 w-16 rounded px-1 text-right font-mono'
          />
        ) : (
          <span
            className='text-base-content/40 hover:text-base-content/60 cursor-pointer font-mono'
            onClick={() => {
              setEditValue(value.toFixed(precision))
              setIsEditing(true)
            }}>
            {value.toFixed(precision)}
          </span>
        )}
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => {
          onChange(parseFloat(e.target.value))
        }}
        className='range range-primary range-sm'
      />
    </div>
  )
}
