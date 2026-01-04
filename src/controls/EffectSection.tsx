export function EffectSection({
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
