// Separable Gaussian blur compute shader
// Can blur horizontally OR vertically based on direction uniform
// Supports per-channel blurring for YCbCr processing

struct BlurParams {
    kernel_radius: i32, // half-size (e.g., 1 for 3x3, 7 for 15x15)
    sigma: f32,
    direction: u32,     // 0 = horizontal, 1 = vertical
    channel: u32,       // 0=R(Y), 1=G(Cb), 2=B(Cr), 3=all
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

    let center = textureLoad(input_tex, gid.xy, 0);
    var sum = vec4f(0.0);
    var weight_sum = 0.0;

    let sigma2 = 2.0 * params.sigma * params.sigma;

    for (var i = -params.kernel_radius; i <= params.kernel_radius; i++) {
        var sample_pos = vec2i(gid.xy);

        if (params.direction == 0u) {
            // Horizontal blur
            sample_pos.x = clamp(sample_pos.x + i, 0, i32(dims.x) - 1);
        } else {
            // Vertical blur
            sample_pos.y = clamp(sample_pos.y + i, 0, i32(dims.y) - 1);
        }

        let w = exp(-f32(i * i) / sigma2);
        let sample_val = textureLoad(input_tex, vec2u(sample_pos), 0);
        sum += sample_val * w;
        weight_sum += w;
    }

    var result = sum / weight_sum;

    // If blurring single channel, preserve other channels from center
    if (params.channel < 3u) {
        var out = center;
        if (params.channel == 0u) {
            out.r = result.r;
        } else if (params.channel == 1u) {
            out.g = result.g;
        } else {
            out.b = result.b;
        }
        result = out;
    }

    textureStore(output_tex, gid.xy, result);
}
