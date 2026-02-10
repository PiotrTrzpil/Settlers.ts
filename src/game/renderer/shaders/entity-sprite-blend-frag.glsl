// Entity sprite blending fragment shader — palettized texture array atlas
// Blends two sprite textures for smooth direction transitions.
// Reads palette indices from R16UI array layers, looks up player-tinted colors.

precision mediump float;
precision highp usampler2DArray;

in vec3 v_texcoord1;        // (u, v, layer) for old direction
in vec3 v_texcoord2;        // (u, v, layer) for new direction
in float v_blend;
flat in float v_playerRow;  // palette row (0=neutral, 1+=player)
flat in float v_paletteBase; // base offset into combined palette texture
in vec4 v_tint;             // selection/highlight tint

uniform usampler2DArray u_spriteAtlas;  // R16UI array — palette indices (unsigned int)
uniform sampler2D u_palette;             // RGBA8 2D — color lookup table
uniform int u_paletteWidth;              // Palette texture width (e.g., 2048)
uniform int u_paletteRowsPerPlayer;      // Texture rows per player section

out vec4 fragColor;

// Resolve a palette index to an RGBA color using the player's palette row
vec4 resolveIndex(uint index) {
    if (index == 0u) return vec4(0.0);                                                   // transparent
    if (index == 1u) return vec4(0.0, 0.0, 0.0, 0.25);                                  // shadow
    // Add per-sprite palette base offset, then convert to 2D coordinates
    int linearIndex = int(index) + int(v_paletteBase);
    int localX = linearIndex % u_paletteWidth;
    int localY = linearIndex / u_paletteWidth;
    int finalY = int(v_playerRow) * u_paletteRowsPerPlayer + localY;
    return texelFetch(u_palette, ivec2(localX, finalY), 0);
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
