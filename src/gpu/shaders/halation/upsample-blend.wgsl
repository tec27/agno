// Halation upsample and blend compute shader
// Upsamples the blurred halation glow, applies red-shift, and blends with original image

struct HalationParams {
    strength: f32,      // Halation intensity (0-1)
    image_width: f32,   // Output image width
    image_height: f32,  // Output image height
    _padding: f32,
}

// Luminance coefficients (BT.709)
const LUMA_COEFFS = vec3f(0.2126, 0.7152, 0.0722);

@group(0) @binding(0) var input_tex: texture_2d<f32>;          // Original image (or grain-blended)
@group(0) @binding(1) var halation_tex: texture_2d<f32>;       // Blurred halation at 1/4 resolution
@group(0) @binding(2) var halation_sampler: sampler;           // Bilinear sampler for upsampling
@group(0) @binding(3) var output_tex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> params: HalationParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = vec2u(u32(params.image_width), u32(params.image_height));
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    // Load input pixel
    let image = textureLoad(input_tex, gid.xy, 0).rgb;

    // Sample halation at downsampled resolution (bilinear upsample)
    // Use textureSampleLevel with LOD 0 since textureSample isn't allowed in compute shaders
    let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
    let halation_raw = textureSampleLevel(halation_tex, halation_sampler, uv, 0.0);

    // Compute glow luminance from the blurred highlight
    let glow_lum = dot(halation_raw.rgb, LUMA_COEFFS);

    // Create red-shifted halation color (warm film halation look)
    // Red channel gets full luminance, green gets 15%, blue gets none
    let halation_color = vec3f(glow_lum * 1.0, glow_lum * 0.15, 0.0);

    // Additive blend with strength control
    // Using 2.0 multiplier as per implementation plan
    let result = image + halation_color * params.strength * 2.0;

    // Clamp to valid range
    let clamped = clamp(result, vec3f(0.0), vec3f(1.0));

    textureStore(output_tex, gid.xy, vec4f(clamped, 1.0));
}
