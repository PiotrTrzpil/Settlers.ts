// Entity sprite blending fragment shader
// Blends two sprite textures for smooth direction transitions

precision mediump float;

in vec2 v_texcoord1;
in vec2 v_texcoord2;
in float v_blend;
in vec4 v_tint;

uniform sampler2D u_spriteAtlas;

out vec4 fragColor;

void main() {
    vec4 texel1 = texture(u_spriteAtlas, v_texcoord1);
    vec4 texel2 = texture(u_spriteAtlas, v_texcoord2);

    // Blend the two textures based on transition progress
    vec4 blended = mix(texel1, texel2, v_blend);

    // Discard fully transparent pixels
    if (blended.a < 0.01) discard;

    // Apply player colour tint
    fragColor = blended * v_tint;
}
