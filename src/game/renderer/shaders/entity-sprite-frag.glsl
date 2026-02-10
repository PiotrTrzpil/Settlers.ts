// Entity sprite fragment shader — palettized texture array atlas
// Reads palette index from R16UI array layer, looks up player-tinted color
// from multi-row palette texture, applies selection tint.

precision mediump float;
precision highp usampler2DArray;

in vec3 v_texcoord;        // (u, v, layer)
flat in float v_playerRow; // palette row (0=neutral, 1+=player)
in vec4 v_tint;            // selection/highlight tint

uniform usampler2DArray u_spriteAtlas;  // R16UI array — palette indices (unsigned int)
uniform sampler2D u_palette;             // RGBA8 multi-row — color lookup table

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

    // Palette lookup — fetch player-tinted color at (index, playerRow)
    vec4 color = texelFetch(u_palette, ivec2(int(index), int(v_playerRow)), 0);

    // Apply selection/highlight tint (white = no change)
    fragColor = color * v_tint;
}
