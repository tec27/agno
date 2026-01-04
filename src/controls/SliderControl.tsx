import { useState } from 'react'

export function SliderControl({
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
      <div className='mb-1 flex justify-between px-1 text-sm'>
        <span className='text-base-content/60 pointer-events-none select-none'>{label}</span>
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
