// Entity sprite fragment shader
// Samples sprite atlas texture and applies player colour tinting

precision mediump float;

in vec2 v_texcoord;
in vec4 v_tint;

uniform sampler2D u_spriteAtlas;

out vec4 fragColor;

void main() {
    vec4 texel = texture(u_spriteAtlas, v_texcoord);

    // Discard fully transparent pixels (sprite background)
    if (texel.a < 0.01) discard;

    // Apply player colour tint
    // Tint is multiplied with the sprite colour; white tint = no change.
    fragColor = texel * v_tint;
}
