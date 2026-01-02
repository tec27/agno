import { useEffect, useRef, useState } from 'react'
import { configureCanvasContext } from './gpu/context'
import { Renderer } from './gpu/Renderer'
import { useWebGpu } from './gpu/useWebGpu'

// Parameter defaults matching IMPLEMENTATION_PLAN.md
const DEFAULT_PARAMS = {
  strength: 0.5,
  grainSize: 2.0,
  saturation: 0.7,
  toe: 0.0,
  midtoneBias: 1.0,
  halationStrength: 0.0,
  halationThreshold: 0.8,
}

export type GrainParams = typeof DEFAULT_PARAMS

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
      <header className='border-base-300 shrink-0 border-b px-6 py-4'>
        <h1 className='text-xl font-semibold'>agno</h1>
      </header>

      <main className='flex min-h-0 flex-1 gap-6 p-6'>
        {/* Controls Panel */}
        <aside className='w-72 shrink-0 space-y-6 overflow-y-auto'>
          <button className='btn btn-primary w-full' onClick={() => fileInputRef.current?.click()}>
            {image ? 'change image' : 'upload image'}
          </button>

          <section>
            <h2 className='text-base-content/80 mb-3 text-sm font-medium'>grain</h2>
            <div className='space-y-4'>
              <SliderControl
                label='strength'
                value={params.strength}
                min={0}
                max={10}
                onChange={v => {
                  setParams(p => ({ ...p, strength: v }))
                }}
              />
              <SliderControl
                label='size'
                value={params.grainSize}
                min={0.5}
                max={4}
                onChange={v => {
                  setParams(p => ({ ...p, grainSize: v }))
                }}
              />
              <SliderControl
                label='saturation'
                value={params.saturation}
                min={0}
                max={2}
                onChange={v => {
                  setParams(p => ({ ...p, saturation: v }))
                }}
              />
            </div>
          </section>

          <section>
            <h2 className='text-base-content/80 mb-3 text-sm font-medium'>film</h2>
            <div className='space-y-4'>
              <SliderControl
                label='toe'
                value={params.toe}
                min={-0.2}
                max={0.5}
                onChange={v => {
                  setParams(p => ({ ...p, toe: v }))
                }}
              />
              <SliderControl
                label='midtone bias'
                value={params.midtoneBias}
                min={0}
                max={2}
                onChange={v => {
                  setParams(p => ({ ...p, midtoneBias: v }))
                }}
              />
            </div>
          </section>

          <section>
            <h2 className='text-base-content/80 mb-3 text-sm font-medium'>halation</h2>
            <div className='space-y-4'>
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
            </div>
          </section>
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
            <WebGpuCanvas image={image} ctx={gpu.ctx} />
          ) : (
            <p className='text-base-content/40'>drop an image here or click to upload</p>
          )}
        </div>
      </main>
    </div>
  )
}

function WebGpuCanvas({
  image,
  ctx,
}: {
  image: ImageBitmap
  ctx: import('./gpu/context').GpuContext
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const canvasContextRef = useRef<GPUCanvasContext | null>(null)

  // Initialize renderer once
  useEffect(() => {
    rendererRef.current = new Renderer(ctx)
    return () => {
      rendererRef.current?.destroy()
      rendererRef.current = null
    }
  }, [ctx])

  // Configure canvas context and handle resize
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Size canvas to match image while fitting in container
    const container = canvas.parentElement
    if (!container) return

    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    const imageAspect = image.width / image.height
    const containerAspect = containerWidth / containerHeight

    let canvasWidth: number
    let canvasHeight: number

    if (imageAspect > containerAspect) {
      // Image is wider than container
      canvasWidth = containerWidth
      canvasHeight = containerWidth / imageAspect
    } else {
      // Image is taller than container
      canvasHeight = containerHeight
      canvasWidth = containerHeight * imageAspect
    }

    canvas.width = Math.round(canvasWidth * window.devicePixelRatio)
    canvas.height = Math.round(canvasHeight * window.devicePixelRatio)
    canvas.style.width = `${String(canvasWidth)}px`
    canvas.style.height = `${String(canvasHeight)}px`

    canvasContextRef.current = configureCanvasContext(canvas, ctx)
  }, [ctx, image.width, image.height])

  // Upload image and render
  useEffect(() => {
    const renderer = rendererRef.current
    const canvasContext = canvasContextRef.current
    if (!renderer || !canvasContext) return

    renderer.uploadImage(image)
    renderer.render(canvasContext)
  }, [image])

  return <canvas ref={canvasRef} className='max-h-full max-w-full' />
}

function SliderControl({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <div className='mb-1 flex justify-between text-xs'>
        <span className='text-base-content/60'>{label}</span>
        <span className='text-base-content/40 font-mono'>{value.toFixed(2)}</span>
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={e => {
          onChange(parseFloat(e.target.value))
        }}
        className='range range-primary range-xs'
      />
    </div>
  )
}
