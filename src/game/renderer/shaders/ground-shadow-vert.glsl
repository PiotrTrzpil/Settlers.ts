// Ground shadow vertex shader
// Draws elliptical shadow quads at unit feet positions.
// Each vertex carries a world-space position and UV for radial gradient.

in vec2 a_position;  // world-space quad vertex
in vec2 a_uv;        // normalized UV (-1..1) for radial gradient

uniform mat4 projection;

out vec2 v_uv;

void main() {
    gl_Position = projection * vec4(a_position, 0.0, 1.0);
    v_uv = a_uv;
}
