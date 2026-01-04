import { useEffect, type RefObject } from 'react'
import type { EffectParams } from '../effectParams'
import type { Renderer } from '../gpu/Renderer'
import type { ViewState } from '../zoom'

/**
 * Syncs effect parameters with the renderer and triggers re-renders.
 * Handles grain params (debounced), blend params, halation params, image upload, and view state.
 */
export function useRendererSync(
  renderer: Renderer,
  params: EffectParams,
  showOriginal: boolean,
  image: ImageBitmap,
  viewState: ViewState,
  canvasContextRef: RefObject<GPUCanvasContext | null>,
): void {
  // Sync view state with renderer and trigger re-render
  useEffect(() => {
    const canvasContext = canvasContextRef.current
    if (!canvasContext) return

    renderer.setViewState(viewState)
    renderer.render(canvasContext)
  }, [renderer, viewState, canvasContextRef])

  // Update grain params and regenerate tiles when grain settings change (debounced)
  useEffect(() => {
    const canvasContext = canvasContextRef.current

    renderer.setGrainParams({
      seed: params.seed,
      grainSize: params.grainSize,
      arLag: 2,
    })

    // Debounce tile generation to avoid overwhelming the GPU while dragging
    const timeoutId = setTimeout(() => {
      renderer
        .updateGrain()
        .then(() => {
          if (canvasContext) {
            renderer.render(canvasContext)
          }
        })
        .catch(console.error)
    }, 60)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [renderer, params.seed, params.grainSize, canvasContextRef])

  // Update blend params when effect settings change
  useEffect(() => {
    const canvasContext = canvasContextRef.current

    renderer.setBlendParams({
      enabled: !showOriginal && (params.grainEnabled || params.filmEnabled),
      strength: params.grainEnabled ? params.grainStrength : 0,
      saturation: params.grainSaturation,
      toe: params.filmEnabled ? params.filmToe : 0,
      midtoneBias: params.filmEnabled ? params.filmMidtoneBias : 1,
    })

    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [
    renderer,
    showOriginal,
    params.grainEnabled,
    params.grainStrength,
    params.grainSaturation,
    params.filmEnabled,
    params.filmToe,
    params.filmMidtoneBias,
    canvasContextRef,
  ])

  // Update halation params when halation settings change
  useEffect(() => {
    const canvasContext = canvasContextRef.current

    renderer.setHalationParams({
      enabled: !showOriginal && params.halationEnabled,
      strength: params.halationStrength,
      threshold: params.halationThreshold,
      radius: params.halationRadius,
      monochrome: params.halationMonochrome,
    })

    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [
    renderer,
    showOriginal,
    params.halationEnabled,
    params.halationStrength,
    params.halationThreshold,
    params.halationRadius,
    params.halationMonochrome,
    canvasContextRef,
  ])

  // Upload image when it changes
  useEffect(() => {
    renderer.uploadImage(image)

    // Trigger a render if canvas context is ready
    const canvasContext = canvasContextRef.current
    if (canvasContext) {
      renderer.render(canvasContext)
    }
  }, [renderer, image, canvasContextRef])
}
