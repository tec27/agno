export default function App() {
  return (
    <div className='min-h-screen bg-neutral-900 text-neutral-100'>
      <header className='border-b border-neutral-800 px-6 py-4'>
        <h1 className='text-xl font-semibold'>Agno</h1>
        <p className='text-sm text-neutral-400'>Film Grain Effect</p>
      </header>

      <main className='flex gap-6 p-6'>
        {/* Controls Panel */}
        <aside className='w-72 shrink-0 space-y-6'>
          <section>
            <h2 className='mb-3 text-sm font-medium text-neutral-300'>Grain</h2>
            <div className='space-y-4'>
              <SliderControl label='Strength' value={0.5} min={0} max={1} />
              <SliderControl label='Size' value={2} min={1} max={4} />
              <SliderControl label='Saturation' value={0.5} min={0} max={1} />
            </div>
          </section>

          <section>
            <h2 className='mb-3 text-sm font-medium text-neutral-300'>Film</h2>
            <div className='space-y-4'>
              <SliderControl label='Toe' value={0.05} min={0} max={0.2} />
            </div>
          </section>

          <section>
            <h2 className='mb-3 text-sm font-medium text-neutral-300'>Halation</h2>
            <div className='space-y-4'>
              <SliderControl label='Strength' value={0.3} min={0} max={1} />
              <SliderControl label='Threshold' value={0.8} min={0.5} max={1} />
            </div>
          </section>
        </aside>

        {/* Preview Area */}
        <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-800/50'>
          <p className='text-neutral-500'>Drop an image here or click to upload</p>
        </div>
      </main>
    </div>
  )
}

function SliderControl({
  label,
  value,
  min,
  max,
}: {
  label: string
  value: number
  min: number
  max: number
}) {
  return (
    <div>
      <div className='mb-1 flex justify-between text-xs'>
        <span className='text-neutral-400'>{label}</span>
        <span className='font-mono text-neutral-500'>{value.toFixed(2)}</span>
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={0.01}
        defaultValue={value}
        className='w-full accent-blue-500'
      />
    </div>
  )
}
