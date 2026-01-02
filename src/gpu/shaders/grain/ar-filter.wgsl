// Autoregressive filter for spatial correlation
// Creates realistic film grain clumping by correlating nearby pixels

struct ARParams {
    ar_strength: f32, // 0.95 typical
    ar_lag: u32,      // 2 = 5x5 kernel
    _padding: vec2u,
}

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: ARParams;

// Compute AR weight for a given offset
// Only causal positions get non-zero weights (raster scan order)
fn get_ar_weight(dx: i32, dy: i32, ar_lag: i32) -> f32 {
    // Check bounds
    if (abs(dx) > ar_lag || abs(dy) > ar_lag) {
        return 0.0;
    }

    // Only causal positions: above current row, or same row left of center
    if (dy > 0) {
        return 0.0;
    }
    if (dy == 0 && dx >= 0) {
        return 0.0; // center and right excluded
    }

    // Exponential decay based on Euclidean distance
    let dist = sqrt(f32(dx * dx + dy * dy));
    return pow(0.7, dist);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(input_tex);
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let ar_lag = i32(params.ar_lag);
    var sum = vec3f(0.0);
    var weight_sum = 0.0;

    // Compute weighted sum of causal neighbors
    for (var dy = -ar_lag; dy <= ar_lag; dy++) {
        for (var dx = -ar_lag; dx <= ar_lag; dx++) {
            let w = get_ar_weight(dx, dy, ar_lag);
            if (w > 0.0) {
                let sx = clamp(i32(gid.x) + dx, 0, i32(dims.x) - 1);
                let sy = clamp(i32(gid.y) + dy, 0, i32(dims.y) - 1);
                sum += textureLoad(input_tex, vec2u(u32(sx), u32(sy)), 0).rgb * w;
                weight_sum += w;
            }
        }
    }

    // Normalize AR component to ar_strength
    let ar_component = sum * (params.ar_strength / max(weight_sum, 0.001));

    // Add innovation noise (the original pixel value, scaled)
    let innovation = textureLoad(input_tex, gid.xy, 0).rgb;
    let innovation_scale = sqrt(1.0 - params.ar_strength * params.ar_strength);

    let result = ar_component + innovation * innovation_scale;
    textureStore(output_tex, gid.xy, vec4f(result, 1.0));
}
