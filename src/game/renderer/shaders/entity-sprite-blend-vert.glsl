// Entity sprite blending vertex shader
// Renders textured quads with two UV+layer sets for direction transition blending

in vec2 a_position;    // world-space quad vertex position
in vec3 a_texcoord1;   // atlas UV+layer for old direction
in vec3 a_texcoord2;   // atlas UV+layer for new direction
in float a_blend;      // blend factor (0 = old, 1 = new)
in float a_playerRow;  // palette row (0=neutral, 1+=player index+1)
in vec4 a_tint;        // selection/highlight tint (RGBA)

uniform mat4 projection;

out vec3 v_texcoord1;
out vec3 v_texcoord2;
out float v_blend;
flat out float v_playerRow;
out vec4 v_tint;

void main() {
    gl_Position = projection * vec4(a_position, 0.0, 1.0);
    v_texcoord1 = a_texcoord1;
    v_texcoord2 = a_texcoord2;
    v_blend = a_blend;
    v_playerRow = a_playerRow;
    v_tint = a_tint;
}
