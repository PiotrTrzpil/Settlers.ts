// Entity sprite fragment shader — palettized texture array atlas
// Reads palette index from R16UI array layer, looks up player-tinted color
// from 2D palette texture, applies selection tint.

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

out vec4 fragColor;

void main() {
    // Read palette index from atlas layer (integer texture, no filtering)
    uint index = texture(u_spriteAtlas, v_texcoord).r;

    // Index 0 = transparent pixel (sprite background)
    if (index == 0u) discard;

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

    // Apply selection/highlight tint (white = no change)
    fragColor = color * v_tint;
}
