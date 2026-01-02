// Gaussian noise generation compute shader
// Generates 3-channel white noise with normal distribution

// PCG RNG functions (inlined to avoid WGSL module issues)
fn pcg(state: ptr<function, u32>) -> u32 {
    let old = *state;
    *state = old * 747796405u + 2891336453u;
    let word = ((old >> ((old >> 28u) + 4u)) ^ old) * 277803737u;
    return (word >> 22u) ^ word;
}

fn rand_float(state: ptr<function, u32>) -> f32 {
    return f32(pcg(state)) / 4294967295.0;
}

fn rand_gaussian(state: ptr<function, u32>) -> f32 {
    let u1 = max(rand_float(state), 1e-10);
    let u2 = rand_float(state);
    return sqrt(-2.0 * log(u1)) * cos(6.283185307 * u2);
}

fn init_seed(pixel: vec2u, frame_seed: u32) -> u32 {
    return pixel.x * 1973u + pixel.y * 9277u + frame_seed * 26699u;
}

struct NoiseParams {
    seed: u32,
    tile_index: u32,
    tile_size: u32,
    _padding: u32,
}

@group(0) @binding(0) var output_tex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> params: NoiseParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(output_tex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    // Per-tile seed offset (each tile gets unique noise)
    let tile_seed = params.seed + params.tile_index * 1000u;
    var state = init_seed(gid.xy, tile_seed);

    // Generate 3 independent Gaussian random values
    let noise = vec3f(
        rand_gaussian(&state),
        rand_gaussian(&state),
        rand_gaussian(&state)
    );

    textureStore(output_tex, gid.xy, vec4f(noise, 1.0));
}
