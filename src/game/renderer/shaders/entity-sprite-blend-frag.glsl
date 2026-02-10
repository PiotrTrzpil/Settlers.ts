// Entity sprite blending fragment shader — palettized texture array atlas
// Blends two sprite textures for smooth direction transitions.
// Reads palette indices from R16UI array layers, looks up player-tinted colors.

precision mediump float;
precision highp usampler2DArray;

in vec3 v_texcoord1;       // (u, v, layer) for old direction
in vec3 v_texcoord2;       // (u, v, layer) for new direction
in float v_blend;
flat in float v_playerRow; // palette row (0=neutral, 1+=player)
in vec4 v_tint;            // selection/highlight tint

uniform usampler2DArray u_spriteAtlas;  // R16UI array — palette indices (unsigned int)
uniform sampler2D u_palette;             // RGBA8 multi-row — color lookup table

out vec4 fragColor;

// Resolve a palette index to an RGBA color using the player's palette row
vec4 resolveIndex(uint index) {
    if (index == 0u) return vec4(0.0);                                                   // transparent
    if (index == 1u) return vec4(0.0, 0.0, 0.0, 0.25);                                  // shadow
    return texelFetch(u_palette, ivec2(int(index), int(v_playerRow)), 0);                // palette lookup
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

    // Apply selection/highlight tint
    fragColor = blended * v_tint;
}
