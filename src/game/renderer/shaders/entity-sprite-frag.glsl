// Entity sprite fragment shader — palettized texture array atlas
// Reads palette index from R16UI array layer, looks up color in palette texture,
// applies player colour tinting.

precision mediump float;
precision highp usampler2DArray;

in vec3 v_texcoord;   // (u, v, layer)
in vec4 v_tint;

uniform usampler2DArray u_spriteAtlas;  // R16UI array — palette indices (unsigned int)
uniform sampler2D u_palette;             // RGBA8 — color lookup table

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

    // Palette lookup — fetch color at (index, 0) from 1D-ish palette texture
    vec4 color = texelFetch(u_palette, ivec2(int(index), 0), 0);

    // Apply player colour tint (white tint = no change)
    fragColor = color * v_tint;
}
