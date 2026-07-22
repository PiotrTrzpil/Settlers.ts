// Entity sprite blending fragment shader — palettized texture array atlas
// Blends two sprite textures for smooth direction transitions.
// Reads palette indices from R16UI array layers, looks up player-tinted colors.

precision mediump float;
precision highp usampler2DArray;

in vec3 v_texcoord1;        // (u, v, globalLayer) for old direction
in vec3 v_texcoord2;        // (u, v, globalLayer) for new direction
in float v_blend;
flat in float v_playerRow;  // palette row (0=neutral, 1+=player)
flat in float v_paletteBase; // base offset into combined palette texture
in vec4 v_tint;             // selection/highlight tint

uniform usampler2DArray u_spriteAtlas0;
uniform usampler2DArray u_spriteAtlas1;
uniform usampler2DArray u_spriteAtlas2;
uniform usampler2DArray u_spriteAtlas3;
uniform int u_layersPerArray;
uniform sampler2D u_palette;             // RGBA8 2D — color lookup table
uniform int u_paletteWidth;              // Palette texture width (e.g., 2048)
uniform int u_paletteRowsPerPlayer;      // Texture rows per player section

out vec4 fragColor;

uint sampleAtlas(vec2 uv, float globalLayer) {
    int per = max(u_layersPerArray, 1);
    int arrayIdx = int(globalLayer) / per;
    float localLayer = mod(globalLayer, float(per));
    vec3 coord = vec3(uv, localLayer);
    if (arrayIdx <= 0) return texture(u_spriteAtlas0, coord).r;
    if (arrayIdx == 1) return texture(u_spriteAtlas1, coord).r;
    if (arrayIdx == 2) return texture(u_spriteAtlas2, coord).r;
    return texture(u_spriteAtlas3, coord).r;
}

// Resolve a palette index to an RGBA color using the player's palette row
vec4 resolveIndex(uint index) {
    if (index == 0u) return vec4(0.0);                                                   // transparent
    if (index == 1u) return vec4(0.0, 0.0, 0.0, 0.55);                                  // shadow
    // Atlas stores raw value + 2 (avoids 0/1 collision). Subtract 2, add palette base.
    int linearIndex = int(index) - 2 + int(v_paletteBase);
    int localX = linearIndex % u_paletteWidth;
    int localY = linearIndex / u_paletteWidth;
    int finalY = int(v_playerRow) * u_paletteRowsPerPlayer + localY;
    return texelFetch(u_palette, ivec2(localX, finalY), 0);
}

void main() {
    uint index1 = sampleAtlas(v_texcoord1.xy, v_texcoord1.z);
    uint index2 = sampleAtlas(v_texcoord2.xy, v_texcoord2.z);

    vec4 color1 = resolveIndex(index1);
    vec4 color2 = resolveIndex(index2);

    // Blend the two colors based on transition progress
    vec4 blended = mix(color1, color2, v_blend);

    // Apply selection/highlight tint
    // Output alpha=0 for transparent pixels (alpha-to-coverage with MSAA)
    fragColor = blended * v_tint;
}
