import { useState } from 'react'
import { DEFAULT_PARAMS, type EffectParams } from '../effectParams'
import { SliderControl } from './SliderControl'

type ActivePanel = 'none' | 'grain' | 'film' | 'halation' | 'seed'

export function MobileControlsPanel({
  params,
  setParams,
  onRandomizeSeed,
}: {
  params: EffectParams
  setParams: React.Dispatch<React.SetStateAction<EffectParams>>
  onRandomizeSeed: () => void
}) {
  const [activePanel, setActivePanel] = useState<ActivePanel>('none')

  if (activePanel === 'none') {
    return (
      <div className='mobile-controls flex items-center justify-around rounded-t-2xl bg-base-300/80 px-2 py-3 backdrop-blur-md'>
        <EffectTab
          label='grain'
          enabled={params.grainEnabled}
          onClick={() => {
            setActivePanel('grain')
          }}
        />
        <EffectTab
          label='film'
          enabled={params.filmEnabled}
          onClick={() => {
            setActivePanel('film')
          }}
        />
        <EffectTab
          label='halation'
          enabled={params.halationEnabled}
          onClick={() => {
            setActivePanel('halation')
          }}
        />
        <button
          className='btn btn-ghost btn-sm'
          onClick={() => {
            setActivePanel('seed')
          }}>
          seed
        </button>
      </div>
    )
  }

  // Seed panel
  if (activePanel === 'seed') {
    return (
      <div className='mobile-controls rounded-t-2xl bg-base-300/80 backdrop-blur-md'>
        {/* Panel header */}
        <div className='flex items-center justify-between border-b border-base-content/10 px-4 py-3'>
          <button
            className='btn btn-ghost btn-sm gap-1 px-2'
            onClick={() => {
              setActivePanel('none')
            }}>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              viewBox='0 0 20 20'
              fill='currentColor'
              className='h-5 w-5'>
              <path
                fillRule='evenodd'
                d='M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z'
                clipRule='evenodd'
              />
            </svg>
            seed
          </button>
        </div>

        {/* Seed controls */}
        <div className='px-4 py-4'>
          <div className='join w-full'>
            <input
              type='number'
              value={params.seed}
              onChange={e => {
                const parsed = parseInt(e.target.value, 10)
                if (!isNaN(parsed)) {
                  setParams(p => ({ ...p, seed: parsed }))
                }
              }}
              className='input input-sm join-item min-w-0 flex-1 border-primary'
            />
            <button
              className='btn btn-primary btn-sm join-item'
              onClick={onRandomizeSeed}
              title='Randomize seed'>
              🎲
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Effect panels (grain, film, halation)
  return (
    <div className='mobile-controls rounded-t-2xl bg-base-300/80 backdrop-blur-md'>
      {/* Effect header */}
      <div className='flex items-center justify-between border-b border-base-content/10 px-4 py-3'>
        <button
          className='btn btn-ghost btn-sm gap-1 px-2'
          onClick={() => {
            setActivePanel('none')
          }}>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 20 20'
            fill='currentColor'
            className='h-5 w-5'>
            <path
              fillRule='evenodd'
              d='M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z'
              clipRule='evenodd'
            />
          </svg>
          {activePanel}
        </button>
        <input
          type='checkbox'
          checked={
            activePanel === 'grain'
              ? params.grainEnabled
              : activePanel === 'film'
                ? params.filmEnabled
                : params.halationEnabled
          }
          onChange={e => {
            const enabled = e.target.checked
            if (activePanel === 'grain') {
              setParams(p => ({ ...p, grainEnabled: enabled }))
            } else if (activePanel === 'film') {
              setParams(p => ({ ...p, filmEnabled: enabled }))
            } else {
              setParams(p => ({ ...p, halationEnabled: enabled }))
            }
          }}
          className='toggle toggle-primary'
        />
      </div>

      {/* Effect controls */}
      <div className='space-y-4 px-1 py-4'>
        {activePanel === 'grain' && (
          <>
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
          </>
        )}

        {activePanel === 'film' && (
          <>
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
          </>
        )}

        {activePanel === 'halation' && (
          <>
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
              <span className='text-base-content/60 select-none text-sm'>monochrome</span>
              <input
                type='checkbox'
                checked={params.halationMonochrome}
                onChange={e => {
                  setParams(p => ({ ...p, halationMonochrome: e.target.checked }))
                }}
                className='toggle toggle-primary toggle-sm'
              />
            </label>
          </>
        )}
      </div>
    </div>
  )
}

function EffectTab({
  label,
  enabled,
  onClick,
}: {
  label: string
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`btn btn-sm ${enabled ? 'btn-primary' : 'btn-ghost text-base-content/60'}`}
      onClick={onClick}>
      {label}
    </button>
  )
}
