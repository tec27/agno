// Halation blur compute shader
// Separable Gaussian blur for halation glow

struct BlurParams {
    kernel_radius: i32, // Half-size of kernel
    sigma: f32,         // Blur sigma
    direction: u32,     // 0 = horizontal, 1 = vertical
    _padding: u32,
}

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: BlurParams;

@compute @workgroup_size(64, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(input_tex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    var sum = vec4f(0.0);
    var weight_sum = 0.0;

    let sigma2 = 2.0 * params.sigma * params.sigma;

    for (var i = -params.kernel_radius; i <= params.kernel_radius; i++) {
        var sample_pos = vec2i(gid.xy);

        if (params.direction == 0u) {
            // Horizontal blur with clamping at edges
            sample_pos.x = clamp(sample_pos.x + i, 0, i32(dims.x) - 1);
        } else {
            // Vertical blur with clamping at edges
            sample_pos.y = clamp(sample_pos.y + i, 0, i32(dims.y) - 1);
        }

        let w = exp(-f32(i * i) / sigma2);
        let sample_val = textureLoad(input_tex, vec2u(sample_pos), 0);
        sum += sample_val * w;
        weight_sum += w;
    }

    textureStore(output_tex, gid.xy, sum / weight_sum);
}
