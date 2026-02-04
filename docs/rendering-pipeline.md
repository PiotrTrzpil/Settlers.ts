# Rendering Pipeline

An overview of how Settlers.ts turns game state into pixels. This document is
written for developers comfortable with TypeScript but not necessarily familiar
with WebGL internals.

---

## Table of Contents

1. [Architecture at a Glance](#1-architecture-at-a-glance)
2. [The Render Loop](#2-the-render-loop)
3. [Coordinate Spaces](#3-coordinate-spaces)
4. [Camera and Viewport](#4-camera-and-viewport)
5. [Landscape Rendering](#5-landscape-rendering)
6. [Entity Rendering](#6-entity-rendering)
7. [Shader Programs](#7-shader-programs)
8. [Texture Management](#8-texture-management)
9. [Tile Picking (Screen to Tile)](#9-tile-picking-screen-to-tile)
10. [Performance Techniques](#10-performance-techniques)
11. [Key Files Reference](#11-key-files-reference)

---

## 1. Architecture at a Glance

The renderer is a small, manually managed WebGL2 pipeline. There is no
scene graph, no third-party graphics library, and no deferred rendering. Each
frame follows a straightforward path:

```
Game tick
  --> Game loop fires render callback
      --> Renderer.draw()
          --> LandscapeRenderer.draw()   (terrain)
          --> EntityRenderer.draw()      (units, buildings, UI overlays)
      --> Canvas presents the framebuffer
```

The two sub-renderers are independent. Each owns its own shader program and
manages its own GPU resources. The main `Renderer` class provides them with
a shared projection matrix and viewport.

**Key entry points:**

| Concern | File |
|---------|------|
| Vue integration & game loop wiring | `src/components/use-renderer.ts` |
| WebGL context & orchestration | `src/game/renderer/renderer.ts` |
| Terrain | `src/game/renderer/landscape/landscape-renderer.ts` |
| Entities | `src/game/renderer/entity-renderer.ts` |
| Shader compilation | `src/game/renderer/shader-program.ts` |
| Camera | `src/game/renderer/view-point.ts` |
| Tile picking | `src/game/input/tile-picker.ts` |

---

## 2. The Render Loop

Rendering is driven by the game loop, not by `requestAnimationFrame` directly.
The composable `useRenderer` (in `src/components/use-renderer.ts`) wires
things up at mount time:

1. A `Renderer` is created around the `<canvas>` element.
2. `LandscapeRenderer` and `EntityRenderer` are added as sub-renderers.
3. The game loop's render callback is set. On every tick it:
   - Copies the current entity list, selection state, unit movement states,
     and territory data onto the `EntityRenderer`.
   - Updates debug stats.
   - Calls `renderer.drawOnce()`.

`drawOnce()` schedules exactly one `requestAnimationFrame`, avoiding
redundant frames when nothing changes. Inside the scheduled callback:

```
Renderer.draw()
  1. Sync canvas pixel dimensions to devicePixelRatio for HiDPI.
  2. gl.viewport(…), gl.clear(…).
  3. Build an orthographic projection matrix incorporating zoom.
  4. Iterate sub-renderers, calling draw(gl, projectionMatrix, viewPoint).
```

The projection matrix is:

```
ortho(-aspect, aspect, 1, -1, -1, 1)
  .translate(-1, 1, 0)
  .scale(zoom, zoom, 1)
```

This maps world-space coordinates into clip space with the camera's zoom
applied uniformly. The `Matrix` helper lives in
`src/game/renderer/landscape/matrix.ts`.

---

## 3. Coordinate Spaces

There are four coordinate spaces involved:

```
Screen (canvas pixels)
   |  TilePicker.screenToTile()
   v
NDC (-1..1 on both axes)
   |  reverse projection
   v
World (continuous floats, parallelogram-projected)
   |  tile grid math
   v
Tile (integer x, y on the hex grid)
```

### Tile coordinates

The map is a hex grid stored in a flat array indexed by
`x + y * mapWidth`. Odd rows are shifted by half a tile (offset
coordinates). Six-directional movement deltas are defined in
`src/game/systems/hex-directions.ts`.

### Instance coordinates

Before tiles reach the GPU they are converted to *instance coordinates*:
`(x + floor(y / 2), y)`. This undoes the visual row shifting so the
vertex shader can apply a uniform parallelogram transformation.

### World coordinates

The vertex shader converts instance coordinates to world space:

```
worldX = instanceX - instanceY * 0.5
worldY = (instanceY - height) * 0.5
```

The `- height` term lifts vertices upward for elevated terrain. The
`* 0.5` on Y compresses the grid vertically, giving the isometric look.

---

## 4. Camera and Viewport

`ViewPoint` (`src/game/renderer/view-point.ts`) tracks camera position
and zoom. It also owns the mouse drag and scroll-wheel handlers.

### Position

Camera position is stored as `(posX, posY)` plus a transient `(deltaX,
deltaY)` that accumulates during a drag gesture. When the pointer is
released, the delta is committed into `pos`.

`setPosition(tileX, tileY)` centres the camera on a tile, accounting
for the parallelogram projection and aspect ratio.

### Zoom

`zoomValue` is an integer starting at 1. The actual zoom factor passed to
the projection is `0.1 / zoomValue`, so scrolling up increases
`zoomValue`, shrinking the visible area. Zoom is clamped to a minimum of
1 (maximum zoom-in).

### Drag

Pointer drag deltas are scaled by `zoomValue * 0.03` and transformed to
match the isometric axes:

```
deltaX = dPixelX + dPixelY / 2    (accounts for the slanted grid)
deltaY = dPixelY
```

---

## 5. Landscape Rendering

The landscape renderer draws the entire terrain in a **single instanced
draw call**. This is the most GPU-efficient part of the pipeline.

### Geometry

Each tile is a parallelogram made of two triangles (6 vertices):

```
     0  3------5
     /\        /
    /  \ B   /
   / A  \  /
  /      \/
 1------2  4
```

The six vertex positions are constants baked into the vertex shader. The
only per-instance data is the tile's position on the grid, sent as a
`vec2` attribute with `vertexAttribDivisor = 1`.

### Visible tile culling

Before drawing, the renderer calculates how many tiles are visible at the
current zoom level:

```
numInstancesX = ceil(2 * aspect / zoom) + 2
numInstancesY = ceil(4 / zoom) + 2
```

Only this subset of instances is drawn. Tiles that fall outside the map
boundaries are discarded in the vertex shader by moving them to `z = 2.0`
(outside the clip volume).

### Data textures

Two data textures pass map information to the vertex shader. These are
regular `texImage2D` uploads using integer formats, read with
`texelFetch()` (no filtering):

| Texture | Channels | Per-tile data |
|---------|----------|---------------|
| `landTypeBuffer` | RGBA8 | Texture atlas coordinates for triangle A (R, G) and triangle B (B, A) |
| `landHeightBuffer` | R8 | Height value (0-255) |

The `ShaderDataTexture` class (`src/game/renderer/shader-data-texture.ts`)
wraps creation and upload. It tracks a dirty flag to avoid redundant
`texImage2D` calls.

### Vertex shader (`landscape-vert.glsl`)

The vertex shader does the heavy lifting:

1. Selects the base vertex position (0-5) within the parallelogram.
2. Reads the tile's height from `u_landHeightBuffer` via `texelFetch`.
3. Reads texture atlas coordinates from `u_landTypeBuffer`.
4. Computes world position: applies the parallelogram projection and
   height offset.
5. Computes a height-gradient shading value by comparing heights of
   adjacent samples. Upward slopes are brightened, downward slopes are
   darkened:
   ```glsl
   v_shader_color = 0.95 + gradient * (gradient > 0.0 ? 0.8 : 1.0);
   ```
6. Outputs the texture coordinate pointing into the terrain atlas.

### Fragment shader (`landscape-frag.glsl`)

The fragment shader is simple:

- Discards fragments with `v_texcoord.x < 0` (out-of-bounds tiles).
- Samples the terrain texture atlas.
- Multiplies the sample by the height-gradient shading value.
- Optionally draws a black wireframe overlay when
  `DEBUG_TRIANGLE_BORDER` is defined, using barycentric coordinates.

---

## 6. Entity Rendering

Entities (units, buildings, selection rings, path dots, territory borders,
and placement previews) are rendered as flat colored quads. There is no
texture atlas for entities yet -- everything is solid color.

### Drawing order

Each frame, `EntityRenderer.draw()` runs through these steps:

1. Enable alpha blending (`SRC_ALPHA, ONE_MINUS_SRC_ALPHA`).
2. Draw **territory border markers** -- small colored dots at tiles
   where the owner differs from a neighbour. The border tile list is
   cached and only recomputed when `territoryVersion` changes.
3. Draw **unit path dots** along remaining movement waypoints (up to 30
   per unit, small green circles).
4. Draw **entities**:
   - Buildings use their exact tile position.
   - Units use interpolated positions (lerp between previous and
     current tile based on `moveProgress`) for smooth movement.
   - Tile positions are converted to world coordinates via
     `TilePicker.tileToWorld()`.
   - Each entity is drawn as a scaled quad (6 vertices, 2 triangles)
     with the player's color.
   - Selected entities get a second, slightly larger yellow ring drawn
     on top.
5. Draw **building placement preview** at the mouse position (green if
   valid, red if invalid).

### Geometry

All quads share a single `BASE_QUAD` vertex array:

```
(-0.5, -0.5), (0.5, -0.5), (-0.5, 0.5),
(-0.5,  0.5), (0.5, -0.5), (0.5,  0.5)
```

A reusable `Float32Array` is filled per entity by scaling and
translating these positions, then uploaded with `bufferData(DYNAMIC_DRAW)`
and drawn with `drawArrays(TRIANGLES, 0, 6)`. This is a draw-call-per-entity
approach -- simple but sufficient while entity counts are modest.

### Entity shaders

The entity vertex shader scales the quad by 0.4, offsets it by the
entity's world position, and transforms through the projection matrix. The
fragment shader passes through the color unchanged.

### Player colors

```
Blue   (0, 0, 1, 1)
Red    (1, 0, 0, 1)
Green  (0, 1, 0, 1)
Yellow (1, 1, 0, 1)
```

Selection highlight is white. Path dots are semi-transparent green.
Placement previews use semi-transparent green/red.

---

## 7. Shader Programs

`ShaderProgram` (`src/game/renderer/shader-program.ts`) wraps the WebGL2
shader compilation, linking, and attribute/uniform management.

### Compilation

1. Source strings are imported at build time via `vite-plugin-glsl`.
2. `attachShaders()` prepends `#version 300 es` and any `#define`
   directives before calling `gl.compileShader()`.
3. `create()` links the program and creates a **Vertex Array Object (VAO)**
   that captures all subsequent attribute bindings.

### Defines

`setDefine(name, value)` injects `#define` lines before compilation.
The landscape renderer uses this to bake map dimensions and texture atlas
size into the shader:

```
#define MAP_WIDTH 256
#define MAP_HEIGHT 256
#define LANDSCAPE_TEXTURE_WIDTH_HEIGHT 1536
```

### Attribute management

`setAttribute()` uses a per-attribute buffer cache (a `Map<string,
WebGLBuffer>`) so the same buffer object is reused across frames instead
of creating a new one every draw call. Instanced attributes are
configured with `vertexAttribDivisor`.

### Uniform helpers

- `setMatrix(name, values)` -- 4x4 matrix via `uniformMatrix4fv`.
- `setVector2(name, a, b)` -- vec2 via `uniform2fv`.
- `bindTexture(name, unit)` -- sets a sampler uniform to a texture unit
  index.

---

## 8. Texture Management

### Texture units

`TextureManager` (`src/game/renderer/texture-manager.ts`) is a minimal
allocator. Each call to `create(uniformName)` reserves the next texture
unit (0, 1, 2, ...) and records the uniform name. `bindToShader()` loops
through and binds all units to the current shader.

Three texture units are used:

| Unit | Uniform | Content |
|------|---------|---------|
| 0 | `u_texture` | Terrain texture atlas (RGB565) |
| 1 | `u_landTypeBuffer` | Per-tile texture coordinates (RGBA8) |
| 2 | `u_landHeightBuffer` | Per-tile height map (R8) |

### Terrain texture atlas

`TextureMap16Bit` (`src/game/renderer/texture-map-16bit.ts`) packs all
terrain textures into a single large atlas (default ~1536x1536 pixels).

**Format:** RGB565 (16-bit, 5 bits red, 6 bits green, 5 bits blue).
Uploaded with `gl.UNSIGNED_SHORT_5_6_5`. This halves GPU memory compared
to RGBA8 while being sufficient for the original game's terrain art.

**Slot-based packing:** The atlas is divided into horizontal slots of
fixed height. `reserve(width, height)` finds or creates a slot with
matching height and appends the image. Each reservation returns a
`TextureMapImage` wrapper that supports `copyFrom()` to blit pixel data
from decoded source images.

**Initialization:** On startup, the atlas is filled with magenta
(`0xF81F`) as a visible error marker. Then terrain textures are copied in.

### Terrain texture sources

Textures come from the original Settlers 4 file `2.gh6`, parsed by
`GhFileReader` (`src/resources/gfx/gh-file-reader.ts`). The reader
extracts a `GfxImage16Bit` -- a raw 16-bit image -- which is sliced into
individual terrain tiles.

`LandscapeTextureMap` (`src/game/renderer/landscape/textures/landscape-texture-map.ts`)
maps every possible terrain-type combination to a position in the atlas:

| Texture class | Size | Purpose |
|---------------|------|---------|
| `BigLandscapeTexture` | 256x256 | Solid terrain (grass, rock, desert, ...) |
| `Hexagon2Texture` | 64x64 | Transition between two terrain types |
| `Hexagon3Texture` | 64x64 | Three-way terrain corner |
| `SmallLandscapeTexture` | 128x128 | Water and small tiles |

A lookup table keyed by `(t1 << 16 | t2 << 8 | t3)` maps any three
terrain-type corners of a triangle to the correct atlas region.

### Procedural fallback

When the original game files are not available (e.g. in tests or demo
mode), `fillProceduralColors()` writes 12 distinct solid colours into
the atlas so every terrain type is visually distinguishable without any
file I/O.

### Data textures

`ShaderDataTexture` (`src/game/renderer/shader-data-texture.ts`) wraps a
CPU-side `Uint8Array` with `update(x, y, r, g, b, a)` and a `create()`
method that uploads to the GPU. It supports 1, 2, or 4 channel formats
(R8, RG8, RGBA8). After the initial upload, subsequent calls rebind the
existing texture without re-uploading.

---

## 9. Tile Picking (Screen to Tile)

`TilePicker` (`src/game/input/tile-picker.ts`) converts a canvas pixel
coordinate into a tile coordinate. The inverse of the rendering
projection is not trivial because of the height-dependent Y offset.

### Algorithm

1. **Screen to NDC:**
   ```
   ndcX = (pixelX / canvasWidth) * 2 - 1
   ndcY = 1 - (pixelY / canvasHeight) * 2
   ```

2. **NDC to world:** Reverse the orthographic projection and zoom:
   ```
   worldX = (ndcX + zoom) * aspect / zoom
   worldY = (zoom - ndcY) / zoom
   ```

3. **World to tile (first pass):** Reverse the parallelogram transform,
   ignoring height:
   ```
   tileY = round(worldY * 2 + viewPointY)
   tileX = round(worldX - floor(tileY / 2) + viewPointX + worldY)
   ```

4. **Height correction:** Sample the terrain height at the candidate tile,
   apply the same `* 20 / 255` scaling the vertex shader uses, and
   repeat the Y and X calculation with the height offset. This second
   pass corrects for the visual displacement of elevated terrain.

5. **Map wrapping:** Tile coordinates are wrapped into `[0, mapWidth)` and
   `[0, mapHeight)` with modular arithmetic.

### Tile to world (reverse)

`TilePicker.tileToWorld()` converts a tile coordinate back to world
space, used by the entity renderer to position quads. It applies the
same parallelogram transform and height offset as the vertex shader:

```
instX = tileX + floor(tileY / 2) - viewPointX
instY = tileY - viewPointY
worldX = instX + 0.25 - instY * 0.5
worldY = (instY + 0.5 - heightScaled) * 0.5
```

The `+0.25` and `+0.5` offsets centre the point within the parallelogram
cell.

---

## 10. Performance Techniques

The renderer uses several practical optimisations:

### GPU instancing (landscape)

The entire terrain is drawn with a single `drawArraysInstanced()` call.
6 base vertices are expanded across thousands of instances. The only
per-instance data is a 2-component `Int16Array` of tile positions.

### Buffer caching

`ShaderProgram.setAttribute()` reuses WebGL buffer objects across frames
via a `Map<string, WebGLBuffer>` keyed by attribute name. This avoids
GPU memory allocation churn.

### Instance position caching

`LandscapeRenderer.getInstancePosArray()` caches the instance position
array and only reallocates when map dimensions change.

### VAO caching

A single VAO per shader program captures all attribute bindings. Calling
`use()` rebinds the VAO, restoring attribute state without individual
`vertexAttribPointer` calls.

### Territory border caching

`EntityRenderer` caches the list of border tiles and only recomputes it
when `territoryVersion` increments.

### Vertex buffer reuse (entities)

A single `Float32Array` is reused for every entity quad, filled
in-place and re-uploaded with `DYNAMIC_DRAW`. No per-entity allocation.

### Data texture upload once

`ShaderDataTexture.create()` only calls `texImage2D` on the first
invocation. Subsequent calls rebind the texture without re-uploading
unless the data has changed.

---

## 11. Key Files Reference

### Core renderer

| File | Lines | Purpose |
|------|-------|---------|
| `src/game/renderer/renderer.ts` | ~130 | WebGL context, draw loop, sub-renderer orchestration |
| `src/game/renderer/renderer-base.ts` | ~25 | Shared shader init and projection uniform setup |
| `src/game/renderer/i-renderer.ts` | ~6 | `IRenderer` interface (`init`, `draw`) |
| `src/game/renderer/view-point.ts` | ~130 | Camera position, zoom, mouse drag/scroll |
| `src/game/renderer/shader-program.ts` | ~255 | GLSL compile/link, attribute/uniform helpers |

### Landscape

| File | Lines | Purpose |
|------|-------|---------|
| `src/game/renderer/landscape/landscape-renderer.ts` | ~260 | Instanced terrain drawing |
| `src/game/renderer/landscape/shaders/landscape-vert.glsl` | ~183 | Vertex shader (parallelogram projection, height, texture lookup) |
| `src/game/renderer/landscape/shaders/landscape-frag.glsl` | ~33 | Fragment shader (texture sample + shading) |
| `src/game/renderer/landscape/landscape-type.ts` | ~42 | `LandscapeType` enum (Grass, Water, Rock, ...) |
| `src/game/renderer/landscape/matrix.ts` | ~81 | 4x4 matrix math (orthographic, translate, scale) |
| `src/game/renderer/landscape/textures/landscape-texture-map.ts` | ~250 | Terrain type to atlas coordinate lookup |
| `src/game/renderer/landscape/textures/big-landscape-texture.ts` | ~54 | 256x256 solid terrain tiles |
| `src/game/renderer/landscape/textures/hexagon-2-texture.ts` | ~87 | Two-terrain transition tiles |

### Entities

| File | Lines | Purpose |
|------|-------|---------|
| `src/game/renderer/entity-renderer.ts` | ~315 | Units, buildings, selection, paths, territory borders, placement preview |
| `src/game/renderer/shaders/entity-vert.glsl` | ~18 | Vertex shader (scale + offset + projection) |
| `src/game/renderer/shaders/entity-frag.glsl` | ~9 | Fragment shader (color pass-through) |

### Textures

| File | Lines | Purpose |
|------|-------|---------|
| `src/game/renderer/texture-manager.ts` | ~20 | Texture unit allocator |
| `src/game/renderer/texture-map-16bit.ts` | ~180 | RGB565 texture atlas with slot packing |
| `src/game/renderer/shader-data-texture.ts` | ~91 | CPU-to-GPU data texture wrapper |
| `src/game/renderer/shader-texture.ts` | ~40 | Base texture bind/activate helper |

### Input

| File | Lines | Purpose |
|------|-------|---------|
| `src/game/input/tile-picker.ts` | ~150 | Screen-to-tile and tile-to-world conversions |

### Asset loading (feeds into textures)

| File | Purpose |
|------|---------|
| `src/resources/gfx/gh-file-reader.ts` | Parses `.gh5`/`.gh6` landscape texture files |
| `src/resources/gfx/gfx-image-16bit.ts` | Decodes RGB565 image data |
| `src/resources/gfx/gfx-file-reader.ts` | Parses `.gfx` sprite files (JIL/DIL/GIL pipeline) |
| `src/resources/gfx/palette.ts` | 256-colour palette (RGB and RGB565 variants) |
| `src/resources/file/binary-reader.ts` | Low-level binary file reading |
