import type { GpuContext } from './context'
import halationBlurShader from './shaders/halation/blur.wgsl?raw'
import halationDownsampleShader from './shaders/halation/downsample.wgsl?raw'
import halationThresholdShader from './shaders/halation/threshold.wgsl?raw'
import halationUpsampleBlendShader from './shaders/halation/upsample-blend.wgsl?raw'

export interface HalationParams {
  enabled: boolean
  strength: number // 0-1
  threshold: number // 0-1
  radius: number // blur radius in pixels (at full resolution)
}

/**
 * Manages halation effect processing - the red glow around bright areas in film.
 *
 * Pipeline:
 * 1. Threshold - extract bright areas with soft falloff
 * 2. Downsample 4x - for efficient large blur
 * 3. Blur H - horizontal Gaussian blur
 * 4. Blur V - vertical Gaussian blur
 * 5. Upsample + Blend - bilinear upsample, red-shift, additive blend
 */
export class HalationProcessor {
  private device: GPUDevice

  // Pipelines
  private thresholdPipeline: GPUComputePipeline
  private downsamplePipeline: GPUComputePipeline
  private blurPipeline: GPUComputePipeline
  private upsampleBlendPipeline: GPUComputePipeline

  // Bind group layouts
  private thresholdBindGroupLayout: GPUBindGroupLayout
  private downsampleBindGroupLayout: GPUBindGroupLayout
  private blurBindGroupLayout: GPUBindGroupLayout
  private upsampleBlendBindGroupLayout: GPUBindGroupLayout

  // Uniform buffers
  private thresholdUniformBuffer: GPUBuffer
  private blurUniformBuffer: GPUBuffer
  private upsampleBlendUniformBuffer: GPUBuffer

  // Sampler for bilinear upsampling
  private sampler: GPUSampler

  // Work textures (created per-image size)
  private highlightTexture: GPUTexture | null = null
  private downsampledTexture: GPUTexture | null = null
  private blurPingTexture: GPUTexture | null = null
  private blurPongTexture: GPUTexture | null = null
  private outputTexture: GPUTexture | null = null

  // Current image dimensions
  private imageWidth = 0
  private imageHeight = 0

  // Current parameters
  private params: HalationParams = {
    enabled: false,
    strength: 0.3,
    threshold: 0.8,
    radius: 20,
  }

  constructor(ctx: GpuContext) {
    this.device = ctx.device

    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })

    // Threshold pipeline
    this.thresholdBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    })

    this.thresholdPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.thresholdBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: halationThresholdShader }),
        entryPoint: 'main',
      },
    })

    this.thresholdUniformBuffer = this.device.createBuffer({
      size: 16, // threshold, width, height, padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Downsample pipeline
    this.downsampleBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
      ],
    })

    this.downsamplePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.downsampleBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: halationDownsampleShader }),
        entryPoint: 'main',
      },
    })

    // Blur pipeline (used for both H and V passes)
    this.blurBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    })

    this.blurPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.blurBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: halationBlurShader }),
        entryPoint: 'main',
      },
    })

    this.blurUniformBuffer = this.device.createBuffer({
      size: 16, // kernel_radius (i32), sigma (f32), direction (u32), padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Upsample + blend pipeline
    this.upsampleBlendBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba8unorm' },
        },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    })

    this.upsampleBlendPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.upsampleBlendBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: halationUpsampleBlendShader }),
        entryPoint: 'main',
      },
    })

    this.upsampleBlendUniformBuffer = this.device.createBuffer({
      size: 16, // strength, width, height, padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Update halation parameters
   */
  setParams(params: Partial<HalationParams>): void {
    this.params = { ...this.params, ...params }
  }

  /**
   * Get current parameters
   */
  getParams(): HalationParams {
    return { ...this.params }
  }

  /**
   * Check if halation is enabled
   */
  isEnabled(): boolean {
    return this.params.enabled
  }

  /**
   * Create/resize work textures for the given image dimensions.
   * Call this when the image size changes.
   */
  resize(width: number, height: number, mipLevelCount: number): void {
    // Skip if dimensions haven't changed
    if (width === this.imageWidth && height === this.imageHeight && this.outputTexture) {
      return
    }

    this.destroyTextures()

    this.imageWidth = width
    this.imageHeight = height

    // Full resolution highlight extraction
    this.highlightTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })

    // 1/4 resolution textures for efficient large blur
    const dsWidth = Math.max(1, Math.ceil(width / 4))
    const dsHeight = Math.max(1, Math.ceil(height / 4))

    this.downsampledTexture = this.device.createTexture({
      size: { width: dsWidth, height: dsHeight },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })

    this.blurPingTexture = this.device.createTexture({
      size: { width: dsWidth, height: dsHeight },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })

    this.blurPongTexture = this.device.createTexture({
      size: { width: dsWidth, height: dsHeight },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })

    // Full resolution output with mipmaps for display
    this.outputTexture = this.device.createTexture({
      size: { width, height },
      format: 'rgba8unorm',
      mipLevelCount,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })
  }

  /**
   * Check if textures are ready for processing
   */
  isReady(): boolean {
    return this.getWorkTextures() !== null
  }

  /**
   * Get all work textures if ready, or null if not initialized
   */
  private getWorkTextures(): {
    highlight: GPUTexture
    downsampled: GPUTexture
    blurPing: GPUTexture
    blurPong: GPUTexture
    output: GPUTexture
  } | null {
    if (
      !this.highlightTexture ||
      !this.downsampledTexture ||
      !this.blurPingTexture ||
      !this.blurPongTexture ||
      !this.outputTexture
    ) {
      return null
    }
    return {
      highlight: this.highlightTexture,
      downsampled: this.downsampledTexture,
      blurPing: this.blurPingTexture,
      blurPong: this.blurPongTexture,
      output: this.outputTexture,
    }
  }

  /**
   * Get the output texture (for display after processing)
   */
  getOutputTexture(): GPUTexture | null {
    return this.outputTexture
  }

  /**
   * Run the halation pipeline.
   * Returns the output texture, or the input texture if not ready.
   */
  process(inputTexture: GPUTexture, generateMipmaps: (tex: GPUTexture) => void): GPUTexture {
    const textures = this.getWorkTextures()
    if (!textures) {
      return inputTexture
    }

    const {
      highlight: highlightTex,
      downsampled: downsampledTex,
      blurPing: blurPingTex,
      blurPong: blurPongTex,
      output: outputTex,
    } = textures

    const dsWidth = Math.max(1, Math.ceil(this.imageWidth / 4))
    const dsHeight = Math.max(1, Math.ceil(this.imageHeight / 4))

    // Calculate blur parameters (radius is at full resolution, divide by 4 for downsampled)
    const dsRadius = Math.max(1, Math.round(this.params.radius / 4))
    const sigma = dsRadius / 3

    const commandEncoder = this.device.createCommandEncoder()

    // Pass 1: Threshold - extract bright areas
    this.device.queue.writeBuffer(
      this.thresholdUniformBuffer,
      0,
      new Float32Array([this.params.threshold, this.imageWidth, this.imageHeight, 0]),
    )

    const thresholdBindGroup = this.device.createBindGroup({
      layout: this.thresholdBindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: highlightTex.createView() },
        { binding: 2, resource: { buffer: this.thresholdUniformBuffer } },
      ],
    })

    const thresholdPass = commandEncoder.beginComputePass()
    thresholdPass.setPipeline(this.thresholdPipeline)
    thresholdPass.setBindGroup(0, thresholdBindGroup)
    thresholdPass.dispatchWorkgroups(
      Math.ceil(this.imageWidth / 16),
      Math.ceil(this.imageHeight / 16),
    )
    thresholdPass.end()

    // Pass 2: Downsample 4x
    const downsampleBindGroup = this.device.createBindGroup({
      layout: this.downsampleBindGroupLayout,
      entries: [
        { binding: 0, resource: highlightTex.createView() },
        { binding: 1, resource: downsampledTex.createView() },
      ],
    })

    const downsamplePass = commandEncoder.beginComputePass()
    downsamplePass.setPipeline(this.downsamplePipeline)
    downsamplePass.setBindGroup(0, downsampleBindGroup)
    downsamplePass.dispatchWorkgroups(Math.ceil(dsWidth / 16), Math.ceil(dsHeight / 16))
    downsamplePass.end()

    // Pass 3: Horizontal blur
    this.device.queue.writeBuffer(this.blurUniformBuffer, 0, new Int32Array([dsRadius]))
    this.device.queue.writeBuffer(this.blurUniformBuffer, 4, new Float32Array([sigma]))
    this.device.queue.writeBuffer(this.blurUniformBuffer, 8, new Uint32Array([0, 0])) // direction = 0 (horizontal)

    const blurHBindGroup = this.device.createBindGroup({
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: downsampledTex.createView() },
        { binding: 1, resource: blurPingTex.createView() },
        { binding: 2, resource: { buffer: this.blurUniformBuffer } },
      ],
    })

    const blurHPass = commandEncoder.beginComputePass()
    blurHPass.setPipeline(this.blurPipeline)
    blurHPass.setBindGroup(0, blurHBindGroup)
    blurHPass.dispatchWorkgroups(Math.ceil(dsWidth / 64), Math.ceil(dsHeight / 4))
    blurHPass.end()

    // Pass 4: Vertical blur
    this.device.queue.writeBuffer(this.blurUniformBuffer, 8, new Uint32Array([1, 0])) // direction = 1 (vertical)

    const blurVBindGroup = this.device.createBindGroup({
      layout: this.blurBindGroupLayout,
      entries: [
        { binding: 0, resource: blurPingTex.createView() },
        { binding: 1, resource: blurPongTex.createView() },
        { binding: 2, resource: { buffer: this.blurUniformBuffer } },
      ],
    })

    const blurVPass = commandEncoder.beginComputePass()
    blurVPass.setPipeline(this.blurPipeline)
    blurVPass.setBindGroup(0, blurVBindGroup)
    blurVPass.dispatchWorkgroups(Math.ceil(dsWidth / 64), Math.ceil(dsHeight / 4))
    blurVPass.end()

    // Pass 5: Upsample and blend
    this.device.queue.writeBuffer(
      this.upsampleBlendUniformBuffer,
      0,
      new Float32Array([this.params.strength, this.imageWidth, this.imageHeight, 0]),
    )

    const upsampleBlendBindGroup = this.device.createBindGroup({
      layout: this.upsampleBlendBindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: blurPongTex.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: outputTex.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 4, resource: { buffer: this.upsampleBlendUniformBuffer } },
      ],
    })

    const upsampleBlendPass = commandEncoder.beginComputePass()
    upsampleBlendPass.setPipeline(this.upsampleBlendPipeline)
    upsampleBlendPass.setBindGroup(0, upsampleBlendBindGroup)
    upsampleBlendPass.dispatchWorkgroups(
      Math.ceil(this.imageWidth / 16),
      Math.ceil(this.imageHeight / 16),
    )
    upsampleBlendPass.end()

    this.device.queue.submit([commandEncoder.finish()])

    // Generate mipmaps for display
    generateMipmaps(outputTex)

    return outputTex
  }

  /**
   * Destroy work textures
   */
  private destroyTextures(): void {
    if (this.highlightTexture) {
      this.highlightTexture.destroy()
      this.highlightTexture = null
    }
    if (this.downsampledTexture) {
      this.downsampledTexture.destroy()
      this.downsampledTexture = null
    }
    if (this.blurPingTexture) {
      this.blurPingTexture.destroy()
      this.blurPingTexture = null
    }
    if (this.blurPongTexture) {
      this.blurPongTexture.destroy()
      this.blurPongTexture = null
    }
    if (this.outputTexture) {
      this.outputTexture.destroy()
      this.outputTexture = null
    }
  }

  /**
   * Clean up all GPU resources
   */
  destroy(): void {
    this.destroyTextures()
  }
}
