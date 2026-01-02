// Fullscreen triangle vertex shader
// Uses vertex_index to generate a triangle that covers the entire screen
// More efficient than a quad (3 vertices instead of 6)

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    // Generate fullscreen triangle vertices
    // Vertex 0: (-1, -1), Vertex 1: (3, -1), Vertex 2: (-1, 3)
    // This single triangle covers the entire clip space [-1, 1] x [-1, 1]
    var out: VertexOutput;

    let x = f32(i32(vertex_index & 1u) * 4 - 1);
    let y = f32(i32(vertex_index >> 1u) * 4 - 1);

    out.position = vec4f(x, y, 0.0, 1.0);
    // UV coordinates: (0,0) at top-left, (1,1) at bottom-right
    out.uv = vec2f((x + 1.0) * 0.5, (1.0 - y) * 0.5);

    return out;
}
