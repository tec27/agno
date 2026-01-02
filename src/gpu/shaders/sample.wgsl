// Simple texture sampling fragment shader
// Samples from input texture and outputs to screen

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSample(input_texture, input_sampler, uv);
}
