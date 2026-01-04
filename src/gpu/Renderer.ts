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
   * Render the uploaded image to the canvas
   */
  render(context: GPUCanvasContext): void {
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

    // Debug mode: show grain tile
    if (this.debugState.showGrainTile) {
      const grainTiles = this.grainGenerator.getTileArray()
      if (grainTiles) {
        // Get canvas dimensions for 1:1 pixel display
        const canvasTexture = context.getCurrentTexture()
        const canvasWidth = canvasTexture.width
        const canvasHeight = canvasTexture.height

        // Update uniform buffer: tile_index, tile_size, canvas_width, canvas_height
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

        renderPass.setPipeline(this.debugPipeline)
        renderPass.setBindGroup(0, debugBindGroup)
        renderPass.draw(3)
        renderPass.end()
        this.device.queue.submit([commandEncoder.finish()])
        return
      }
    }

    // Normal mode: show image
    if (!this.imageTexture) {
      renderPass.end()
      this.device.queue.submit([commandEncoder.finish()])
      return
    }

    // Determine which texture to display
    let displayTexture = this.imageTexture

    // Apply grain blend if enabled and we have grain tiles and output texture
    const grainTiles = this.grainGenerator.getTileArray()
    if (this.blendParams.enabled && grainTiles && this.blendOutputTexture && this.grainParams) {
      // End the render pass temporarily to run compute shader
      renderPass.end()

      // Update blend uniform buffer
      // grain_size is passed directly - shader uses it to scale sampling coordinates
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
      const blendPass = commandEncoder.beginComputePass()
      blendPass.setPipeline(this.blendPipeline)
      blendPass.setBindGroup(0, blendBindGroup)
      blendPass.dispatchWorkgroups(
        Math.ceil(this.imageWidth / 16),
        Math.ceil(this.imageHeight / 16),
      )
      blendPass.end()

      // Submit blend work
      this.device.queue.submit([commandEncoder.finish()])

      // Generate mipmaps for the blended output
      this.generateMipmaps(this.blendOutputTexture)

      // Use blended output for display
      displayTexture = this.blendOutputTexture

      // Apply halation if enabled
      if (this.halationProcessor.isEnabled() && this.halationProcessor.isReady()) {
        displayTexture = this.halationProcessor.process(
          displayTexture,
          this.generateMipmaps.bind(this),
        )
      }

      // Create new command encoder for render pass
      const renderEncoder = this.device.createCommandEncoder()
      const finalRenderPass = renderEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })

      // Get canvas dimensions for aspect ratio
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

      // Create bind group with blended texture
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: displayTexture.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.viewUniformBuffer } },
        ],
      })

      finalRenderPass.setPipeline(this.pipeline)
      finalRenderPass.setBindGroup(0, bindGroup)
      finalRenderPass.draw(3)
      finalRenderPass.end()

      this.device.queue.submit([renderEncoder.finish()])
      return
    }

    // No grain blend - but check if halation is enabled
    if (this.halationProcessor.isEnabled() && this.halationProcessor.isReady()) {
      // End the render pass temporarily to run halation compute shaders
      renderPass.end()
      this.device.queue.submit([commandEncoder.finish()])

      // Apply halation to the original image
      displayTexture = this.halationProcessor.process(
        displayTexture,
        this.generateMipmaps.bind(this),
      )

      // Create new command encoder for final render pass
      const renderEncoder = this.device.createCommandEncoder()
      const finalRenderPass = renderEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })

      // Get canvas dimensions for aspect ratio
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

      // Create bind group with halation output texture
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: displayTexture.createView() },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: { buffer: this.viewUniformBuffer } },
        ],
      })

      finalRenderPass.setPipeline(this.pipeline)
      finalRenderPass.setBindGroup(0, bindGroup)
      finalRenderPass.draw(3)
      finalRenderPass.end()

      this.device.queue.submit([renderEncoder.finish()])
      return
    }

    // No effects - show original image
    // Get canvas dimensions for aspect ratio
    const canvasTexture = context.getCurrentTexture()
    const canvasWidth = canvasTexture.width
    const canvasHeight = canvasTexture.height

    // Update view uniform buffer
    // ViewParams: zoom, center_x, center_y, aspect_canvas, aspect_image, padding
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
        0, // padding
      ]),
    )

    // Create bind group with current texture and view params
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: displayTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.viewUniformBuffer } },
      ],
    })

    renderPass.setPipeline(this.pipeline)
    renderPass.setBindGroup(0, bindGroup)
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
    if (this.blendOutputTexture) {
      this.blendOutputTexture.destroy()
      this.blendOutputTexture = null
    }
    this.halationProcessor.destroy()
    this.grainGenerator.destroy()
  }
}
