import type { GpuContext } from './context'

// Shader imports
import arFilterShader from './shaders/grain/ar-filter.wgsl?raw'
import blurShader from './shaders/grain/blur.wgsl?raw'
import noiseShader from './shaders/grain/noise.wgsl?raw'
import normalizeShader from './shaders/grain/normalize.wgsl?raw'
import rgbToYcbcrShader from './shaders/grain/rgb-to-ycbcr.wgsl?raw'

export interface GrainParams {
  seed: number
  grainSize: number
  arLag: number
}

const TILE_COUNT = 8
const BASE_TILE_SIZE = 256

/**
 * Get blur specs for grain processing.
 * Fixed kernel sizes for consistent grain character.
 * grainSize is handled at sampling time, not generation time.
 */
function getBlurSpecs(): { kernelRadius: number; sigma: number }[] {
  // Y channel: fine luminance grain (3x3, sigma=0.8)
  const ySpec = { kernelRadius: 1, sigma: 0.8 }

  // Cb channel: smooth blue-yellow (15x15, sigma=3.75)
  const cbSpec = { kernelRadius: 7, sigma: 3.75 }

  // Cr channel: smooth red-green (11x11, sigma=2.75)
  const crSpec = { kernelRadius: 5, sigma: 2.75 }

  return [ySpec, cbSpec, crSpec]
}

export class GrainGenerator {
  private device: GPUDevice

  // Textures
  private grainTileArray: GPUTexture | null = null
  private workTexture1: GPUTexture | null = null
  private workTexture2: GPUTexture | null = null

  // Pipelines
  private noisePipeline: GPUComputePipeline
  private arFilterPipeline: GPUComputePipeline
  private rgbToYcbcrPipeline: GPUComputePipeline
  private blurPipeline: GPUComputePipeline
  private normalizePipeline: GPUComputePipeline

  // Bind group layouts
  private noiseBindGroupLayout: GPUBindGroupLayout
  private arFilterBindGroupLayout: GPUBindGroupLayout
  private rgbToYcbcrBindGroupLayout: GPUBindGroupLayout
  private blurBindGroupLayout: GPUBindGroupLayout
  private normalizeBindGroupLayout: GPUBindGroupLayout

  // Uniform buffers
  private noiseUniformBuffer: GPUBuffer
  private arUniformBuffer: GPUBuffer
  private blurUniformBuffer: GPUBuffer
  private normalizeUniformBuffer: GPUBuffer

  // Cached state
  private currentTileSize = 0
  private lastParams: GrainParams | null = null

  constructor(ctx: GpuContext) {
    this.device = ctx.device

    // Create bind group layouts
    this.noiseBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    })

    this.arFilterBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    })

    this.rgbToYcbcrBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
      ],
    })

    this.blurBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: 'rgba16float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    })

    this.normalizeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba16float',
            viewDimension: '2d-array',
          },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
    })

    // Create pipelines
    this.noisePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.noiseBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: noiseShader }),
        entryPoint: 'main',
      },
    })

    this.arFilterPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.arFilterBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: arFilterShader }),
        entryPoint: 'main',
      },
    })

    this.rgbToYcbcrPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.rgbToYcbcrBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: rgbToYcbcrShader }),
        entryPoint: 'main',
      },
    })

    this.blurPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.blurBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: blurShader }),
        entryPoint: 'main',
      },
    })

    this.normalizePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.normalizeBindGroupLayout],
      }),
      compute: {
        module: this.device.createShaderModule({ code: normalizeShader }),
        entryPoint: 'main',
      },
    })

    // Create uniform buffers (16 bytes each, aligned)
    this.noiseUniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.arUniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.blurUniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.normalizeUniformBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Check if current tiles are still valid for given params
   * Note: grainSize is NOT checked - it only affects sampling, not tile generation
   */
  private tilesValid(params: GrainParams): boolean {
    if (!this.grainTileArray || !this.lastParams) {
      return false
    }
    return this.lastParams.seed === params.seed && this.lastParams.arLag === params.arLag
  }

  /**
   * Ensure work textures exist at correct size
   */
  private ensureTextures(tileSize: number): void {
    if (this.currentTileSize === tileSize) {
      return
    }

    // Destroy old textures
    this.workTexture1?.destroy()
    this.workTexture2?.destroy()
    this.grainTileArray?.destroy()

    // Create work textures (ping-pong)
    const workTextureDesc: GPUTextureDescriptor = {
      size: { width: tileSize, height: tileSize },
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    }

    this.workTexture1 = this.device.createTexture(workTextureDesc)
    this.workTexture2 = this.device.createTexture(workTextureDesc)

    // Create grain tile array
    this.grainTileArray = this.device.createTexture({
      size: { width: tileSize, height: tileSize, depthOrArrayLayers: TILE_COUNT },
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })

    this.currentTileSize = tileSize
  }

  /**
   * Generate all 8 grain tiles
   * Tiles are always 256x256 - grainSize only affects sampling in blend shader
   */
  async generateTiles(params: GrainParams): Promise<GPUTexture> {
    // Check cache
    if (this.tilesValid(params) && this.grainTileArray) {
      return this.grainTileArray
    }

    const tileSize = BASE_TILE_SIZE // Always 256x256
    this.ensureTextures(tileSize)

    // After ensureTextures, these are guaranteed to exist
    const workTex1 = this.workTexture1
    const workTex2 = this.workTexture2
    const tileArray = this.grainTileArray
    if (!workTex1 || !workTex2 || !tileArray) {
      throw new Error('Failed to create grain textures')
    }

    // Generate each tile
    for (let i = 0; i < TILE_COUNT; i++) {
      this.generateSingleTile(i, params, tileSize, workTex1, workTex2, tileArray)
    }

    // Wait for all work to complete
    await this.device.queue.onSubmittedWorkDone()

    this.lastParams = { ...params }
    return tileArray
  }

  /**
   * Generate a single grain tile
   */
  private generateSingleTile(
    tileIndex: number,
    params: GrainParams,
    tileSize: number,
    workTexture1: GPUTexture,
    workTexture2: GPUTexture,
    grainTileArray: GPUTexture,
  ): void {
    const commandEncoder = this.device.createCommandEncoder()
    const workgroupsXY = Math.ceil(tileSize / 16)
    const workgroupsBlur = { x: Math.ceil(tileSize / 64), y: Math.ceil(tileSize / 4) }

    // Pass 1: Generate noise -> workTexture1
    this.device.queue.writeBuffer(
      this.noiseUniformBuffer,
      0,
      new Uint32Array([params.seed, tileIndex, tileSize, 0]),
    )

    const noiseBindGroup = this.device.createBindGroup({
      layout: this.noiseBindGroupLayout,
      entries: [
        { binding: 0, resource: workTexture1.createView() },
        { binding: 1, resource: { buffer: this.noiseUniformBuffer } },
      ],
    })

    const noisePass = commandEncoder.beginComputePass()
    noisePass.setPipeline(this.noisePipeline)
    noisePass.setBindGroup(0, noiseBindGroup)
    noisePass.dispatchWorkgroups(workgroupsXY, workgroupsXY)
    noisePass.end()

    // Pass 2: AR filter -> workTexture2
    this.device.queue.writeBuffer(
      this.arUniformBuffer,
      0,
      new Float32Array([0.95]), // ar_strength
    )
    this.device.queue.writeBuffer(this.arUniformBuffer, 4, new Uint32Array([params.arLag, 0, 0]))

    const arBindGroup = this.device.createBindGroup({
      layout: this.arFilterBindGroupLayout,
      entries: [
        { binding: 0, resource: workTexture1.createView() },
        { binding: 1, resource: workTexture2.createView() },
        { binding: 2, resource: { buffer: this.arUniformBuffer } },
      ],
    })

    const arPass = commandEncoder.beginComputePass()
    arPass.setPipeline(this.arFilterPipeline)
    arPass.setBindGroup(0, arBindGroup)
    arPass.dispatchWorkgroups(workgroupsXY, workgroupsXY)
    arPass.end()

    // Pass 3: RGB to YCbCr -> workTexture1
    const rgbToYcbcrBindGroup = this.device.createBindGroup({
      layout: this.rgbToYcbcrBindGroupLayout,
      entries: [
        { binding: 0, resource: workTexture2.createView() },
        { binding: 1, resource: workTexture1.createView() },
      ],
    })

    const rgbToYcbcrPass = commandEncoder.beginComputePass()
    rgbToYcbcrPass.setPipeline(this.rgbToYcbcrPipeline)
    rgbToYcbcrPass.setBindGroup(0, rgbToYcbcrBindGroup)
    rgbToYcbcrPass.dispatchWorkgroups(workgroupsXY, workgroupsXY)
    rgbToYcbcrPass.end()

    // Passes 4-9: Per-channel blur (Y, Cb, Cr) - each needs H then V
    // Current state: YCbCr in workTexture1
    let currentInput = workTexture1
    let currentOutput = workTexture2

    // Get blur specs scaled for this tile size
    const blurSpecs = getBlurSpecs()

    for (let channel = 0; channel < 3; channel++) {
      const spec = blurSpecs[channel]

      // Horizontal pass
      this.device.queue.writeBuffer(this.blurUniformBuffer, 0, new Int32Array([spec.kernelRadius]))
      this.device.queue.writeBuffer(this.blurUniformBuffer, 4, new Float32Array([spec.sigma]))
      this.device.queue.writeBuffer(
        this.blurUniformBuffer,
        8,
        new Uint32Array([0, channel]), // direction=0 (H), channel
      )

      const blurHBindGroup = this.device.createBindGroup({
        layout: this.blurBindGroupLayout,
        entries: [
          { binding: 0, resource: currentInput.createView() },
          { binding: 1, resource: currentOutput.createView() },
          { binding: 2, resource: { buffer: this.blurUniformBuffer } },
        ],
      })

      const blurHPass = commandEncoder.beginComputePass()
      blurHPass.setPipeline(this.blurPipeline)
      blurHPass.setBindGroup(0, blurHBindGroup)
      blurHPass.dispatchWorkgroups(workgroupsBlur.x, workgroupsBlur.y)
      blurHPass.end()

      // Swap for vertical pass
      ;[currentInput, currentOutput] = [currentOutput, currentInput]

      // Vertical pass
      this.device.queue.writeBuffer(
        this.blurUniformBuffer,
        8,
        new Uint32Array([1, channel]), // direction=1 (V), channel
      )

      const blurVBindGroup = this.device.createBindGroup({
        layout: this.blurBindGroupLayout,
        entries: [
          { binding: 0, resource: currentInput.createView() },
          { binding: 1, resource: currentOutput.createView() },
          { binding: 2, resource: { buffer: this.blurUniformBuffer } },
        ],
      })

      const blurVPass = commandEncoder.beginComputePass()
      blurVPass.setPipeline(this.blurPipeline)
      blurVPass.setBindGroup(0, blurVBindGroup)
      blurVPass.dispatchWorkgroups(workgroupsBlur.x, workgroupsBlur.y)
      blurVPass.end()

      // Swap for next channel (or final pass)
      ;[currentInput, currentOutput] = [currentOutput, currentInput]
    }

    // Pass 10: Normalize + YCbCr to RGB -> grainTileArray[tileIndex]
    this.device.queue.writeBuffer(
      this.normalizeUniformBuffer,
      0,
      new Float32Array([0.15]), // scale
    )
    this.device.queue.writeBuffer(
      this.normalizeUniformBuffer,
      4,
      new Uint32Array([tileIndex, 0, 0]),
    )

    const normalizeBindGroup = this.device.createBindGroup({
      layout: this.normalizeBindGroupLayout,
      entries: [
        { binding: 0, resource: currentInput.createView() },
        {
          binding: 1,
          resource: grainTileArray.createView({ dimension: '2d-array' }),
        },
        { binding: 2, resource: { buffer: this.normalizeUniformBuffer } },
      ],
    })

    const normalizePass = commandEncoder.beginComputePass()
    normalizePass.setPipeline(this.normalizePipeline)
    normalizePass.setBindGroup(0, normalizeBindGroup)
    normalizePass.dispatchWorkgroups(workgroupsXY, workgroupsXY)
    normalizePass.end()

    this.device.queue.submit([commandEncoder.finish()])
  }

  /**
   * Get the grain tile array texture
   */
  getTileArray(): GPUTexture | null {
    return this.grainTileArray
  }

  /**
   * Clean up GPU resources
   */
  destroy(): void {
    this.workTexture1?.destroy()
    this.workTexture2?.destroy()
    this.grainTileArray?.destroy()
    this.noiseUniformBuffer.destroy()
    this.arUniformBuffer.destroy()
    this.blurUniformBuffer.destroy()
    this.normalizeUniformBuffer.destroy()

    this.workTexture1 = null
    this.workTexture2 = null
    this.grainTileArray = null
  }
}
