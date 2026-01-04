import { useEffect, useRef, useState } from 'react'
import { configureCanvasContext } from './gpu/context'
import { Renderer } from './gpu/Renderer'
import { useWebGpu } from './gpu/useWebGpu'
import { useObservedDimensions } from './hooks/useObservedDimensions'

const DEFAULT_PARAMS = {
  seed: Math.floor(Math.random() * 0x80000000),

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
  halationRadius: 20,
  halationMonochrome: false,
}

export type EffectParams = typeof DEFAULT_PARAMS

export default function App() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [imageName, setImageName] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg')
  const [exportQuality, setExportQuality] = useState(0.95)
  const [isExporting, setIsExporting] = useState(false)
  const [renderer, setRenderer] = useState<Renderer | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const gpu = useWebGpu()

  // Create renderer when GPU context is ready
  useEffect(() => {
    if (gpu.status !== 'ready') {
      setRenderer(null)
      return
    }

    const newRenderer = new Renderer(gpu.ctx)
    setRenderer(newRenderer)

    return () => {
      newRenderer.destroy()
    }
  }, [gpu])

  async function handleExport() {
    if (!renderer || isExporting) return

    setIsExporting(true)
    try {
      const result = await renderer.renderForExport()
      if (!result) return

      // Draw to an offscreen canvas to create the image
      const offscreen = new OffscreenCanvas(result.width, result.height)
      const ctx2d = offscreen.getContext('2d')
      if (!ctx2d) return

      // Create ImageData and put pixels
      const imageData = ctx2d.createImageData(result.width, result.height)
      imageData.data.set(result.data)
      ctx2d.putImageData(imageData, 0, 0)

      const mimeType = `image/${exportFormat}`
      const blob = await offscreen.convertToBlob({
        type: mimeType,
        quality: exportFormat === 'png' ? undefined : exportQuality,
      })
      const url = URL.createObjectURL(blob)

      // Trigger download
      const a = document.createElement('a')
      a.href = url
      a.download = `${imageName || String(Date.now())}_agno.${exportFormat}`
      a.click()

      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    try {
      setError(null)
      const bitmap = await createImageBitmap(file)
      setImage(bitmap)
      // Extract base name without extension for export naming
      const baseName = file.name.replace(/\.[^.]+$/, '')
      setImageName(baseName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image')
    }
  }

  // Show WebGPU error state
  if (gpu.status === 'error') {
    return (
      <div className='bg-base-100 text-base-content flex min-h-screen items-center justify-center'>
        <div className='alert alert-error max-w-lg'>
          <span className='text-lg font-medium'>{gpu.error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className='bg-base-100 text-base-content flex h-screen flex-col'>
      <header className='border-base-300 flex shrink-0 items-center justify-between px-6 py-3'>
        <h1 className='text-3xl font-semibold'>agno</h1>
        <a
          href='https://github.com/tec27/agno'
          target='_blank'
          rel='noopener noreferrer'
          className='btn btn-ghost btn-sm btn-square'
          title='View on GitHub'>
          <svg viewBox='0 0 24 24' fill='currentColor' className='h-5 w-5'>
            <path d='M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z' />
          </svg>
        </a>
      </header>

      <main className='flex min-h-0 flex-1 gap-4 pt-2 pb-6 pr-6 pl-2'>
        {/* Controls Panel */}
        <aside className='w-72 shrink-0 space-y-3 overflow-y-auto'>
          <button
            className='btn btn-primary mx-4 w-[calc(100%-2rem)]'
            onClick={() => fileInputRef.current?.click()}>
            {image ? 'change image' : 'open image'}
          </button>

          <div className='px-4'>
            <div className='px-1 mb-1 text-sm'>
              <span className='text-base-content/60 select-none pointer-events-none'>seed</span>
            </div>
            <div className='join w-full'>
              <input
                type='number'
                className='input input-sm join-item flex-1 min-w-0 border-primary'
                value={params.seed}
                onChange={e => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setParams(p => ({ ...p, seed: val }))
                  }
                }}
              />
              <button
                className='btn btn-sm btn-primary join-item'
                title='Randomize seed'
                onClick={() => {
                  setParams(p => ({ ...p, seed: Math.floor(Math.random() * 0x80000000) }))
                }}>
                🎲
              </button>
            </div>
          </div>

          <EffectSection
            label='grain'
            enabled={params.grainEnabled}
            onToggle={v => {
              setParams(p => ({ ...p, grainEnabled: v }))
            }}>
            <SliderControl
              label='strength'
              value={params.grainStrength}
              defaultValue={DEFAULT_PARAMS.grainStrength}
              min={0}
              max={5}
              onChange={v => {
                setParams(p => ({ ...p, grainStrength: v }))
              }}
            />
            <SliderControl
              label='size'
              value={params.grainSize}
              defaultValue={DEFAULT_PARAMS.grainSize}
              min={0.1}
              max={4}
              onChange={v => {
                setParams(p => ({ ...p, grainSize: v }))
              }}
            />
            <SliderControl
              label='saturation'
              value={params.grainSaturation}
              defaultValue={DEFAULT_PARAMS.grainSaturation}
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
              defaultValue={DEFAULT_PARAMS.filmToe}
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
              defaultValue={DEFAULT_PARAMS.filmMidtoneBias}
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
              defaultValue={DEFAULT_PARAMS.halationStrength}
              min={0}
              max={2}
              onChange={v => {
                setParams(p => ({ ...p, halationStrength: v }))
              }}
            />
            <SliderControl
              label='threshold'
              value={params.halationThreshold}
              defaultValue={DEFAULT_PARAMS.halationThreshold}
              min={0}
              max={1}
              onChange={v => {
                setParams(p => ({ ...p, halationThreshold: v }))
              }}
            />
            <SliderControl
              label='radius'
              value={params.halationRadius}
              defaultValue={DEFAULT_PARAMS.halationRadius}
              min={5}
              max={100}
              precision={0}
              onChange={v => {
                setParams(p => ({ ...p, halationRadius: v }))
              }}
            />
            <label className='flex cursor-pointer items-center justify-between px-3'>
              <span className='text-base-content/60 text-sm select-none'>monochrome</span>
              <input
                type='checkbox'
                checked={params.halationMonochrome}
                onChange={e => {
                  setParams(p => ({ ...p, halationMonochrome: e.target.checked }))
                }}
                className='toggle toggle-primary toggle-sm'
              />
            </label>
          </EffectSection>

          {/* Export Section */}
          <div className='card bg-base-200 border-primary/30 mx-2 border'>
            <div className='card-body p-4 space-y-3'>
              <span className='card-title text-base'>export</span>

              <div className='flex gap-2'>
                {(['png', 'jpeg', 'webp'] as const).map(fmt => (
                  <button
                    key={fmt}
                    className={`btn btn-sm flex-1 ${exportFormat === fmt ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => {
                      setExportFormat(fmt)
                    }}>
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>

              {exportFormat !== 'png' && (
                <SliderControl
                  label='quality'
                  value={exportQuality}
                  defaultValue={0.95}
                  min={0.1}
                  max={1}
                  precision={2}
                  onChange={setExportQuality}
                />
              )}

              <button
                className='btn btn-primary w-full'
                onClick={() => {
                  handleExport().catch(console.error)
                }}
                disabled={!image || isExporting}>
                {isExporting ? (
                  <>
                    <span className='loading loading-spinner loading-sm' />
                    exporting...
                  </>
                ) : (
                  'export image'
                )}
              </button>
            </div>
          </div>
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
          ) : image && renderer ? (
            <WebGpuCanvas
              image={image}
              params={params}
              showOriginal={showOriginal}
              onToggleOriginal={() => {
                setShowOriginal(s => !s)
              }}
              renderer={renderer}
            />
          ) : (
            <p className='text-base-content/40'>drop an image here or click to open</p>
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

  // View state (zoom and pan)
  const [viewState, setViewState] = useState<ViewState>(DEFAULT_VIEW_STATE)

  // Container dimensions for canvas sizing and zoom percentage calculation
  const [containerRef, containerSize] = useObservedDimensions<HTMLDivElement>()

  // Drag state for panning
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(
    null,
  )

  // Sync view state with renderer and trigger re-render
  useEffect(() => {
    const canvasContext = canvasContextRef.current
    if (!canvasContext) return

    renderer.setViewState(viewState)
    renderer.render(canvasContext)
  }, [renderer, viewState])

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

    const canvasContext = configureCanvasContext(canvas, renderer.getContext())
    canvasContextRef.current = canvasContext

    // Re-render after resize
    renderer.render(canvasContext)
  }, [renderer, containerSize])

  // Update grain params and regenerate tiles when grain settings change (debounced)
  useEffect(() => {
    const canvasContext = canvasContextRef.current

    renderer.setGrainParams({
      seed: params.seed,
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
  }, [renderer, params.seed, params.grainSize])

  // Update blend params when effect settings change
  useEffect(() => {
    const canvasContext = canvasContextRef.current

    renderer.setBlendParams({
      enabled: !showOriginal && (params.grainEnabled || params.filmEnabled),
      strength: params.grainEnabled ? params.grainStrength : 0,
      saturation: params.grainSaturation,
      toe: params.filmEnabled ? params.filmToe : 0,
      midtoneBias: params.filmEnabled ? params.filmMidtoneBias : 1,
    })

    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [
    renderer,
    showOriginal,
    params.grainEnabled,
    params.grainStrength,
    params.grainSaturation,
    params.filmEnabled,
    params.filmToe,
    params.filmMidtoneBias,
  ])

  // Update halation params when halation settings change
  useEffect(() => {
    const canvasContext = canvasContextRef.current

    renderer.setHalationParams({
      enabled: !showOriginal && params.halationEnabled,
      strength: params.halationStrength,
      threshold: params.halationThreshold,
      radius: params.halationRadius,
      monochrome: params.halationMonochrome,
    })

    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [
    renderer,
    showOriginal,
    params.halationEnabled,
    params.halationStrength,
    params.halationThreshold,
    params.halationRadius,
    params.halationMonochrome,
  ])

  // Upload image when it changes
  useEffect(() => {
    renderer.uploadImage(image)

    // Trigger a render if canvas context is ready
    const canvasContext = canvasContextRef.current
    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [renderer, image])

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
        className={`h-full w-full ${cursorClass}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Zoom toolbar */}
      <div className='absolute right-3 bottom-3 flex items-center gap-1 rounded-lg bg-base-300/80 p-1 backdrop-blur-sm'>
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
          <span className='card-title text-base select-none'>{label}</span>
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
  defaultValue,
  min,
  max,
  onChange,
  precision = 2,
}: {
  label: string
  value: number
  defaultValue: number
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
        <span className='text-base-content/60 select-none pointer-events-none'>{label}</span>
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
        onDoubleClick={() => {
          onChange(defaultValue)
        }}
        className='range range-primary range-sm'
      />
    </div>
  )
}
