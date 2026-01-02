import { useEffect, useState } from 'react'
import { type GpuContext, initWebGpu } from './context'

export type WebGpuState =
  | { status: 'loading' }
  | { status: 'ready'; ctx: GpuContext }
  | { status: 'error'; error: string }

export function useWebGpu(): WebGpuState {
  const [state, setState] = useState<WebGpuState>({ status: 'loading' })

  useEffect(() => {
    let destroyed = false

    async function init() {
      try {
        const ctx = await initWebGpu()
        if (!destroyed) {
          setState({ status: 'ready', ctx })
        }
      } catch (err) {
        if (!destroyed) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to initialize WebGPU',
          })
        }
      }
    }

    init().catch(console.error)

    return () => {
      destroyed = true
      // Device cleanup happens automatically when context is garbage collected
    }
  }, [])

  return state
}
