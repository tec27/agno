/**
 * Override @webgpu/types to make navigator.gpu optional
 * (since not all browsers support WebGPU yet)
 */
interface NavigatorGPU {
  readonly gpu: GPU | undefined
}
