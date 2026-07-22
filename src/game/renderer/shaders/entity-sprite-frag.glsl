// Entity sprite fragment shader — palettized texture array atlas
// Reads palette index from R16UI array layer, looks up player-tinted color
// from 2D palette texture, applies selection tint.
// Supports edge anti-aliasing via alpha-to-coverage when MSAA is enabled.

precision mediump float;
precision highp usampler2DArray;

in vec3 v_texcoord;         // (u, v, globalLayer) — globalLayer spans multi-array atlas
flat in float v_playerRow;  // palette row (0=neutral, 1+=player)
flat in float v_paletteBase; // base offset into combined palette texture
in vec4 v_tint;             // selection/highlight tint

// Split across multiple TEXTURE_2D_ARRAYs (ANGLE Metal ~1 GiB / 32 layers each)
uniform usampler2DArray u_spriteAtlas0;
uniform usampler2DArray u_spriteAtlas1;
uniform usampler2DArray u_spriteAtlas2;
uniform usampler2DArray u_spriteAtlas3;
uniform int u_layersPerArray;            // typically 32
uniform sampler2D u_palette;             // RGBA8 2D — color lookup table
uniform int u_paletteWidth;              // Palette texture width (e.g., 2048)
uniform int u_paletteRowsPerPlayer;      // Texture rows per player section
uniform bool u_edgeAA;                   // Enable edge anti-aliasing

out vec4 fragColor;

// Map global layer → (array, local layer) and sample R16UI palette index
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

// Compute edge alpha based on sub-texel position and cardinal neighbors only
float computeEdgeAlpha() {
    vec2 texSize = vec2(textureSize(u_spriteAtlas0, 0).xy);
    vec2 texelSize = 1.0 / texSize;
    float layer = v_texcoord.z;

    // Sub-texel position (0 to 1 within this texel)
    vec2 st = fract(v_texcoord.xy * texSize);

    // Check cardinal neighbors
    bool right  = sampleAtlas(v_texcoord.xy + vec2( texelSize.x, 0.0), layer) == 0u;
    bool left   = sampleAtlas(v_texcoord.xy + vec2(-texelSize.x, 0.0), layer) == 0u;
    bool top    = sampleAtlas(v_texcoord.xy + vec2(0.0,  texelSize.y), layer) == 0u;
    bool bottom = sampleAtlas(v_texcoord.xy + vec2(0.0, -texelSize.y), layer) == 0u;

    // Compute distance to transparent edges
    float distRight  = right  ? (1.0 - st.x) : 1.0;
    float distLeft   = left   ? st.x : 1.0;
    float distTop    = top    ? (1.0 - st.y) : 1.0;
    float distBottom = bottom ? st.y : 1.0;

    // Minimum distance to any transparent edge
    float minDist = min(min(distRight, distLeft), min(distTop, distBottom));

    return smoothstep(0.0, 0.5, minDist);
}

void main() {
    // Read palette index from atlas layer (integer texture, no filtering)
    uint index = sampleAtlas(v_texcoord.xy, v_texcoord.z);

    // Index 0 = transparent pixel
    if (index == 0u) {
        fragColor = vec4(0.0);
        return;
    }

    // Index 1 = shadow (semi-transparent black)
    if (index == 1u) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.55) * v_tint;
        return;
    }

    // Atlas stores raw value + 2 (to avoid collision with 0=transparent, 1=shadow).
    // Subtract 2, then add per-sprite palette base (fileBaseOffset + paletteOffset).
    int linearIndex = int(index) - 2 + int(v_paletteBase);

    // Safety: if paletteWidth is 0 or invalid, show magenta
    if (u_paletteWidth <= 0) {
        fragColor = vec4(1.0, 0.0, 1.0, 1.0);
        return;
    }

    int localX = linearIndex % u_paletteWidth;
    int localY = linearIndex / u_paletteWidth;

    // Add player row offset (each player has u_paletteRowsPerPlayer rows)
    int finalY = int(v_playerRow) * u_paletteRowsPerPlayer + localY;

    // Palette lookup — fetch player-tinted color
    vec4 color = texelFetch(u_palette, ivec2(localX, finalY), 0);

    // Edge anti-aliasing: fade alpha near transparent neighbors
    // Based on sub-texel position within edge texels
    float edgeAlpha = u_edgeAA ? computeEdgeAlpha() : 1.0;

    // Apply selection/highlight tint and edge alpha
    fragColor = vec4(color.rgb, color.a * edgeAlpha) * v_tint;
}
