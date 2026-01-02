// Final normalization shader
// Converts YCbCr back to RGB and normalizes to 0-1 range centered at 0.5

// YCbCr to RGB (inlined)
fn ycbcr_to_rgb(ycbcr: vec3f) -> vec3f {
    let y  = ycbcr.x;
    let cb = ycbcr.y;
    let cr = ycbcr.z;
    let r = y + 1.5748 * cr;
    let g = y - 0.1873 * cb - 0.4681 * cr;
    let b = y + 1.8556 * cb;
    return vec3f(r, g, b);
}

struct NormalizeParams {
    scale: f32,      // 0.15 in original
    tile_index: u32, // which tile in the array to write to
    _padding: vec2u,
}

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: NormalizeParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(output_tex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let ycbcr = textureLoad(input_tex, gid.xy, 0).rgb;
    let rgb = ycbcr_to_rgb(ycbcr);

    // Normalize to 0-1 centered at 0.5
    // Original values are Gaussian with stddev ~1, so * 0.15 maps most values to [-0.45, 0.45]
    // Adding 0.5 centers around mid-gray
    let normalized = clamp(rgb * params.scale + 0.5, vec3f(0.0), vec3f(1.0));

    textureStore(output_tex, gid.xy, params.tile_index, vec4f(normalized, 1.0));
}
