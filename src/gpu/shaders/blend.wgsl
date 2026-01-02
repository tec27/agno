// Grain blend compute shader
// Applies film grain to input image with luminance response, saturation, and toe

struct BlendParams {
    strength: f32,      // Overall grain intensity (0-5)
    saturation: f32,    // Color vs mono grain (0-2)
    toe: f32,           // Black point lift (-0.2-0.5)
    midtone_bias: f32,  // Luminance curve shape (0-2)
    grain_size: f32,    // Visual grain scale (0.5-4, higher = larger grain)
    image_width: f32,   // Input image width
    image_height: f32,  // Input image height
    seed: u32,          // Random seed for patchwork
}

// Channel scales - matches real film where blue layer has coarsest grain
const CHANNEL_SCALES = vec3f(1.2, 1.0, 1.5);

// Luminance coefficients (BT.709)
const LUMA_COEFFS = vec3f(0.2126, 0.7152, 0.0722);

// Tile size is always 256 (fixed in GrainGenerator)
const TILE_SIZE: f32 = 256.0;

// Region size for patchwork (2x tile for variety)
const REGION_SIZE: f32 = 512.0;

// Blend size in image pixels - how much overlap for smooth seams
const BLEND_PIXELS: f32 = 64.0;

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var grain_tiles: texture_2d_array<f32>;
@group(0) @binding(2) var grain_sampler: sampler;
@group(0) @binding(3) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> params: BlendParams;

// Simple hash for patchwork tiling
fn hash(seed: u32, x: i32, y: i32) -> u32 {
    var h = seed;
    h = h ^ (u32(x + 10000) * 1973u);
    h = h ^ (u32(y + 10000) * 9277u);
    h = h * 2654435761u;
    h = h ^ (h >> 16u);
    return h;
}

// Sample grain from a specific region
fn sample_region_grain(scaled_pos: vec2f, region_x: i32, region_y: i32) -> vec3f {
    // Hash to get tile index (0-7)
    let tile_index = hash(params.seed, region_x, region_y) % 8u;

    // Hash to get random offset within tile
    let offset_hash = hash(params.seed + 1u, region_x, region_y);
    let offset_x = f32(offset_hash & 0xFFu) / 255.0 * TILE_SIZE;
    let offset_y = f32((offset_hash >> 8u) & 0xFFu) / 255.0 * TILE_SIZE;

    // Position relative to region origin, plus random offset
    let region_origin = vec2f(f32(region_x), f32(region_y)) * REGION_SIZE;
    let local_pos = scaled_pos - region_origin + vec2f(offset_x, offset_y);

    // Wrap within tile and convert to UV
    let wrapped = ((local_pos % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    let uv = (wrapped + 0.5) / TILE_SIZE;

    return textureSampleLevel(grain_tiles, grain_sampler, uv, i32(tile_index), 0.0).rgb;
}

// Smooth blend weight using smoothstep
fn blend_weight(scaled_pos: vec2f, region_x: i32, region_y: i32, blend_size: f32) -> f32 {
    let region_center = vec2f(f32(region_x) + 0.5, f32(region_y) + 0.5) * REGION_SIZE;
    let half_size = REGION_SIZE * 0.5 + blend_size;

    let d = abs(scaled_pos - region_center);
    let edge_x = half_size - d.x;
    let edge_y = half_size - d.y;

    return smoothstep(0.0, blend_size, edge_x) * smoothstep(0.0, blend_size, edge_y);
}

// Sample grain with patchwork tiling and boundary blending
fn sample_grain_patchwork(pixel_pos: vec2f) -> vec3f {
    // Scale position by grain_size
    // Larger grain_size = sample more sparsely = grain appears larger
    let scaled_pos = pixel_pos / params.grain_size;

    // Blend size also scales with grain_size so seams stay hidden
    let blend_size = BLEND_PIXELS / params.grain_size;

    // Find which region this pixel is in
    let region_x = i32(floor(scaled_pos.x / REGION_SIZE));
    let region_y = i32(floor(scaled_pos.y / REGION_SIZE));

    var accumulated_grain = vec3f(0.0);
    var accumulated_weight = 0.0;

    // Sample from overlapping regions (3x3 neighborhood)
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let rx = region_x + dx;
            let ry = region_y + dy;

            let weight = blend_weight(scaled_pos, rx, ry, blend_size);

            if (weight > 0.001) {
                let grain = sample_region_grain(scaled_pos, rx, ry);
                accumulated_grain += grain * weight;
                accumulated_weight += weight;
            }
        }
    }

    // Normalize by total weight
    if (accumulated_weight > 0.0) {
        return accumulated_grain / accumulated_weight;
    }
    return vec3f(0.5); // Neutral grain if no samples
}

// Luminance response curve - midtone emphasis
fn luminance_response(lum: f32, bias: f32) -> f32 {
    let base = 4.0 * lum * (1.0 - lum);
    let clamped = clamp(base, 0.0, 1.0);
    return pow(clamped, 1.0 / max(bias, 0.001));
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = vec2u(u32(params.image_width), u32(params.image_height));
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    // Load input image pixel
    let image = textureLoad(input_tex, gid.xy, 0).rgb;

    // Sample grain with patchwork tiling (0.5-centered, so 0.5 = no grain)
    let grain_raw = sample_grain_patchwork(vec2f(gid.xy));

    // Transform grain: 0.5-centered -> 1.0-centered multiplier
    let grain_deviation = (grain_raw - 0.5) * params.strength * 0.5 * CHANNEL_SCALES;
    var grain = 1.0 + grain_deviation;

    // Apply saturation - blend toward grayscale grain
    let gray_grain = vec3f(grain.g);
    grain = mix(gray_grain, grain, params.saturation);

    // Calculate luminance for response curve
    let lum = dot(image, LUMA_COEFFS);

    // Apply luminance response (midtone emphasis)
    let response = luminance_response(lum, params.midtone_bias);

    // Modulate grain by response - less grain in shadows/highlights
    let grain_final = 1.0 + (grain - 1.0) * response;

    // Multiplicative blend with toe lift
    let blended = (1.0 - (1.0 - image) * grain_final) * (1.0 - params.toe) + params.toe;

    // Clamp to valid range
    let result = clamp(blended, vec3f(0.0), vec3f(1.0));

    textureStore(output_tex, gid.xy, vec4f(result, 1.0));
}
