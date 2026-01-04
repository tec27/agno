import type { GpuContext } from './context'
import { GrainGenerator, type GrainParams } from './GrainGenerator'
import { HalationProcessor, type HalationParams } from './HalationProcessor'
import blendShader from './shaders/blend.wgsl?raw'
import showGrainTileShader from './shaders/debug/show-grain-tile.wgsl?raw'
import fullscreenShader from './shaders/fullscreen.wgsl?raw'
import sampleShader from './shaders/sample.wgsl?raw'

export type { HalationParams } from './HalationProcessor'

export interface DebugState {
  showGrainTile: boolean
  tileIndex: number
}

export interface ViewState {
  zoom: number // 1.0 = fit, >1 = zoom in
  centerX: number // 0.5 = centered
  centerY: number
}

export interface BlendParams {
  strength: number // 0-5
  saturation: number // 0-2
  toe: number // -0.2-0.5
  midtoneBias: number // 0-2
  enabled: boolean
}

export class Renderer {
  private ctx: GpuContext
  private device: GPUDevice
  private format: GPUTextureFormat
  private pipeline: GPURenderPipeline
  private sampler: GPUSampler
  private bindGroupLayout: GPUBindGroupLayout

  private imageTexture: GPUTexture | null = null
  private imageWidth = 0
  private imageHeight = 0

  // View transform
  private viewUniformBuffer: GPUBuffer
  private viewState: ViewState = { zoom: 1.0, centerX: 0.5, centerY: 0.5 }

  // Grain generation
  private grainGenerator: GrainGenerator
  private grainParams: GrainParams | null = null

  // Grain blend effect
  private blendPipeline: GPUComputePipeline
  private blendBindGroupLayout: GPUBindGroupLayout
  private blendUniformBuffer: GPUBuffer
  private blendOutputTexture: GPUTexture | null = null
  private blendParams: BlendParams = {
    strength: 0.5,
    saturation: 0.7,
    toe: 0.0,
    midtoneBias: 1.0,
    enabled: true,
  }

  // Halation effect
  private halationProcessor: HalationProcessor

  // Debug mode
  private debugPipeline: GPURenderPipeline
  private debugBindGroupLayout: GPUBindGroupLayout
  private debugUniformBuffer: GPUBuffer
  private debugState: DebugState = { showGrainTile: false, tileIndex: 0 }

  constructor(ctx: GpuContext) {
    this.ctx = ctx
    this.device = ctx.device
    this.format = ctx.format

    // Create bind group layout with view uniform
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
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
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

    // Create sampler with trilinear filtering (uses mipmaps for smooth downscaling)
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    })

    // Create view uniform buffer
    // ViewParams: 8 floats × 4 bytes = 32 bytes
    this.viewUniformBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Initialize grain generator
    this.grainGenerator = new GrainGenerator(ctx)

    // Initialize halation processor
    this.halationProcessor = new HalationProcessor(ctx)

    // Blend pipeline for applying grain to image
    this.blendBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float' }, // input image
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float', viewDimension: '2d-array' }, // grain tiles
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: 'filtering' }, // grain sampler
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba8unorm' }, // output
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' }, // blend params
        },
      ],
    })

    this.blendPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.blendBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: blendShader }),
        entryPoint: 'main',
      },
    })

    // BlendParams: 8 floats (strength, saturation, toe, midtone_bias, tile_size, width, height, seed)
    this.blendUniformBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Debug pipeline for visualizing grain tiles
    this.debugBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d-array' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    })

    this.debugPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.debugBindGroupLayout],
      }),
      vertex: {
        module: this.device.createShaderModule({ code: fullscreenShader }),
        entryPoint: 'vs_main',
      },
      fragment: {
        module: this.device.createShaderModule({ code: showGrainTileShader }),
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    this.debugUniformBuffer = this.device.createBuffer({
      size: 16, // tile_index (u32) + tile_size (f32) + padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Set grain generation parameters
   */
  setGrainParams(params: GrainParams): void {
    this.grainParams = params
  }

  /**
   * Set grain blend parameters
   */
  setBlendParams(params: Partial<BlendParams>): void {
    this.blendParams = { ...this.blendParams, ...params }
  }

  /**
   * Set halation effect parameters
   */
  setHalationParams(params: Partial<HalationParams>): void {
    this.halationProcessor.setParams(params)
  }

  /**
   * Generate grain tiles (call before render if params changed)
   */
  async updateGrain(): Promise<void> {
    if (this.grainParams) {
      await this.grainGenerator.generateTiles(this.grainParams)
    }
  }

  /**
   * Set debug state for visualization
   */
  setDebugState(state: Partial<DebugState>): void {
    this.debugState = { ...this.debugState, ...state }
  }

  /**
   * Get current debug state
   */
  getDebugState(): DebugState {
    return { ...this.debugState }
  }

  /**
   * Set view state (zoom and pan)
   */
  setViewState(state: Partial<ViewState>): void {
    this.viewState = { ...this.viewState, ...state }
  }

  /**
   * Get current view state
   */
  getViewState(): ViewState {
    return { ...this.viewState }
  }

  /**
   * Get the GPU context (for canvas configuration)
   */
  getContext(): GpuContext {
    return this.ctx
  }

  /**
   * Upload an ImageBitmap to GPU texture with mipmaps for quality downscaling
   */
  uploadImage(image: ImageBitmap): void {
    // Clean up old textures
    if (this.imageTexture) {
      this.imageTexture.destroy()
    }
    if (this.blendOutputTexture) {
      this.blendOutputTexture.destroy()
    }

    // Store dimensions for aspect ratio calculations
    this.imageWidth = image.width
    this.imageHeight = image.height

    // Calculate mip levels for quality downscaling
    const mipLevelCount = Math.floor(Math.log2(Math.max(image.width, image.height))) + 1

    // Create new texture with mipmap support
    // Needs STORAGE_BINDING for mipmap generation compute shader
    this.imageTexture = this.device.createTexture({
      size: { width: image.width, height: image.height },
      format: 'rgba8unorm',
      mipLevelCount,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })

    // Copy image data to mip level 0
    this.device.queue.copyExternalImageToTexture(
      { source: image },
      { texture: this.imageTexture },
      { width: image.width, height: image.height },
    )

    // Generate mipmaps using the GPU
    this.generateMipmaps(this.imageTexture)

    // Create blend output texture (same size as input, with mipmaps for display)
    this.blendOutputTexture = this.device.createTexture({
      size: { width: image.width, height: image.height },
      format: 'rgba8unorm',
      mipLevelCount,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT,
    })

    // Resize halation processor textures
    this.halationProcessor.resize(image.width, image.height, mipLevelCount)
  }

  /**
   * Generate mipmaps for a texture using GPU blitting
   */
  private generateMipmaps(texture: GPUTexture): void {
    // Create a simple blit pipeline for mipmap generation
    const blitShader = this.device.createShaderModule({
      code: `
        @group(0) @binding(0) var src: texture_2d<f32>;
        @group(0) @binding(1) var dst: texture_storage_2d<rgba8unorm, write>;

        @compute @workgroup_size(8, 8)
        fn main(@builtin(global_invocation_id) gid: vec3u) {
          let dst_size = textureDimensions(dst);
          if (gid.x >= dst_size.x || gid.y >= dst_size.y) { return; }

          // Sample 2x2 block from source and average
          let src_pos = gid.xy * 2u;
          let c00 = textureLoad(src, src_pos, 0);
          let c10 = textureLoad(src, src_pos + vec2u(1u, 0u), 0);
          let c01 = textureLoad(src, src_pos + vec2u(0u, 1u), 0);
          let c11 = textureLoad(src, src_pos + vec2u(1u, 1u), 0);

          textureStore(dst, gid.xy, (c00 + c10 + c01 + c11) * 0.25);
        }
      `,
    })

    const blitLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba8unorm' },
        },
      ],
    })

    const blitPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [blitLayout] }),
      compute: { module: blitShader, entryPoint: 'main' },
    })

    const commandEncoder = this.device.createCommandEncoder()

    let width = texture.width
    let height = texture.height

    for (let level = 1; level < texture.mipLevelCount; level++) {
      width = Math.max(1, Math.floor(width / 2))
      height = Math.max(1, Math.floor(height / 2))

      const bindGroup = this.device.createBindGroup({
        layout: blitLayout,
        entries: [
          {
            binding: 0,
            resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
          },
          { binding: 1, resource: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }) },
        ],
      })

      const pass = commandEncoder.beginComputePass()
      pass.setPipeline(blitPipeline)
      pass.setBindGroup(0, bindGroup)
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8))
      pass.end()
    }

    this.device.queue.submit([commandEncoder.finish()])
  }

  /**
   * Apply all effects (grain blend + halation) and return the output texture.
   * Returns the original image texture if no effects are enabled.
   * @param forExport - If true, ignores the 'enabled' flags and applies effects based on strength values
   */
  private renderEffects(forExport = false): GPUTexture | null {
    if (!this.imageTexture) {
      return null
    }

    let outputTexture: GPUTexture = this.imageTexture

    // For export, apply grain/film if strength > 0; for display, check enabled flag
    const shouldApplyBlend = forExport
      ? this.blendParams.strength > 0 ||
        this.blendParams.toe !== 0 ||
        this.blendParams.midtoneBias !== 1
      : this.blendParams.enabled

    const grainTiles = this.grainGenerator.getTileArray()
    if (shouldApplyBlend && grainTiles && this.blendOutputTexture && this.grainParams) {
      // Update blend uniform buffer
      this.device.queue.writeBuffer(
        this.blendUniformBuffer,
        0,
        new Float32Array([
          this.blendParams.strength,
          this.blendParams.saturation,
          this.blendParams.toe,
          this.blendParams.midtoneBias,
          this.grainParams.grainSize,
          this.imageWidth,
          this.imageHeight,
        ]),
      )
      this.device.queue.writeBuffer(
        this.blendUniformBuffer,
        28,
        new Uint32Array([this.grainParams.seed]),
      )

      // Create blend bind group
      const blendBindGroup = this.device.createBindGroup({
        layout: this.blendBindGroupLayout,
        entries: [
          { binding: 0, resource: this.imageTexture.createView() },
          { binding: 1, resource: grainTiles.createView({ dimension: '2d-array' }) },
          { binding: 2, resource: this.sampler },
          {
            binding: 3,
            resource: this.blendOutputTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
          },
          { binding: 4, resource: { buffer: this.blendUniformBuffer } },
        ],
      })

      // Run blend compute shader
      const commandEncoder = this.device.createCommandEncoder()
      const blendPass = commandEncoder.beginComputePass()
      blendPass.setPipeline(this.blendPipeline)
      blendPass.setBindGroup(0, blendBindGroup)
      blendPass.dispatchWorkgroups(
        Math.ceil(this.imageWidth / 16),
        Math.ceil(this.imageHeight / 16),
      )
      blendPass.end()
      this.device.queue.submit([commandEncoder.finish()])

      // Generate mipmaps for the blended output
      this.generateMipmaps(this.blendOutputTexture)

      outputTexture = this.blendOutputTexture
    }

    // Apply halation if enabled (for export, check if strength > 0)
    const shouldApplyHalation = forExport
      ? this.halationProcessor.getParams().strength > 0
      : this.halationProcessor.isEnabled()

    if (shouldApplyHalation && this.halationProcessor.isReady()) {
      outputTexture = this.halationProcessor.process(outputTexture, this.generateMipmaps.bind(this))
    }

    return outputTexture
  }

  /**
   * Display a texture on the canvas with zoom/pan transform
   */
  private displayTexture(context: GPUCanvasContext, texture: GPUTexture): void {
    const canvasTexture = context.getCurrentTexture()
    const canvasWidth = canvasTexture.width
    const canvasHeight = canvasTexture.height

    // Update view uniform buffer
    this.device.queue.writeBuffer(
      this.viewUniformBuffer,
      0,
      new Float32Array([
        this.viewState.zoom,
        this.viewState.centerX,
        this.viewState.centerY,
        canvasWidth / canvasHeight,
        this.imageWidth / this.imageHeight,
        0,
        0,
        0,
      ]),
    )

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewUniformBuffer } },
      ],
    })

    const commandEncoder = this.device.createCommandEncoder()
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: canvasTexture.createView(),
          clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })

    renderPass.setPipeline(this.pipeline)
    renderPass.setBindGroup(0, bindGroup)
    renderPass.draw(3)
    renderPass.end()

    this.device.queue.submit([commandEncoder.finish()])
  }

  /**
   * Render the uploaded image to the canvas
   */
  render(context: GPUCanvasContext): void {
    // Debug mode: show grain tile
    if (this.debugState.showGrainTile) {
      const grainTiles = this.grainGenerator.getTileArray()
      if (grainTiles) {
        const canvasTexture = context.getCurrentTexture()
        const canvasWidth = canvasTexture.width
        const canvasHeight = canvasTexture.height

        const tileSize = this.grainParams ? Math.round(256 * this.grainParams.grainSize) : 256
        this.device.queue.writeBuffer(
          this.debugUniformBuffer,
          0,
          new Uint32Array([this.debugState.tileIndex]),
        )
        this.device.queue.writeBuffer(
          this.debugUniformBuffer,
          4,
          new Float32Array([tileSize, canvasWidth, canvasHeight]),
        )

        const debugBindGroup = this.device.createBindGroup({
          layout: this.debugBindGroupLayout,
          entries: [
            { binding: 0, resource: grainTiles.createView({ dimension: '2d-array' }) },
            { binding: 1, resource: this.sampler },
            { binding: 2, resource: { buffer: this.debugUniformBuffer } },
          ],
        })

        const commandEncoder = this.device.createCommandEncoder()
        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: canvasTexture.createView(),
              clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        })

        renderPass.setPipeline(this.debugPipeline)
        renderPass.setBindGroup(0, debugBindGroup)
        renderPass.draw(3)
        renderPass.end()
        this.device.queue.submit([commandEncoder.finish()])
        return
      }
    }

    // Normal mode: apply effects and display
    const outputTexture = this.renderEffects()
    if (!outputTexture) {
      // No image loaded - just clear the canvas
      const commandEncoder = this.device.createCommandEncoder()
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      renderPass.end()
      this.device.queue.submit([commandEncoder.finish()])
      return
    }

    this.displayTexture(context, outputTexture)
  }

  /**
   * Render the current image with all effects applied and return pixel data.
   * This renders at full image resolution, not display resolution.
   * Returns null if no image is loaded.
   */
  async renderForExport(): Promise<{
    data: Uint8ClampedArray
    width: number
    height: number
  } | null> {
    const outputTexture = this.renderEffects(true)
    if (!outputTexture) {
      return null
    }

    // Read pixel data from the output texture
    const bytesPerRow = Math.ceil((this.imageWidth * 4) / 256) * 256 // Must be aligned to 256
    const bufferSize = bytesPerRow * this.imageHeight

    const readBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    const commandEncoder = this.device.createCommandEncoder()
    commandEncoder.copyTextureToBuffer(
      { texture: outputTexture, mipLevel: 0 },
      { buffer: readBuffer, bytesPerRow, rowsPerImage: this.imageHeight },
      { width: this.imageWidth, height: this.imageHeight },
    )
    this.device.queue.submit([commandEncoder.finish()])

    // Wait for GPU to finish and map the buffer
    await readBuffer.mapAsync(GPUMapMode.READ)
    const mappedRange = readBuffer.getMappedRange()
    const rawData = new Uint8Array(mappedRange)

    // Copy to a properly sized array (removing padding)
    const pixelData = new Uint8ClampedArray(this.imageWidth * this.imageHeight * 4)
    for (let y = 0; y < this.imageHeight; y++) {
      const srcOffset = y * bytesPerRow
      const dstOffset = y * this.imageWidth * 4
      pixelData.set(rawData.subarray(srcOffset, srcOffset + this.imageWidth * 4), dstOffset)
    }

    readBuffer.unmap()
    readBuffer.destroy()

    return {
      data: pixelData,
      width: this.imageWidth,
      height: this.imageHeight,
    }
  }

  /**
   * Get current image dimensions (for export naming)
   */
  getImageDimensions(): { width: number; height: number } | null {
    if (!this.imageTexture) {
      return null
    }
    return { width: this.imageWidth, height: this.imageHeight }
  }

  /**
   * Clean up GPU resources
   */
  destroy(): void {
    if (this.imageTexture) {
      this.imageTexture.destroy()
      this.imageTexture = null
    }
    if (this.blendOutputTexture) {
      this.blendOutputTexture.destroy()
      this.blendOutputTexture = null
    }
    this.halationProcessor.destroy()
    this.grainGenerator.destroy()
  }
}
