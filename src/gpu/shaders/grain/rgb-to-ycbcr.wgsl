// RGB to YCbCr conversion compute shader
// Prepares noise for per-channel blur processing

// RGB to YCbCr (inlined)
fn rgb_to_ycbcr(rgb: vec3f) -> vec3f {
    let y  =  0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    let cb = -0.1146 * rgb.r - 0.3854 * rgb.g + 0.5000 * rgb.b;
    let cr =  0.5000 * rgb.r - 0.4542 * rgb.g - 0.0458 * rgb.b;
    return vec3f(y, cb, cr);
}

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(input_tex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let rgb = textureLoad(input_tex, gid.xy, 0).rgb;
    let ycbcr = rgb_to_ycbcr(rgb);

    textureStore(output_tex, gid.xy, vec4f(ycbcr, 1.0));
}
