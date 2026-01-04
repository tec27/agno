export const DEFAULT_PARAMS = {
  seed: Math.floor(Math.random() * 0x80000000),

  grainEnabled: true,
  grainStrength: 0.5,
  grainSize: 1.0,
  grainSaturation: 0.7,

  filmEnabled: true,
  filmToe: 0.0,
  filmMidtoneBias: 1.0,

  halationEnabled: false,
  halationStrength: 0.3,
  halationThreshold: 0.8,
  halationRadius: 20,
  halationMonochrome: false,
}

export type EffectParams = typeof DEFAULT_PARAMS
