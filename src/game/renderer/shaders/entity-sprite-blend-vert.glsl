// Entity sprite blending vertex shader
// Renders textured quads with two UV sets for direction transition blending

in vec2 a_position;    // world-space quad vertex position
in vec2 a_texcoord1;   // atlas UV for old direction
in vec2 a_texcoord2;   // atlas UV for new direction
in float a_blend;      // blend factor (0 = old, 1 = new)
in vec4 a_tint;        // player colour tint (RGBA)

uniform mat4 projection;

out vec2 v_texcoord1;
out vec2 v_texcoord2;
out float v_blend;
out vec4 v_tint;

void main() {
    gl_Position = projection * vec4(a_position, 0.0, 1.0);
    v_texcoord1 = a_texcoord1;
    v_texcoord2 = a_texcoord2;
    v_blend = a_blend;
    v_tint = a_tint;
}
