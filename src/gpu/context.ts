/**
 * WebGpu context initialization and management
 */

export interface GpuContext {
  device: GPUDevice
  format: GPUTextureFormat
}

export async function initWebGpu(): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error('WebGpu is not supported in this browser. Please use Chrome 113+ or Edge 113+.')
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  })

  if (!adapter) {
    throw new Error('Failed to get WebGpu adapter.')
  }

  const device = await adapter.requestDevice()

  device.lost
    .then(info => {
      console.error('WebGpu device was lost:', info.message)
      if (info.reason !== 'destroyed') {
        // Could attempt to reinitialize here
      }
    })
    .catch((err: unknown) => {
      console.error('Device lost promise error:', err)
    })

  const format = navigator.gpu.getPreferredCanvasFormat()

  return { device, format }
}

export function configureCanvasContext(
  canvas: HTMLCanvasElement,
  ctx: GpuContext,
): GPUCanvasContext {
  const context = canvas.getContext('webgpu')
  if (!context) {
    throw new Error('Failed to get WebGpu canvas context.')
  }

  context.configure({
    device: ctx.device,
    format: ctx.format,
    alphaMode: 'premultiplied',
  })

  return context
}
