// Entity sprite vertex shader
// Renders textured quads with per-vertex position, UV, and tint

in vec2 a_position;    // world-space quad vertex position
in vec2 a_texcoord;    // atlas UV coordinate
in vec4 a_tint;        // player colour tint (RGBA)

uniform mat4 projection;

out vec2 v_texcoord;
out vec4 v_tint;

void main() {
    gl_Position = projection * vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
    v_tint = a_tint;
}
