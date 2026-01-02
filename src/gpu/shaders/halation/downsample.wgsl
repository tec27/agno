// Halation downsample compute shader
// 4x downsample using box filter (area average)

@group(0) @binding(0) var input_tex: texture_2d<f32>;
@group(0) @binding(1) var output_tex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dst_size = textureDimensions(output_tex);
    if (gid.x >= dst_size.x || gid.y >= dst_size.y) {
        return;
    }

    // Sample 4x4 block from source and average
    let src_pos = gid.xy * 4u;
    var sum = vec4f(0.0);

    for (var dy = 0u; dy < 4u; dy++) {
        for (var dx = 0u; dx < 4u; dx++) {
            sum += textureLoad(input_tex, src_pos + vec2u(dx, dy), 0);
        }
    }

    textureStore(output_tex, gid.xy, sum / 16.0);
}
