// Entity sprite fragment shader — palettized texture array atlas
// Reads palette index from R16UI array layer, looks up player-tinted color
// from 2D palette texture, applies selection tint.
// Supports edge anti-aliasing via alpha-to-coverage when MSAA is enabled.

precision mediump float;
precision highp usampler2DArray;

in vec3 v_texcoord;         // (u, v, layer)
flat in float v_playerRow;  // palette row (0=neutral, 1+=player)
flat in float v_paletteBase; // base offset into combined palette texture
in vec4 v_tint;             // selection/highlight tint

uniform usampler2DArray u_spriteAtlas;  // R16UI array — palette indices (unsigned int)
uniform sampler2D u_palette;             // RGBA8 2D — color lookup table
uniform int u_paletteWidth;              // Palette texture width (e.g., 2048)
uniform int u_paletteRowsPerPlayer;      // Texture rows per player section
uniform bool u_edgeAA;                   // Enable edge anti-aliasing

out vec4 fragColor;

// Compute edge alpha based on sub-texel position and cardinal neighbors only
float computeEdgeAlpha() {
    vec2 texSize = vec2(textureSize(u_spriteAtlas, 0).xy);
    vec2 texelSize = 1.0 / texSize;
    float layer = v_texcoord.z;

    // Sub-texel position (0 to 1 within this texel)
    vec2 st = fract(v_texcoord.xy * texSize);

    // Check cardinal neighbors
    bool right  = texture(u_spriteAtlas, vec3(v_texcoord.xy + vec2( texelSize.x, 0.0), layer)).r == 0u;
    bool left   = texture(u_spriteAtlas, vec3(v_texcoord.xy + vec2(-texelSize.x, 0.0), layer)).r == 0u;
    bool top    = texture(u_spriteAtlas, vec3(v_texcoord.xy + vec2(0.0,  texelSize.y), layer)).r == 0u;
    bool bottom = texture(u_spriteAtlas, vec3(v_texcoord.xy + vec2(0.0, -texelSize.y), layer)).r == 0u;

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
    uint index = texture(u_spriteAtlas, v_texcoord).r;

    // Index 0 = transparent pixel
    if (index == 0u) {
        fragColor = vec4(0.0);
        return;
    }

    // Index 1 = shadow (semi-transparent black at 25% opacity)
    if (index == 1u) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.25) * v_tint;
        return;
    }

    // Add per-sprite palette base offset to get final index in combined palette
    // This avoids Uint16 overflow in the atlas texture
    int linearIndex = int(index) + int(v_paletteBase);

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
