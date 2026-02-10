# Palettized Atlas Implementation Plan

## Status: IMPLEMENTED

All phases have been implemented. The atlas now uses R16UI format (2 bytes/pixel)
instead of RGBA8 (4 bytes/pixel), achieving 2x memory savings. Key changes:

- `src/game/renderer/palette-texture.ts` - NEW: PaletteTextureManager
- `src/game/renderer/entity-texture-atlas.ts` - R16UI format, blitIndices, extractRegion
- `src/game/renderer/sprite-decode-worker.ts` - Indexed decode mode (Uint16Array output)
- `src/game/renderer/sprite-decoder-pool.ts` - decodeIndexed method
- `src/game/renderer/sprite-loader.ts` - Indexed pipeline, palette base offsets
- `src/game/renderer/sprite-render-manager.ts` - Palette registration, upload, cache
- `src/game/renderer/sprite-batch-renderer.ts` - u_palette binding
- `src/game/renderer/entity-renderer.ts` - Palette bind before draw
- `src/game/renderer/shaders/entity-sprite-frag.glsl` - usampler2D + palette lookup
- `src/game/renderer/shaders/entity-sprite-blend-frag.glsl` - usampler2D + palette lookup
- `src/game/renderer/sprite-atlas-cache.ts` - Schema v3, palette data in cache
- `src/resources/gfx/gfx-image.ts` - getIndexData() for sync fallback

## Goal
Reduce sprite atlas memory from 1GB to 256MB (4× reduction) by storing palette indices instead of RGBA colors.

## Current State

```
GFX file (RLE + palette index)
    → Decode: palette[paletteOffset + index] → RGBA (4 bytes/pixel)
    → Atlas: RGBA8 texture (1GB for 16384×16384)
    → GPU: Single texture fetch per pixel
```

**Problems:**
- 1GB atlas doesn't fit in IndexedDB (256MB limit)
- High VRAM usage
- Slow initial load (copying 1GB to GPU)

## Proposed State

```
GFX file (RLE + palette index)
    → Decode: keep as index (1 byte/pixel)
    → Atlas: R8 texture (256MB for 16384×16384)
    → Palette: RGBA8 texture (256×N pixels, ~4KB)
    → GPU: Two texture fetches per pixel (index → palette lookup)
```

**Benefits:**
- 4× smaller atlas (fits in IndexedDB)
- 4× faster GPU upload
- Lossless color reproduction
- Negligible runtime overhead

---

## Implementation Steps

### Phase 1: Understand Palette Structure

**Task 1.1: Audit palette usage across GFX files**

Files to check:
- `src/resources/gfx/palette-collection.ts` - PA6 file reading
- `src/resources/gfx/palette.ts` - Palette class
- `src/resources/gfx/gfx-image.ts` - How paletteOffset is used

Questions to answer:
- [ ] How many colors per PA6 file?
- [ ] What's the max value of `paletteOffset + pixelValue`?
- [ ] Do different GFX file sets share palettes or have separate ones?
- [ ] Are there any special color indices (transparency, shadow)?

**Task 1.2: Map out which files use which palettes**

Current file sets loaded:
| Category | GFX Files | Palette Files |
|----------|-----------|---------------|
| Buildings | 1, 2, ... | 1.pa6, 2.pa6, ... |
| Map Objects | 5 | 5.pa6 |
| Resources | 3 | 3.pa6 |
| Units (Roman) | 20 | 20.pa6 |
| Units (Viking) | 21 | 21.pa6 |
| ... | ... | ... |

---

### Phase 2: Create Combined Palette Texture

**Task 2.1: Design palette texture layout**

Option A: Horizontal (Nx1)
```
[file0: 256 colors][file1: 256 colors][file2: 256 colors]...
Total width: 256 × numFiles
```

Option B: Vertical (256×N)
```
Row 0: file0 palette (256 colors)
Row 1: file1 palette (256 colors)
...
```

Recommendation: **Option A (horizontal)** - simpler indexing, single texelFetch

**Task 2.2: Implement PaletteTextureManager**

```typescript
// src/game/renderer/palette-texture.ts

export class PaletteTextureManager {
    private texture: WebGLTexture;
    private fileBaseOffsets: Map<string, number> = new Map();
    private totalColors = 0;

    /** Register a palette and return its base offset */
    registerPalette(fileId: string, palette: Palette): number;

    /** Upload all palettes to GPU */
    upload(gl: WebGL2RenderingContext): void;

    /** Get the base offset for a file's palette */
    getBaseOffset(fileId: string): number;

    /** Bind palette texture to a texture unit */
    bind(gl: WebGL2RenderingContext, unit: number): void;
}
```

---

### Phase 3: Modify Sprite Decoder

**Task 3.1: Add index-only decode mode**

Current (`gfx-image.ts`):
```typescript
const color = palette.getColor(paletteOffset + value);
imgData[j++] = color;  // Uint32 RGBA
```

New:
```typescript
// For palettized mode, output the final index directly
indexData[j++] = paletteOffset + value;  // Uint8
```

**Task 3.2: Update worker decoder**

File: `src/game/renderer/sprite-decoder-worker.ts`

Add new decode function that returns `Uint8Array` instead of `Uint8ClampedArray` (RGBA).

**Task 3.3: Handle special indices**

From `gfx-image.ts`:
```typescript
if (value <= 1) {
    // 0 = transparent, 1 = shadow
    const color = value === 0 ? 0x00000000 : 0x40000000;
}
```

These need special handling:
- Index 0: Fully transparent
- Index 1: Semi-transparent shadow (black @ 25% opacity)

Options:
1. Reserve indices 0-1 in all palettes for transparent/shadow
2. Handle in shader with special case
3. Store transparency in a separate channel

Recommendation: **Option 2** - handle in shader:
```glsl
if (index < 0.004) discard;           // index 0 = transparent
if (index < 0.008) {                   // index 1 = shadow
    fragColor = vec4(0, 0, 0, 0.25);
    return;
}
```

---

### Phase 4: Modify Atlas to R8 Format

**Task 4.1: Update EntityTextureAtlas**

File: `src/game/renderer/entity-texture-atlas.ts`

Changes:
```typescript
// Constructor: allocate 1 byte per pixel instead of 4
this.imgData = new Uint8Array(initialSize * initialSize);  // was * 4

// blit(): copy 1 byte per pixel
// update(): use gl.R8 format
gl.texImage2D(
    gl.TEXTURE_2D, 0,
    gl.R8,           // was gl.RGBA8
    width, height, 0,
    gl.RED,          // was gl.RGBA
    gl.UNSIGNED_BYTE,
    this.imgData
);
```

**Task 4.2: Update sprite loading pipeline**

File: `src/game/renderer/sprite-render-manager.ts`

- Pass palette base offset when decoding sprites
- Store indices instead of RGBA in atlas

---

### Phase 5: Update Entity Shader

**Task 5.1: Modify fragment shader**

File: `src/game/renderer/shaders/entity.frag`

Current:
```glsl
vec4 texColor = texture(u_spriteAtlas, v_texCoord);
```

New:
```glsl
uniform sampler2D u_spriteAtlas;   // R8 - palette indices
uniform sampler2D u_palette;        // RGBA - color lookup

void main() {
    float index = texture(u_spriteAtlas, v_texCoord).r;

    // Handle transparency (index 0)
    if (index < 0.004) discard;

    // Handle shadow (index 1)
    if (index < 0.008) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.25);
        return;
    }

    // Palette lookup
    int paletteIndex = int(index * 255.0);
    vec4 color = texelFetch(u_palette, ivec2(paletteIndex, 0), 0);

    fragColor = color;
}
```

**Task 5.2: Update shader uniforms**

File: `src/game/renderer/entity-renderer.ts`

- Add `u_palette` uniform
- Bind palette texture before drawing

---

### Phase 6: Update Cache Format

**Task 6.1: Modify cache data structure**

File: `src/game/renderer/sprite-atlas-cache.ts`

```typescript
interface CachedAtlasData {
    imgData: Uint8Array;        // Now 1 byte/pixel instead of 4
    paletteData: Uint8Array;    // Combined palette RGBA
    paletteOffsets: Record<string, number>;  // File → base offset mapping
    // ... rest unchanged
}
```

**Task 6.2: Update cache size check**

The 256MB limit should now easily fit the atlas:
```typescript
// Can probably remove this check entirely, or raise limit
const MAX_INDEXEDDB_SIZE = 256 * 1024 * 1024;
```

---

### Phase 7: Testing

**Task 7.1: Visual comparison**
- [ ] Take screenshots before changes
- [ ] Compare after changes - should be pixel-identical

**Task 7.2: Performance comparison**
- [ ] Measure atlas load time before/after
- [ ] Measure GPU upload time before/after
- [ ] Measure runtime frame time before/after

**Task 7.3: Edge cases**
- [ ] Transparent pixels render correctly
- [ ] Shadow pixels render correctly
- [ ] All building types display correctly
- [ ] All unit types display correctly
- [ ] All tree types display correctly
- [ ] Animation frames work correctly

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/game/renderer/palette-texture.ts` | **NEW** - PaletteTextureManager |
| `src/game/renderer/entity-texture-atlas.ts` | R8 format, 1 byte/pixel |
| `src/game/renderer/sprite-decoder-worker.ts` | Index-only decode mode |
| `src/game/renderer/sprite-render-manager.ts` | Pass palette offsets, load palettes |
| `src/game/renderer/entity-renderer.ts` | Bind palette texture |
| `src/game/renderer/shaders/entity.frag` | Palette lookup |
| `src/game/renderer/sprite-atlas-cache.ts` | Cache palette data |
| `src/resources/gfx/gfx-image.ts` | Add getIndexData() method |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Palette indices exceed 255 | Check max(paletteOffset + value) in Phase 1 |
| Different files have incompatible palettes | Combine into larger texture, track offsets |
| Performance regression | Benchmark before/after, optimize shader if needed |
| Shadow rendering breaks | Test shadow indices explicitly |
| Cache format incompatible | Bump cache schema version |

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Research | 30 min |
| Phase 2: Palette texture | 1 hour |
| Phase 3: Decoder changes | 1 hour |
| Phase 4: Atlas changes | 30 min |
| Phase 5: Shader changes | 30 min |
| Phase 6: Cache changes | 30 min |
| Phase 7: Testing | 1 hour |
| **Total** | **~5 hours** |

---

## Research Findings (Phase 1 Complete)

### Q1: What is the max value of `paletteOffset + pixelValue`?

**Answer: Can exceed 255!**

From `palette-collection.ts`:
```typescript
this.palette = new Palette(reader.length / 2);  // Can be > 256 colors!
```

The PA6 files contain multi-hundred color palettes. Each sprite gets a `paletteOffset` pointing into this larger palette, then adds the pixel value (0-255).

**Implication:** Cannot use R8 format directly. Options:
1. **R16 format** (16-bit) - 2× savings instead of 4×, simpler
2. **R8 + per-vertex paletteOffset** - 4× savings, more complex shader/vertex setup

### Q2: Do we need multiple palette textures?

**Answer: One combined palette per GFX file set is sufficient.**

Each file set (1.gfx/1.pa6, 5.gfx/5.pa6, etc.) has its own palette. Since we load all sprites for one race into a single atlas, we need to either:
- Combine all palettes into one large texture
- Track which palette each sprite uses

**Recommendation:** Combine all palettes into a single texture with file-based offsets.

### Q3: Fallback RGBA path?

**Recommendation:** Keep existing RGBA decode path for debugging. Add a toggle:
```typescript
const USE_PALETTIZED_ATLAS = true;  // Feature flag
```

---

## Revised Implementation: R16 Approach

Since `paletteOffset + pixelValue` can exceed 255, we'll use **R16UI** (16-bit unsigned integer) format:

- **Memory:** 2× savings (512MB instead of 1GB for 16384² atlas)
- **IndexedDB:** Should fit within quota
- **Complexity:** Simpler than per-vertex offset approach

### Key Changes from Original Plan

| Original | Revised |
|----------|---------|
| R8 format (1 byte/pixel) | R16UI format (2 bytes/pixel) |
| 4× memory savings | 2× memory savings |
| 256-color limit | 65536-color limit |
| Complex offset handling | Direct index storage |

### Shader Update (Revised)

```glsl
uniform usampler2D u_spriteAtlas;  // R16UI - palette indices (unsigned int)
uniform sampler2D u_palette;        // RGBA - color lookup

void main() {
    uint index = texture(u_spriteAtlas, v_texCoord).r;

    // Handle transparency (index 0)
    if (index == 0u) discard;

    // Handle shadow (index 1)
    if (index == 1u) {
        fragColor = vec4(0.0, 0.0, 0.0, 0.25);
        return;
    }

    // Palette lookup
    vec4 color = texelFetch(u_palette, ivec2(int(index), 0), 0);
    fragColor = color;
}
```

---

## Open Questions (Remaining)

1. What's the maximum combined palette size across all file sets? Need to verify < 65536.

2. Should we pursue R8 + per-vertex offset later for additional 2× savings?
