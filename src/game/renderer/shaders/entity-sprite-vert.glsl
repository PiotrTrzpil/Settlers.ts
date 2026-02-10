// Entity sprite vertex shader
// Renders textured quads with per-vertex position, UV+layer, player palette row, and tint

in vec2 a_position;      // world-space quad vertex position
in vec3 a_texcoord;      // atlas UV coordinate (u, v, layer)
in float a_playerRow;    // palette row (0=neutral, 1+=player index+1)
in float a_paletteBase;  // base offset into combined palette texture
in vec4 a_tint;          // selection/highlight tint (RGBA)

uniform mat4 projection;

out vec3 v_texcoord;
flat out float v_playerRow;
flat out float v_paletteBase;
out vec4 v_tint;

void main() {
    gl_Position = projection * vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
    v_playerRow = a_playerRow;
    v_paletteBase = a_paletteBase;
    v_tint = a_tint;
}
