import { useEffect, useRef, useState } from 'react'
import { configureCanvasContext } from './gpu/context'
import { Renderer } from './gpu/Renderer'
import { useWebGpu } from './gpu/useWebGpu'

const DEFAULT_PARAMS = {
  grainEnabled: true,
  grainStrength: 0.5,
  grainSize: 2.0,
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
              max={10}
              onChange={v => {
                setParams(p => ({ ...p, grainStrength: v }))
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
