import { useEffect, useRef, useState } from 'react'
import { WebGpuCanvas } from './canvas/WebGpuCanvas'
import { EffectSection } from './controls/EffectSection'
import { MobileControlsPanel } from './controls/MobileControlsPanel'
import { SliderControl } from './controls/SliderControl'
import { DEFAULT_PARAMS } from './effectParams'
import { Renderer } from './gpu/Renderer'
import { useWebGpu } from './gpu/useWebGpu'
import { useFileDrop } from './hooks/useFileDrop'
import { useImagePaste } from './hooks/useImagePaste'

export default function App() {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [imageName, setImageName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg')
  const [exportQuality, setExportQuality] = useState(0.95)
  const [isExporting, setIsExporting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [renderer, setRenderer] = useState<Renderer | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const gpu = useWebGpu()

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

  const { isDragging, dropProps } = useFileDrop(file => {
    handleFile(file).catch(console.error)
  })

  useImagePaste(file => {
    handleFile(file).catch(console.error)
  })

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
      setRenderer(r => (r === newRenderer ? null : r))
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

  async function handleCopyToClipboard() {
    if (!renderer || isCopying) return

    setIsCopying(true)
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

      // Clipboard API requires PNG format
      const blob = await offscreen.convertToBlob({ type: 'image/png' })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } finally {
      setIsCopying(false)
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

  const handleRandomizeSeed = () => {
    setParams(p => ({ ...p, seed: Math.floor(Math.random() * 0x80000000) }))
  }

  // Shared preview area content
  const previewContent = (
    <>
      {error && (
        <div className='alert alert-error absolute top-4 left-4 right-4 z-10 w-auto'>
          <span>{error}</span>
        </div>
      )}

      {gpu.status === 'loading' ? (
        <p className='text-base-content/40'>initializing webgpu...</p>
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
        <>
          <p className='text-base-content/40 hidden md:block'>
            drop an image here or click to get started
          </p>
          <p className='text-base-content/40 md:hidden'>tap to open an image and get started</p>
        </>
      )}
    </>
  )

  return (
    <div className='bg-base-100 text-base-content flex h-dvh flex-col'>
      {/* Mobile Layout */}
      <div className='flex min-h-0 flex-1 flex-col md:hidden'>
        {/* Mobile Header */}
        <header className='flex shrink-0 items-center justify-between px-3 py-2'>
          <h1 className='text-xl font-semibold'>agno</h1>
          <div className='flex gap-2'>
            {image && (
              <button
                className={`btn btn-sm btn-square ${showOriginal ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => {
                  setShowOriginal(s => !s)
                }}
                title='Show original'>
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  viewBox='0 0 20 20'
                  fill='currentColor'
                  className='h-5 w-5'>
                  <path
                    fillRule='evenodd'
                    d='M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'
                    clipRule='evenodd'
                  />
                </svg>
              </button>
            )}
            <button className='btn btn-ghost btn-sm' onClick={() => fileInputRef.current?.click()}>
              {image ? 'change' : 'open'}
            </button>
            <button
              className='btn btn-primary btn-sm'
              onClick={() => {
                handleExport().catch(console.error)
              }}
              disabled={!image || isExporting}>
              {isExporting ? <span className='loading loading-spinner loading-sm' /> : 'save'}
            </button>
          </div>
        </header>

        {/* Mobile Preview Area */}
        <div
          className={`bg-base-200/50 relative flex min-h-0 flex-1 cursor-pointer items-center justify-center overflow-hidden transition-colors ${
            isDragging ? 'bg-primary/10' : ''
          }`}
          {...dropProps}
          onClick={() => {
            if (!image) fileInputRef.current?.click()
          }}>
          {previewContent}

          {/* Mobile Controls Panel - overlays the canvas */}
          <div
            className='absolute inset-x-0 bottom-0'
            onClick={e => {
              e.stopPropagation()
            }}>
            <MobileControlsPanel
              params={params}
              setParams={setParams}
              onRandomizeSeed={handleRandomizeSeed}
            />
          </div>
        </div>
      </div>

      {/* Desktop Layout */}
      <header className='border-base-300 hidden shrink-0 items-center justify-between px-6 py-3 md:flex'>
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

      <main className='hidden min-h-0 flex-1 gap-4 pt-2 pb-6 pr-6 pl-2 md:flex'>
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

              <div className='flex gap-2'>
                <button
                  className='btn btn-primary flex-1'
                  onClick={() => {
                    handleExport().catch(console.error)
                  }}
                  disabled={!image || isExporting}>
                  {isExporting ? (
                    <>
                      <span className='loading loading-spinner loading-sm' />
                      saving...
                    </>
                  ) : (
                    'save'
                  )}
                </button>
                <button
                  className='btn btn-ghost btn-square'
                  onClick={() => {
                    handleCopyToClipboard().catch(console.error)
                  }}
                  disabled={!image || isCopying}
                  title='Copy to clipboard'>
                  {isCopying ? (
                    <span className='loading loading-spinner loading-sm' />
                  ) : (
                    <svg
                      xmlns='http://www.w3.org/2000/svg'
                      viewBox='0 0 20 20'
                      fill='currentColor'
                      className='h-5 w-5'>
                      <path
                        fillRule='evenodd'
                        d='M15.988 3.012A2.25 2.25 0 0 1 18 5.25v6.5A2.25 2.25 0 0 1 15.75 14H13.5V7A2.5 2.5 0 0 0 11 4.5H8.128a2.252 2.252 0 0 1 1.884-1.488A2.25 2.25 0 0 1 12.25 1h1.5a2.25 2.25 0 0 1 2.238 2.012ZM11.5 3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v.25h-3v-.25Z'
                        clipRule='evenodd'
                      />
                      <path
                        fillRule='evenodd'
                        d='M2 7a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Zm2 3.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z'
                        clipRule='evenodd'
                      />
                    </svg>
                  )}
                </button>
              </div>
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
          {...dropProps}
          onClick={() => {
            if (!image) fileInputRef.current?.click()
          }}>
          {previewContent}
        </div>
      </main>

      {/* Hidden file input (shared between mobile and desktop) */}
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
    </div>
  )
}
