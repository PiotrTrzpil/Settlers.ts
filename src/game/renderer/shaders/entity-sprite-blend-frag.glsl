// Entity sprite blending fragment shader — palettized atlas
// Blends two sprite textures for smooth direction transitions.
// Reads palette indices from R16UI atlas, looks up colors in palette texture.

precision mediump float;
precision highp usampler2D;

in vec2 v_texcoord1;
in vec2 v_texcoord2;
in float v_blend;
in vec4 v_tint;

uniform usampler2D u_spriteAtlas;  // R16UI — palette indices (unsigned int)
uniform sampler2D u_palette;        // RGBA8 — color lookup table

out vec4 fragColor;

// Resolve a palette index to an RGBA color
vec4 resolveIndex(uint index) {
    if (index == 0u) return vec4(0.0);                        // transparent
    if (index == 1u) return vec4(0.0, 0.0, 0.0, 0.25);       // shadow
    return texelFetch(u_palette, ivec2(int(index), 0), 0);    // palette lookup
}

void main() {
    uint index1 = texture(u_spriteAtlas, v_texcoord1).r;
    uint index2 = texture(u_spriteAtlas, v_texcoord2).r;

    vec4 color1 = resolveIndex(index1);
    vec4 color2 = resolveIndex(index2);

    // Blend the two colors based on transition progress
    vec4 blended = mix(color1, color2, v_blend);

    // Discard fully transparent pixels
    if (blended.a < 0.01) discard;

    // Apply player colour tint
    fragColor = blended * v_tint;
}
