// PCG32 random number generator
// Fast, high-quality, seedable PRNG suitable for GPU compute

fn pcg(state: ptr<function, u32>) -> u32 {
    let old = *state;
    *state = old * 747796405u + 2891336453u;
    let word = ((old >> ((old >> 28u) + 4u)) ^ old) * 277803737u;
    return (word >> 22u) ^ word;
}

fn rand_float(state: ptr<function, u32>) -> f32 {
    return f32(pcg(state)) / 4294967295.0;
}

// Box-Muller transform for Gaussian distribution (mean=0, stddev=1)
fn rand_gaussian(state: ptr<function, u32>) -> f32 {
    let u1 = max(rand_float(state), 1e-10); // avoid log(0)
    let u2 = rand_float(state);
    return sqrt(-2.0 * log(u1)) * cos(6.283185307 * u2);
}

// Deterministic seed from pixel coordinates and frame seed
fn init_seed(pixel: vec2u, frame_seed: u32) -> u32 {
    return pixel.x * 1973u + pixel.y * 9277u + frame_seed * 26699u;
}
