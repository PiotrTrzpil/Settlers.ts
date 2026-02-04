# Entity Texture Pipeline

Design document for rendering buildings (and later units) with actual sprite
textures from the original Settlers 4 game files, replacing the current
solid-color quads.

---

## Table of Contents

1. [Goals and Non-Goals](#1-goals-and-non-goals)
2. [Current State](#2-current-state)
3. [File Format Background](#3-file-format-background)
4. [Architecture Overview](#4-architecture-overview)
5. [Sprite Atlas](#5-sprite-atlas)
6. [Sprite Metadata Registry](#6-sprite-metadata-registry)
7. [Entity Renderer Changes](#7-entity-renderer-changes)
8. [Shader Changes](#8-shader-changes)
9. [Initialization Flow](#9-initialization-flow)
10. [Player Colour Tinting](#10-player-colour-tinting)
11. [Building Placement Preview](#11-building-placement-preview)
12. [Animated Buildings (Future)](#12-animated-buildings-future)
13. [Unit Sprites (Future)](#13-unit-sprites-future)
14. [Procedural Fallback](#14-procedural-fallback)
15. [Performance Considerations](#15-performance-considerations)
16. [Implementation Plan](#16-implementation-plan)
17. [File Inventory](#17-file-inventory)

---

## 1. Goals and Non-Goals

### Goals

- Render buildings as textured sprites loaded from the original Settlers 4
  `.gfx` files.
- Reuse the existing file-loading infrastructure (`FileManager`,
  `GfxFileReader`, `PaletteCollection`).
- Integrate with the existing `EntityRenderer` and `Renderer` classes with
  minimal disruption to the rendering pipeline.
- Support player colour tinting so the same sprite can represent buildings
  belonging to different players.
- Provide a procedural fallback (coloured quads with icons or text) when game
  files are unavailable, preserving testability without original assets.

### Non-Goals (for the initial implementation)

- Animated buildings (smoke, wheels, etc.) -- deferred to a follow-up.
- Unit sprite rendering -- deferred; the architecture will support it but the
  initial implementation targets buildings only.
- HD texture support (Settlers United) -- not blocked but not targeted.
- Shadow rendering.
- Per-pixel depth testing between overlapping entities.

---

## 2. Current State

`EntityRenderer` draws every entity as a solid-color quad:

```
Entity → player color RGBA → 6-vertex quad → drawArrays(TRIANGLES)
```

The fragment shader passes the colour through with no texture sampling.
Buildings appear as small blue (Player 0), red (Player 1), green (Player 2),
or yellow (Player 3) squares. This is documented in `rendering-pipeline.md`
section 6.

The landscape renderer, by contrast, has a full texture pipeline:
`2.gh6` → `GhFileReader` → `GfxImage16Bit` → `TextureMap16Bit` atlas →
`sampler2D` in the fragment shader. The entity texture pipeline will follow a
similar pattern, adapted for 8-bit palette-indexed sprites.

---

## 3. File Format Background

### GFX sprite pipeline

Building sprites live in the `.gfx` family of files. Loading a single sprite
requires several index files working together:

```
N.pa6  (palette data, RGB565, one big palette table)
N.pil  (palette index list: sprite index → byte offset into .pa6)
  ↓
N.gil  (graphics index list: sprite index → byte offset into N.gfx)
N.jil  (job index list: job number → first direction offset in N.dil)
N.dil  (direction index list: direction → first frame offset in N.gil)
  ↓
N.gfx  (raw sprite pixel data, palette-indexed with RLE compression)
```

The classes that implement this chain already exist:

| Class | File | Purpose |
|-------|------|---------|
| `PaletteCollection` | `src/resources/gfx/palette-collection.ts` | Wraps `.pa6` + `.pil`, resolves palette offset per sprite |
| `GfxFileReader` | `src/resources/gfx/gfx-file-reader.ts` | Coordinates the full chain, returns `GfxImage` objects |
| `GilFileReader` | `src/resources/gfx/gil-file-reader.ts` | Frame offset lookup |
| `JilFileReader` | `src/resources/gfx/jil-file-reader.ts` | Job → direction mapping |
| `DilFileReader` | `src/resources/gfx/dil-file-reader.ts` | Direction → frame mapping |
| `GfxImage` | `src/resources/gfx/gfx-image.ts` | Decodes palette-indexed sprites to RGBA `ImageData` |

### GfxImage properties

Each decoded sprite provides:

- `width`, `height` -- pixel dimensions
- `left`, `top` -- drawing offset (anchor point relative to tile center)
- `getImageData()` -- returns an RGBA `ImageData` object

The offset fields are critical: buildings are not centered on their tile.
The `left`/`top` values tell us where the sprite's top-left corner should be
drawn relative to the entity's world position.

### Which files contain buildings?

Based on the Settlers 4 file structure, building sprites for the different
civilizations are spread across multiple GFX files. The exact mapping
(GFX file number → building type → sprite indices) needs to be determined
empirically by inspecting the files at runtime or consulting community
documentation. The `SpriteMetadataRegistry` (see section 6) will encode this
mapping.

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Initialization                        │
│                                                         │
│  FileManager.readFile("N.gfx", "N.gil", ...)           │
│       ↓                                                 │
│  GfxFileReader  →  GfxImage[]  (decoded RGBA sprites)  │
│       ↓                                                 │
│  SpriteMetadataRegistry  (BuildingType → sprite index) │
│       ↓                                                 │
│  EntityTextureAtlas  (packs sprites into GPU texture)   │
│       ↓                                                 │
│  EntityRenderer.init()  (binds atlas + new shaders)     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    Per-frame render                      │
│                                                         │
│  For each building entity:                              │
│    1. Look up atlas entry by BuildingType                │
│    2. Compute world position (tileToWorld + offset)     │
│    3. Emit 6 vertices with UV coordinates into batch    │
│                                                         │
│  Upload batched vertex data → single drawArrays call    │
│  Fragment shader samples atlas, applies player tint     │
└─────────────────────────────────────────────────────────┘
```

### New files to create

| File | Purpose |
|------|---------|
| `src/game/renderer/entity-texture-atlas.ts` | RGBA8 texture atlas with sprite packing |
| `src/game/renderer/sprite-metadata.ts` | BuildingType/UnitType → atlas UV mapping |
| `src/game/renderer/shaders/entity-sprite-vert.glsl` | Vertex shader with UV support |
| `src/game/renderer/shaders/entity-sprite-frag.glsl` | Fragment shader with texture sampling + tinting |

### Files to modify

| File | Changes |
|------|---------|
| `src/game/renderer/entity-renderer.ts` | Load atlas on init, batch textured quads, dual render path |
| `src/components/use-renderer.ts` | Pass `FileManager` to `EntityRenderer` constructor |

---

## 5. Sprite Atlas

### `EntityTextureAtlas`

A new class similar to `TextureMap16Bit` but using RGBA8 format (since GFX
sprites are decoded to 32-bit RGBA with transparency).

```typescript
class EntityTextureAtlas extends ShaderTexture {
    private imgData: Uint8Array;
    private atlasWidth: number;
    private atlasHeight: number;

    // Slot-based row packing (same pattern as TextureMap16Bit)
    reserve(width: number, height: number): AtlasRegion;

    // Blit decoded sprite pixels into the reserved region
    blit(region: AtlasRegion, imageData: ImageData): void;

    // Upload to GPU as RGBA8
    load(gl: WebGL2RenderingContext): void;
}

interface AtlasRegion {
    x: number;      // pixel X in atlas
    y: number;      // pixel Y in atlas
    width: number;
    height: number;
    // Normalized UV coordinates for shader
    u0: number; v0: number;   // top-left
    u1: number; v1: number;   // bottom-right
}
```

### Atlas sizing

Building sprites in Settlers 4 are typically 40-120 pixels wide and 40-150
pixels tall. With ~24 building types, a 1024x1024 atlas should be sufficient.
If multiple civilizations are supported later, 2048x2048 may be needed.
The atlas should be sized dynamically based on the sprites actually loaded.

### Format choice: RGBA8 vs RGB565

Unlike terrain textures (opaque, RGB565), sprites have transparent pixels
(background around the building shape). RGBA8 is required for alpha
transparency. This doubles the memory per pixel compared to the landscape
atlas, but building sprites are much smaller in total area.

### Upload

```typescript
load(gl: WebGL2RenderingContext): void {
    super.bind(gl);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA8,
        this.atlasWidth, this.atlasHeight, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, this.imgData
    );
}
```

Use `NEAREST` filtering (no interpolation) to preserve the pixel-art style,
matching the landscape atlas approach.

---

## 6. Sprite Metadata Registry

### `SpriteMetadataRegistry`

Maps game entity types to sprite atlas regions. Built during initialization
after sprites are loaded and packed into the atlas.

```typescript
interface SpriteEntry {
    atlasRegion: AtlasRegion;   // UV coordinates in the atlas
    offsetX: number;            // Drawing offset from GfxImage.left
    offsetY: number;            // Drawing offset from GfxImage.top
    widthWorld: number;         // Sprite width in world-space units
    heightWorld: number;        // Sprite height in world-space units
}

class SpriteMetadataRegistry {
    private buildings: Map<BuildingType, SpriteEntry>;

    // Look up atlas entry for a building
    getBuilding(type: BuildingType): SpriteEntry | null;

    // Register a sprite during initialization
    registerBuilding(type: BuildingType, entry: SpriteEntry): void;
}
```

### World-space sizing

Sprites have pixel dimensions but need to be drawn at a consistent
world-space scale. The conversion factor should be calibrated so buildings
look correct relative to terrain tiles. A single tile is approximately 1.0
world units wide and 0.5 world units tall. A typical building should occupy
roughly 1-2 tiles.

```
worldWidth  = sprite.width  * PIXELS_TO_WORLD
worldHeight = sprite.height * PIXELS_TO_WORLD
```

`PIXELS_TO_WORLD` is a single tunable constant (start with `1.0 / 64.0`
and adjust visually).

### Sprite index mapping

The mapping from `BuildingType` to GFX sprite index needs to be established.
The approach:

1. **Manual mapping table** -- a static lookup table that maps each
   `BuildingType` enum value to a `(gfxFileNumber, spriteIndex)` pair.
   This table is populated from community documentation or by inspecting the
   GFX files in the existing file browser view.

2. **Runtime discovery** -- iterate through the GFX file images and log
   their dimensions and offsets. Identify building sprites by their
   characteristic sizes and offsets.

The manual table is the pragmatic first step:

```typescript
const BUILDING_SPRITE_MAP: Record<BuildingType, { file: number; index: number }> = {
    [BuildingType.Lumberjack]:    { file: 3, index: 0 },   // example indices
    [BuildingType.Sawmill]:       { file: 3, index: 1 },
    [BuildingType.Stonecutter]:   { file: 3, index: 2 },
    // ... to be filled in by inspecting game files
};
```

---

## 7. Entity Renderer Changes

### Dual render path

The `EntityRenderer` will support two modes:

1. **Textured mode** -- when sprite atlas is loaded successfully.
2. **Solid-color fallback** -- the current behavior, used when game files are
   unavailable.

The mode is determined during `init()` and does not change at runtime.

### Batched rendering

The current per-entity draw call approach works but doesn't scale well with
textures. The new path will batch all textured entities into a single
interleaved vertex buffer:

```
Per vertex (8 floats):
  [posX, posY, texU, texV, colorR, colorG, colorB, colorA]

Stride: 32 bytes per vertex, 6 vertices per entity
```

All buildings are drawn in a single `drawArrays(TRIANGLES)` call after
uploading the batch buffer. Non-textured elements (territory borders, path
dots, selection rings) continue to use the current per-draw approach since
they use the simple color pass-through shader.

### Draw order update

```
EntityRenderer.draw():
  1. Enable alpha blending
  2. Draw territory borders        (color shader, per-draw)
  3. Draw unit path dots            (color shader, per-draw)
  4. Draw textured entities         (sprite shader, batched)
     a. Bind sprite atlas texture
     b. For each entity with a sprite:
        - Look up SpriteEntry
        - Compute world position
        - Apply sprite offset (left/top from GfxImage)
        - Append 6 vertices to batch buffer
     c. Upload batch buffer
     d. drawArrays(TRIANGLES, 0, batchVertexCount)
  5. Draw color-only entities       (color shader, per-draw, fallback)
  6. Draw selection rings           (color shader, per-draw)
  7. Draw placement preview         (sprite or color shader)
  8. Disable blending
```

### Vertex data layout

```typescript
// Interleaved vertex buffer for textured entities
// Per vertex: 2 position + 2 texcoord + 4 color = 8 floats
private spriteBatchData: Float32Array;
private spriteBatchCapacity: number;

private fillSpriteQuad(
    offset: number,
    worldX: number, worldY: number,
    entry: SpriteEntry,
    tintR: number, tintG: number, tintB: number, tintA: number
): number {
    const x0 = worldX + entry.offsetX;
    const y0 = worldY + entry.offsetY;
    const x1 = x0 + entry.widthWorld;
    const y1 = y0 + entry.heightWorld;
    const { u0, v0, u1, v1 } = entry.atlasRegion;

    // 6 vertices (2 triangles), each: posX, posY, texU, texV, r, g, b, a
    // Triangle 1: top-left, bottom-left, bottom-right
    // Triangle 2: top-left, bottom-right, top-right
    // ... fill spriteBatchData[offset..offset+47]

    return offset + 48;  // 6 vertices * 8 floats
}
```

---

## 8. Shader Changes

### Vertex shader (`entity-sprite-vert.glsl`)

```glsl
#version 300 es

in vec2 a_position;    // world-space quad vertex
in vec2 a_texcoord;    // atlas UV coordinate
in vec4 a_tint;        // player colour tint

uniform mat4 projection;

out vec2 v_texcoord;
out vec4 v_tint;

void main() {
    gl_Position = projection * vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
    v_tint = a_tint;
}
```

### Fragment shader (`entity-sprite-frag.glsl`)

```glsl
#version 300 es
precision mediump float;

in vec2 v_texcoord;
in vec4 v_tint;

uniform sampler2D u_spriteAtlas;

out vec4 fragColor;

void main() {
    vec4 texel = texture(u_spriteAtlas, v_texcoord);

    // Discard fully transparent pixels (sprite background)
    if (texel.a < 0.01) discard;

    // Apply player colour tint
    // Tint is multiplied with the sprite colour; white tint = no change.
    fragColor = texel * v_tint;
}
```

### Tinting strategy

Player colour tinting multiplies the sprite by a per-vertex tint colour:

| Scenario | Tint value |
|----------|-----------|
| Normal rendering | `(1.0, 1.0, 1.0, 1.0)` -- white, no tint |
| Player-coloured parts | Player colour with alpha = 1.0 |
| Selected entity | `(1.3, 1.3, 1.3, 1.0)` -- slight brightening |
| Placement preview (valid) | `(0.5, 1.0, 0.5, 0.5)` -- green ghost |
| Placement preview (invalid) | `(1.0, 0.5, 0.5, 0.5)` -- red ghost |

For the initial implementation, the entire sprite is multiplied by the
player's tint colour. This works well enough for Settlers 4's art style where
buildings have neutral base colours. A more accurate approach (masking
specific colour regions) can be added later using a separate tint mask
texture.

---

## 9. Initialization Flow

```typescript
// In EntityRenderer.init():

async init(gl: WebGL2RenderingContext, fileManager: FileManager): Promise<boolean> {
    // 1. Try to load building sprites
    const atlas = new EntityTextureAtlas(1024, textureIndex);
    const registry = new SpriteMetadataRegistry();

    const loaded = await this.loadBuildingSprites(fileManager, atlas, registry);

    if (loaded) {
        // 2. Upload atlas to GPU
        atlas.load(gl);
        this.spriteAtlas = atlas;
        this.spriteRegistry = registry;

        // 3. Compile sprite shader
        this.initSpriteShader(gl);

        // 4. Allocate batch buffer
        this.spriteBatchData = new Float32Array(MAX_ENTITIES * 6 * 8);
    }

    // 5. Always compile color shader (for borders, paths, fallback)
    this.initColorShader(gl);

    return true;
}
```

### Loading building sprites

```typescript
private async loadBuildingSprites(
    fileManager: FileManager,
    atlas: EntityTextureAtlas,
    registry: SpriteMetadataRegistry
): Promise<boolean> {
    // Load required files for building GFX set (e.g., file number 3)
    const files = await fileManager.readFiles({
        gfx: '3.gfx',
        gil: '3.gil',
        jil: '3.jil',
        dil: '3.dil',
        pa6: '3.pa6',
        pil: '3.pil',
    });

    if (!files.gfx || !files.gil || !files.pa6 || !files.pil) {
        return false;  // Fall back to color quads
    }

    // Build readers
    const gilReader = new GilFileReader(files.gil);
    const jilReader = files.jil ? new JilFileReader(files.jil) : null;
    const dilReader = files.dil ? new DilFileReader(files.dil) : null;
    const pilReader = new PilFileReader(files.pil);
    const paletteCollection = new PaletteCollection(files.pa6, pilReader);
    const gfxReader = new GfxFileReader(
        files.gfx, gilReader, jilReader, dilReader, paletteCollection
    );

    // For each building type, load its sprite and pack into atlas
    for (const [buildingType, spriteInfo] of Object.entries(BUILDING_SPRITE_MAP)) {
        const gfxImage = gfxReader.getImage(spriteInfo.index);
        if (!gfxImage) continue;

        const imageData = gfxImage.getImageData();
        const region = atlas.reserve(imageData.width, imageData.height);
        if (!region) continue;

        atlas.blit(region, imageData);

        registry.registerBuilding(Number(buildingType), {
            atlasRegion: region,
            offsetX: gfxImage.left * PIXELS_TO_WORLD,
            offsetY: gfxImage.top * PIXELS_TO_WORLD,
            widthWorld: imageData.width * PIXELS_TO_WORLD,
            heightWorld: imageData.height * PIXELS_TO_WORLD,
        });
    }

    return registry.hasBuildingSprites();
}
```

---

## 10. Player Colour Tinting

### Approach: Simple multiplicative tint

For the first pass, the entire sprite is tinted with the player colour. The
tint is passed as a per-vertex attribute so different entities in the same
batch can have different colours.

The player colour palette is already defined in `entity-renderer.ts`:

```typescript
const PLAYER_COLORS = [
    [0.2, 0.6, 1.0, 0.9], // Player 0: Blue
    [1.0, 0.3, 0.3, 0.9], // Player 1: Red
    [0.3, 1.0, 0.3, 0.9], // Player 2: Green
    [1.0, 1.0, 0.3, 0.9], // Player 3: Yellow
];
```

For multiplicative tinting to look good, the base sprite colours should be
fairly bright/neutral. If the sprites have strong colours already, the
tint should be softened toward white:

```typescript
// Blend between white (no tint) and player colour
const tintStrength = 0.4;
const r = 1.0 + (playerColor[0] - 1.0) * tintStrength;
const g = 1.0 + (playerColor[1] - 1.0) * tintStrength;
const b = 1.0 + (playerColor[2] - 1.0) * tintStrength;
```

### Future: Colour mask approach

The original Settlers 4 uses a specific colour range in the palette for
player-coloured pixels (typically a range of blues that get remapped to the
player's colour). A future enhancement could:

1. Detect which pixels in the sprite fall within the "player colour" palette
   range during sprite loading.
2. Generate a 1-bit mask texture or encode a flag in the alpha channel.
3. In the fragment shader, apply player colour only to masked pixels while
   keeping the rest of the sprite unmodified.

This is architecturally simple (add one `if` branch in the fragment shader)
but requires knowledge of the palette colour ranges, which varies by GFX
file.

---

## 11. Building Placement Preview

When the player is placing a building, a semi-transparent "ghost" sprite
should appear at the cursor position.

### Implementation

Reuse the same sprite rendering path but with modified tint values:

```typescript
// Valid placement
tint = [0.5, 1.0, 0.5, 0.5];   // green, semi-transparent

// Invalid placement
tint = [1.0, 0.5, 0.5, 0.5];   // red, semi-transparent
```

The alpha value in the tint makes the entire sprite semi-transparent. The
fragment shader's `texel * v_tint` multiplication handles this naturally.

If the building type being placed has no loaded sprite, fall back to the
current coloured quad.

---

## 12. Animated Buildings (Future)

Some buildings in Settlers 4 have animated elements (windmill blades,
smoke, etc.). The architecture supports this with minimal changes:

### Animation metadata

Extend `SpriteEntry` with animation data:

```typescript
interface AnimatedSpriteEntry extends SpriteEntry {
    frames: AtlasRegion[];   // One atlas region per animation frame
    frameDuration: number;   // Milliseconds per frame
    loop: boolean;
}
```

### Atlas space

All animation frames for a building are packed into the atlas during
loading. The JIL/DIL index files already organize sprites into "jobs"
(animation sequences) and "directions" (facing), which maps directly to
animation frames.

### Rendering

During the render loop, select the current frame based on elapsed time:

```typescript
const frameIndex = Math.floor(elapsedTime / entry.frameDuration) % entry.frames.length;
const region = entry.frames[frameIndex];
```

### Construction animation

Buildings under construction could show partial sprites or a separate
construction animation sequence, if the GFX files contain those frames.

---

## 13. Unit Sprites (Future)

Unit sprites follow the same pipeline but with additional complexity:

- **8 facing directions** -- the DIL file maps direction indices to frame
  ranges. Each direction has its own set of animation frames.
- **Multiple animation states** -- idle, walking, working, fighting. The
  JIL file maps "job" indices to direction groups.
- **Smooth interpolation** -- units already have `moveProgress` for position
  interpolation. The animation frame can be synced to movement progress
  rather than wall-clock time.

The `SpriteMetadataRegistry` would be extended with:

```typescript
interface UnitSpriteEntry {
    directions: AnimatedSpriteEntry[];  // 8 entries, one per facing
    states: Map<UnitAnimState, number>; // State → direction set offset
}
```

Unit sprites are typically smaller than buildings (~20x30 pixels), so the
atlas has plenty of room. A separate atlas could be used if the building
atlas fills up.

---

## 14. Procedural Fallback

When game files are unavailable (test mode, demo, CI), the entity renderer
falls back to the current solid-colour quads. This is the existing behavior
and requires no changes.

The fallback is selected automatically based on whether
`loadBuildingSprites()` succeeds:

```typescript
if (this.spriteAtlas && this.spriteRegistry) {
    this.drawTexturedEntities(gl, viewPoint);
} else {
    this.drawColorEntities(gl, viewPoint);  // existing code path
}
```

An optional enhancement: generate simple procedural building icons
(rectangles with letter labels like "L" for Lumberjack, "S" for Sawmill)
rendered into the atlas as a CPU-side canvas operation. This provides better
visual feedback than plain squares without requiring game files.

---

## 15. Performance Considerations

### Batched draw calls

The current per-entity draw call pattern (upload 12 floats, draw 6 vertices,
repeat) is replaced with a single batched draw:

| Metric | Before | After |
|--------|--------|-------|
| Draw calls per frame | 1 per entity (~100) | 1 for all textured entities |
| Buffer uploads per frame | 1 per entity | 1 total |
| Shader switches per frame | 0 | 1 (color → sprite) |

### Vertex buffer sizing

Pre-allocate the batch buffer for `MAX_ENTITIES * 6 * 8` floats. With
200 entities and 8 floats per vertex, that's 200 * 48 = 9600 floats =
~38 KB -- trivial.

### Atlas texture memory

A 1024x1024 RGBA8 atlas = 4 MB of GPU memory. A 2048x2048 atlas = 16 MB.
Both are well within budget for any GPU that supports WebGL2.

### Texture unit allocation

The sprite atlas needs one texture unit. The landscape renderer already
uses units 0-2. The sprite atlas will use unit 3. `TextureManager` handles
allocation.

### Draw order and state changes

To minimise shader switches, all textured entities are drawn together in
one batch, and all color-only elements (borders, paths, rings) are drawn
with the simpler color shader. This means at most one shader switch per
frame in the entity renderer.

---

## 16. Implementation Plan

### Phase 1: Atlas and metadata infrastructure

1. Create `EntityTextureAtlas` class (RGBA8 atlas with slot packing).
2. Create `SpriteMetadataRegistry` class (BuildingType → SpriteEntry map).
3. Add sprite loading logic: load GFX files, decode sprites, pack into
   atlas, populate registry.

**New files:**
- `src/game/renderer/entity-texture-atlas.ts`
- `src/game/renderer/sprite-metadata.ts`

### Phase 2: Shader and renderer integration

4. Write the sprite vertex and fragment shaders.
5. Update `EntityRenderer` to support dual shader programs (color + sprite).
6. Implement batched vertex buffer construction for textured entities.
7. Wire up the sprite atlas texture unit.

**New files:**
- `src/game/renderer/shaders/entity-sprite-vert.glsl`
- `src/game/renderer/shaders/entity-sprite-frag.glsl`

**Modified files:**
- `src/game/renderer/entity-renderer.ts`

### Phase 3: Initialization wiring

8. Update `EntityRenderer` constructor to accept `FileManager` and
   `TextureManager`.
9. Update `use-renderer.ts` to pass `FileManager` and `TextureManager` to
   the `EntityRenderer`.
10. Load building sprite files during `EntityRenderer.init()`.

**Modified files:**
- `src/game/renderer/entity-renderer.ts`
- `src/components/use-renderer.ts`

### Phase 4: Sprite index mapping

11. Inspect the GFX files using the existing file browser view to determine
    which sprite indices correspond to which building types.
12. Populate the `BUILDING_SPRITE_MAP` lookup table.
13. Tune `PIXELS_TO_WORLD` and sprite offsets for correct visual placement.

### Phase 5: Polish

14. Implement player colour tinting.
15. Update building placement preview to use sprites.
16. Add procedural fallback icons (optional).
17. Update `rendering-pipeline.md` with the new entity texture section.

---

## 17. File Inventory

### New files

| File | Purpose |
|------|---------|
| `src/game/renderer/entity-texture-atlas.ts` | RGBA8 GPU texture atlas for entity sprites |
| `src/game/renderer/sprite-metadata.ts` | Entity type → atlas region + offset mapping |
| `src/game/renderer/shaders/entity-sprite-vert.glsl` | Vertex shader with position + UV + tint |
| `src/game/renderer/shaders/entity-sprite-frag.glsl` | Fragment shader with atlas sampling + tint |

### Modified files

| File | Changes |
|------|---------|
| `src/game/renderer/entity-renderer.ts` | Add sprite atlas support, batched rendering, dual shader path |
| `src/components/use-renderer.ts` | Pass FileManager/TextureManager to EntityRenderer |

### Existing files used (no changes needed)

| File | Role |
|------|------|
| `src/resources/gfx/gfx-file-reader.ts` | Load and decode GFX sprites |
| `src/resources/gfx/gfx-image.ts` | Sprite data (dimensions, offset, pixels) |
| `src/resources/gfx/palette-collection.ts` | Palette resolution for sprite colours |
| `src/resources/gfx/gil-file-reader.ts` | Frame offset index |
| `src/resources/gfx/jil-file-reader.ts` | Job animation index |
| `src/resources/gfx/dil-file-reader.ts` | Direction index |
| `src/resources/gfx/pil-file-reader.ts` | Palette offset index |
| `src/game/renderer/shader-texture.ts` | Base texture bind/activate |
| `src/game/renderer/texture-manager.ts` | Texture unit allocation |
| `src/game/renderer/renderer-base.ts` | Shader init helper |
| `src/game/renderer/shader-program.ts` | GLSL compile/link, attribute management |
| `src/utilities/file-manager.ts` | File loading |
| `src/game/entity.ts` | BuildingType enum, Entity interface |
