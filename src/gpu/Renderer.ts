import type { GpuContext } from './context'
import fullscreenShader from './shaders/fullscreen.wgsl?raw'
import sampleShader from './shaders/sample.wgsl?raw'

export class Renderer {
  private device: GPUDevice
  private format: GPUTextureFormat
  private pipeline: GPURenderPipeline
  private sampler: GPUSampler
  private bindGroupLayout: GPUBindGroupLayout

  private imageTexture: GPUTexture | null = null
  private bindGroup: GPUBindGroup | null = null

  constructor(ctx: GpuContext) {
    this.device = ctx.device
    this.format = ctx.format

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    })

    // Create render pipeline
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    })

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: this.device.createShaderModule({ code: fullscreenShader }),
        entryPoint: 'vs_main',
      },
      fragment: {
        module: this.device.createShaderModule({ code: sampleShader }),
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    // Create sampler with linear filtering
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })
  }

  /**
   * Upload an ImageBitmap to GPU texture
   */
  uploadImage(image: ImageBitmap): void {
    // Clean up old texture
    if (this.imageTexture) {
      this.imageTexture.destroy()
    }

    // Create new texture matching image dimensions
    this.imageTexture = this.device.createTexture({
      size: { width: image.width, height: image.height },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })

    // Copy image data to texture
    this.device.queue.copyExternalImageToTexture(
      { source: image },
      { texture: this.imageTexture },
      { width: image.width, height: image.height },
    )

    // Create bind group for this texture
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: this.imageTexture.createView() },
        { binding: 1, resource: this.sampler },
      ],
    })
  }

  /**
   * Render the uploaded image to the canvas
   */
  render(context: GPUCanvasContext): void {
    if (!this.bindGroup) {
      return // No image uploaded yet
    }

    const commandEncoder = this.device.createCommandEncoder()

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })

    renderPass.setPipeline(this.pipeline)
    renderPass.setBindGroup(0, this.bindGroup)
    renderPass.draw(3) // Fullscreen triangle
    renderPass.end()

    this.device.queue.submit([commandEncoder.finish()])
  }

  /**
   * Clean up GPU resources
   */
  destroy(): void {
    if (this.imageTexture) {
      this.imageTexture.destroy()
      this.imageTexture = null
    }
    this.bindGroup = null
  }
}
