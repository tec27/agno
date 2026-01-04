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

// Get offset for a region (used for smooth interpolation)
fn get_region_offset(rx: i32, ry: i32) -> vec2f {
    let offset_hash = hash(params.seed + 1u, rx, ry);
    let offset_x = f32(offset_hash & 0xFFu) / 255.0 * TILE_SIZE;
    let offset_y = f32((offset_hash >> 8u) & 0xFFu) / 255.0 * TILE_SIZE;
    return vec2f(offset_x, offset_y);
}

// Sample grain with smooth offset interpolation at boundaries
// Key insight: we keep the SAME tile but smoothly blend the random OFFSET
// between neighboring regions. This avoids blurring grain structure while
// creating seamless transitions.
fn sample_grain_patchwork(pixel_pos: vec2f) -> vec3f {
    // Scale position by grain_size
    let scaled_pos = pixel_pos / params.grain_size;

    // Find which region this pixel is in
    let region_fx = scaled_pos.x / REGION_SIZE;
    let region_fy = scaled_pos.y / REGION_SIZE;
    let region_x = i32(floor(region_fx));
    let region_y = i32(floor(region_fy));

    // Get position within region (0-1)
    let frac_x = fract(region_fx);
    let frac_y = fract(region_fy);

    // Create smooth blend weights for bilinear interpolation of offsets
    // Use a cubic hermite (smoothstep) for smoother transitions
    let tx = smoothstep(0.0, 1.0, frac_x);
    let ty = smoothstep(0.0, 1.0, frac_y);

    // Get offsets from all 4 corner regions
    let offset_00 = get_region_offset(region_x, region_y);
    let offset_10 = get_region_offset(region_x + 1, region_y);
    let offset_01 = get_region_offset(region_x, region_y + 1);
    let offset_11 = get_region_offset(region_x + 1, region_y + 1);

    // Bilinearly interpolate the offset
    let offset_x0 = mix(offset_00, offset_10, tx);
    let offset_x1 = mix(offset_01, offset_11, tx);
    let offset = mix(offset_x0, offset_x1, ty);

    // Use a single tile per large area (based on a coarser grid)
    // This ensures we're sampling from the same grain texture across the blend
    let coarse_x = i32(floor(scaled_pos.x / (REGION_SIZE * 2.0)));
    let coarse_y = i32(floor(scaled_pos.y / (REGION_SIZE * 2.0)));
    let tile_index = hash(params.seed, coarse_x, coarse_y) % 8u;

    // Sample the grain tile with interpolated offset
    let pos_with_offset = scaled_pos + offset;
    let wrapped = ((pos_with_offset % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
    let uv = (wrapped + 0.5) / TILE_SIZE;

    return textureSampleLevel(grain_tiles, grain_sampler, uv, i32(tile_index), 0.0).rgb;
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
