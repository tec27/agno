// Halation threshold compute shader
// Extracts bright areas from the image for halation processing

struct ThresholdParams {
    threshold: f32,     // Brightness cutoff (0-1)
    image_width: f32,   // Input image width
    image_height: f32,  // Input image height
    _padding: f32,
}

// Luminance coefficients (BT.709)
const LUMA_COEFFS = vec3f(0.2126, 0.7152, 0.0722);

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: ThresholdParams;

// Soft threshold with smooth falloff
fn halation_mask(luminance: f32, threshold: f32) -> f32 {
    let falloff = max(0.15, 1.0 - threshold);
    let mask = clamp((luminance - threshold) / falloff, 0.0, 1.0);
    return mask * mask; // Squared for smoother falloff
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = vec2u(u32(params.image_width), u32(params.image_height));
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    // Load input pixel
    let image = textureLoad(input_tex, gid.xy, 0).rgb;

    // Calculate luminance
    let lum = dot(image, LUMA_COEFFS);

    // Apply soft threshold to get highlight mask
    let mask = halation_mask(lum, params.threshold);

    // Extract highlight colors (image * mask)
    let highlight = image * mask;

    textureStore(output_tex, gid.xy, vec4f(highlight, mask));
}
