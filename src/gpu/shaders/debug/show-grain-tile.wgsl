// Debug shader: displays a grain tile at 1:1 pixel size, centered
// Used to verify grain generation is working

struct DebugParams {
    tile_index: u32,
    tile_size: f32,
    canvas_width: f32,
    canvas_height: f32,
}

@group(0) @binding(0) var grain_tiles: texture_2d_array<f32>;
@group(0) @binding(1) var tile_sampler: sampler;
@group(0) @binding(2) var<uniform> params: DebugParams;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Convert UV (0-1) to pixel coordinates
    let pixel = in.uv * vec2f(params.canvas_width, params.canvas_height);

    // Center the tile on the canvas
    let tile_size = params.tile_size;
    let offset = vec2f(
        (params.canvas_width - tile_size) * 0.5,
        (params.canvas_height - tile_size) * 0.5,
    );

    // Compute tile UV (clamp for sampling - textureSample requires uniform control flow)
    let tile_pixel = pixel - offset;
    let tile_uv = clamp(tile_pixel / tile_size, vec2f(0.0), vec2f(1.0));

    // Always sample first (can't be inside conditional)
    let grain = textureSample(grain_tiles, tile_sampler, tile_uv, params.tile_index).rgb;

    // Check if pixel is within the tile bounds
    let in_bounds = tile_pixel.x >= 0.0 && tile_pixel.x < tile_size &&
                    tile_pixel.y >= 0.0 && tile_pixel.y < tile_size;

    // Show grain inside bounds, dark background outside
    let color = select(vec3f(0.1), grain, in_bounds);

    return vec4f(color, 1.0);
}
