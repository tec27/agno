export default function App() {
  return (
    <div className='bg-base-100 text-base-content min-h-screen'>
      <header className='border-base-300 border-b px-6 py-4'>
        <h1 className='text-xl font-semibold'>agno</h1>
      </header>

      <main className='flex gap-6 p-6'>
        {/* Controls Panel */}
        <aside className='w-72 shrink-0 space-y-6'>
          <section>
            <h2 className='text-base-content/80 mb-3 text-sm font-medium'>grain</h2>
            <div className='space-y-4'>
              <SliderControl label='strength' value={0.5} min={0} max={1} />
              <SliderControl label='size' value={2} min={1} max={4} />
              <SliderControl label='saturation' value={0.5} min={0} max={1} />
            </div>
          </section>

          <section>
            <h2 className='text-base-content/80 mb-3 text-sm font-medium'>film</h2>
            <div className='space-y-4'>
              <SliderControl label='toe' value={0.05} min={0} max={0.2} />
            </div>
          </section>

          <section>
            <h2 className='text-base-content/80 mb-3 text-sm font-medium'>halation</h2>
            <div className='space-y-4'>
              <SliderControl label='strength' value={0.3} min={0} max={1} />
              <SliderControl label='threshold' value={0.8} min={0.5} max={1} />
            </div>
          </section>
        </aside>

        {/* Preview Area */}
        <div className='border-base-300 bg-base-200/50 flex flex-1 items-center justify-center rounded-lg border border-dashed'>
          <p className='text-base-content/40'>drop an image here or click to upload</p>
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
        <span className='text-base-content/60'>{label}</span>
        <span className='text-base-content/40 font-mono'>{value.toFixed(2)}</span>
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={0.01}
        defaultValue={value}
        className='range range-primary range-xs'
      />
    </div>
  )
}
