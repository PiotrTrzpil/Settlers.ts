// Entity vertex shader
// Draws colored quads at entity world positions

in vec2 a_position;   // quad vertex (-0.5..0.5)
in vec2 a_entityPos;  // world position of entity center
in vec4 a_color;      // entity color (RGBA)

uniform mat4 projection;

out vec4 v_color;

void main() {
    // Scale the quad to entity size
    vec2 pos = a_position * 0.4 + a_entityPos;

    gl_Position = projection * vec4(pos.x, pos.y, 0.0, 1.0);
    v_color = a_color;
}
