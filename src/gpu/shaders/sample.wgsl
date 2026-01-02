// Texture sampling fragment shader with zoom/pan support
// Samples from input texture with view transform applied

struct ViewParams {
    // Transform: scaled_uv = (uv - 0.5) / zoom + center
    zoom: f32,          // 1.0 = fit, >1 = zoom in
    center_x: f32,      // 0.5 = centered
    center_y: f32,
    aspect_canvas: f32, // canvas width / height
    aspect_image: f32,  // image width / height
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
    // Total: 8 floats × 4 bytes = 32 bytes (no alignment gaps)
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var input_sampler: sampler;
@group(0) @binding(2) var<uniform> view: ViewParams;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    // Adjust for aspect ratio: fit image within canvas
    var image_uv = uv;

    // Scale to maintain aspect ratio (letterbox/pillarbox)
    let scale_factor = select(
        view.aspect_canvas / view.aspect_image, // image is taller, pillarbox
        1.0,                                     // image is wider, letterbox
        view.aspect_image > view.aspect_canvas
    );
    let scale_y = select(
        1.0,
        view.aspect_image / view.aspect_canvas,
        view.aspect_image > view.aspect_canvas
    );

    // Apply aspect correction
    image_uv = (image_uv - 0.5) * vec2f(scale_factor, scale_y) + 0.5;

    // Apply zoom and pan
    image_uv = (image_uv - 0.5) / view.zoom + vec2f(view.center_x, view.center_y);

    // Clamp UVs for sampling (textureSample requires uniform control flow)
    let clamped_uv = clamp(image_uv, vec2f(0.0), vec2f(1.0));

    // Always sample first (can't be inside conditional)
    let color = textureSample(input_texture, input_sampler, clamped_uv);

    // Check bounds - show dark gray outside image
    let in_bounds = image_uv.x >= 0.0 && image_uv.x <= 1.0 &&
                    image_uv.y >= 0.0 && image_uv.y <= 1.0;

    return select(vec4f(0.1, 0.1, 0.1, 1.0), color, in_bounds);
}
