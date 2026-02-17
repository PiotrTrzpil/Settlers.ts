# Visual Quality Improvements Analysis

> Analysis date: February 2026

## Executive Summary

This document explores visual quality enhancements for Settlers.ts, focusing on perceived visual improvements rather than raw performance. The codebase has a solid WebGL2 foundation but underutilizes many capabilities for visual polish.

---

## Current Visual State

### What's Implemented Well
- Palettized sprite rendering with per-player tinting
- Direction transition blending for smooth unit turns
- Smooth unit movement interpolation
- Selection highlights (tinting, path dots, footprints)
- Height-based terrain shading
- Layer visibility toggles

### What's Missing
- No post-processing pipeline
- No dynamic lighting or shadows
- No water animation
- No particle effects
- No fog of war
- Static, flat visuals

---

## Part 1: Quick Wins (WebGL2, 1-2 weeks each)

### 1.1 Animated Water Tiles

**Current:** Static blue hexagon tiles
**Improvement:** Scrolling caustics + wave distortion

```glsl
// Water fragment shader addition
uniform float u_time;
uniform sampler2D u_caustics;

vec2 waveOffset = vec2(
    sin(v_worldPos.x * 0.1 + u_time) * 0.02,
    cos(v_worldPos.y * 0.1 + u_time * 0.7) * 0.02
);
vec3 caustics = texture(u_caustics, v_uv * 2.0 + u_time * 0.05).rgb;
finalColor.rgb += caustics * 0.15;
finalColor.rgb = mix(finalColor.rgb, vec3(0.2, 0.4, 0.6), 0.1); // Tint
```

**Visual impact:** High - water is prominent in maps
**Effort:** Low - shader-only change

### 1.2 Drop Shadows Under Entities

**Current:** Entities float on terrain
**Improvement:** Soft oval shadows beneath units/buildings

```glsl
// Render shadow pass before entities
// Simple blob shadow (ellipse with soft falloff)
float shadowAlpha = smoothstep(1.0, 0.3, length(v_shadowUV));
gl_FragColor = vec4(0.0, 0.0, 0.0, shadowAlpha * 0.3);
```

**Visual impact:** High - adds depth and grounding
**Effort:** Low - separate shadow batch pass

### 1.3 Color Grading / Time of Day Tint

**Current:** Fixed colors
**Improvement:** Full-screen color adjustment

| Time | Tint | Mood |
|------|------|------|
| Dawn | Warm orange | `vec3(1.1, 0.95, 0.85)` |
| Noon | Neutral | `vec3(1.0, 1.0, 1.0)` |
| Dusk | Purple/pink | `vec3(1.0, 0.9, 1.05)` |
| Night | Cool blue | `vec3(0.8, 0.85, 1.1)` |

**Visual impact:** Medium-High - completely changes atmosphere
**Effort:** Very Low - multiply final color

### 1.4 Vignette Effect

**Current:** Flat screen edges
**Improvement:** Subtle darkening at corners

```glsl
vec2 uv = gl_FragCoord.xy / u_resolution;
float vignette = 1.0 - smoothstep(0.4, 0.9, length(uv - 0.5));
finalColor.rgb *= mix(1.0, vignette, 0.3);
```

**Visual impact:** Medium - cinematic feel
**Effort:** Very Low

### 1.5 Improved Selection Effects

**Current:** Tint multiplier + dots
**Improvement:** Animated glow outline + pulsing

- Outline shader using sobel edge detection
- Pulsing brightness (`1.0 + sin(time * 3.0) * 0.15`)
- Range circle for military units
- Health bar floating above

**Visual impact:** High - core gameplay feedback
**Effort:** Low-Medium

---

## Part 2: Medium Effort (2-4 weeks each)

### 2.1 Particle System

**Missing effects that would add life:**

| Effect | Trigger | Visual |
|--------|---------|--------|
| Chimney smoke | Active production buildings | Rising gray wisps |
| Dust clouds | Unit movement on dirt/sand | Brown puffs at feet |
| Wood chips | Woodcutter working | Flying fragments |
| Sparks | Blacksmith/smelter | Orange embers |
| Water splash | Fisher/dock activity | Blue droplets |
| Leaves | Wind + trees | Drifting green/brown |
| Fire | Burning buildings, torches | Animated flames |
| Blood/impact | Combat | Red splatter |

**Implementation approach:**
- GPU-instanced particle renderer
- Per-particle: position, velocity, life, size, color, texture
- Compute shader for physics (WebGPU) or CPU update (WebGL2)
- ~1000-5000 particles budget

**Visual impact:** Very High - brings world to life
**Effort:** Medium (need particle system architecture)

### 2.2 Dynamic Lighting

**Approach 1: Simple directional light**
```glsl
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_ambientStrength;

vec3 normal = vec3(0.0, 0.0, 1.0); // Flat for 2D sprites
float diff = max(dot(normal, u_lightDir), 0.0);
vec3 lighting = u_ambientStrength + diff * u_lightColor;
finalColor.rgb *= lighting;
```

**Approach 2: Point lights (torches, fires)**
- Light accumulation buffer
- Per-light: position, radius, color, intensity
- Max 8-16 active lights
- Soft falloff: `1.0 / (1.0 + dist * dist * attenuation)`

**Visual impact:** Very High - transforms flat look
**Effort:** Medium

### 2.3 Fog of War

**Layers:**
1. **Unexplored** (black) - never seen
2. **Explored** (dimmed) - seen before but not visible now
3. **Visible** (full) - currently in unit sight range

**Rendering:**
- Visibility texture (per-tile byte: 0=unexplored, 1=explored, 2=visible)
- Blur/feather edges for smooth transitions
- Animated "lifting" effect when exploring

```glsl
float visibility = texture(u_fogMap, v_tileUV).r;
float fog = smoothstep(0.0, 0.5, visibility);
finalColor.rgb = mix(vec3(0.0), finalColor.rgb, fog);
finalColor.rgb *= 0.3 + visibility * 0.7; // Explored areas dimmer
```

**Visual impact:** Very High - adds mystery and strategy
**Effort:** Medium (needs game logic integration)

### 2.4 Screen-Space Ambient Occlusion (SSAO)

**For 2D isometric:** Simplified approach using depth proxy

- Use entity Y-position as depth
- Darken areas where entities cluster
- Subtle effect in corners of buildings

**Visual impact:** Medium - adds subtle depth
**Effort:** Medium

---

## Part 3: Advanced Effects (4-8 weeks each)

### 3.1 Water Reflections

**Technique:** Render reflected scene to texture, sample with distortion

```glsl
// Reflection pass: flip Y, render terrain/buildings
// Water fragment:
vec2 reflectUV = vec2(v_screenUV.x, 1.0 - v_screenUV.y);
reflectUV += waveDistortion * 0.02;
vec3 reflection = texture(u_reflectionTex, reflectUV).rgb;
finalColor.rgb = mix(waterColor, reflection, 0.3);
```

**Considerations:**
- Only reflect terrain and buildings (not units for perf)
- Fresnel effect for realistic angle-based reflection
- Can be low-res (half resolution)

**Visual impact:** Very High - premium visual quality
**Effort:** High

### 3.2 Bloom / Glow Effects

**Use cases:**
- Fire and torches glow
- Selected units subtle glow
- Magic/special effects
- Sun glare on water

**Implementation:**
1. Render bright areas to separate buffer (threshold)
2. Gaussian blur (separable, 2-pass)
3. Additive blend with scene

**Visual impact:** High - modern game feel
**Effort:** Medium-High

### 3.3 Weather Effects

| Weather | Visual Components |
|---------|-------------------|
| **Rain** | Falling streaks, ripples on water, darker tint |
| **Snow** | Falling flakes, accumulation on roofs, white tint |
| **Fog** | Distance fade, reduced contrast |
| **Storm** | Lightning flashes, heavy rain, camera shake |

**Visual impact:** Very High - atmospheric immersion
**Effort:** High (particle system + post-processing)

### 3.4 God Rays / Light Shafts

**For dawn/dusk atmosphere:**
- Radial blur from sun position
- Sample depth to create occlusion
- Additive blend

**Visual impact:** High - cinematic beauty
**Effort:** High

---

## Part 4: Upscaling & Anti-Aliasing

### 4.1 Pixel Art Upscaling

**Problem:** Original sprites are low-res, can look jagged when zoomed

**Solutions:**

| Algorithm | Quality | Performance | Browser Support |
|-----------|---------|-------------|-----------------|
| Bilinear | Low | Fast | Native |
| xBR | High | Medium | Shader |
| HQx | High | Medium | Shader |
| Neural (ESRGAN) | Excellent | Slow | WebGL compute |

**Recommendation:** xBR shader for sprite upscaling
- Preserves pixel art edges
- Smooths diagonals
- Works in fragment shader

### 4.2 Temporal Anti-Aliasing (TAA)

**Benefits:**
- Smooths edges across frames
- Reduces shimmer on fine details
- Perceived smoother motion

**Implementation:**
- Store previous frame
- Reproject using motion vectors
- Blend with current frame (typically 90% history, 10% current)
- Neighborhood clamping to reduce ghosting

**Visual impact:** High - polished, smooth look
**Effort:** Medium-High

### 4.3 FXAA (Fast Approximate AA)

**Simpler alternative to TAA:**
- Single-pass post-process
- Edge detection + smart blur
- Good results for low cost

**Visual impact:** Medium
**Effort:** Low (well-documented shader)

---

## Part 5: WebGPU-Specific Enhancements

With WebGPU (when migrating), these become more feasible:

### 5.1 Compute-Based Particles
- 10,000+ particles with physics
- GPU collision detection
- Fluid simulation for water/smoke

### 5.2 Screen-Space Reflections (SSR)
- Ray marching in screen space
- More accurate than planar reflection
- Works for any reflective surface

### 5.3 Neural Upscaling
- Run small ML model in compute shader
- Better than traditional algorithms
- Could match FSR/XeSS quality

### 5.4 Order-Independent Transparency
- Correct blending for overlapping transparent objects
- No sorting required
- Per-pixel linked lists

---

## Implementation Priority Matrix

| Effect | Visual Impact | Effort | Priority |
|--------|---------------|--------|----------|
| Water animation | High | Low | **P0** |
| Drop shadows | High | Low | **P0** |
| Color grading | High | Very Low | **P0** |
| Particle system | Very High | Medium | **P1** |
| Dynamic lighting | Very High | Medium | **P1** |
| Fog of war | Very High | Medium | **P1** |
| Selection glow | High | Low | **P1** |
| Vignette | Medium | Very Low | **P2** |
| FXAA | Medium | Low | **P2** |
| Bloom | High | Medium | **P2** |
| Water reflections | Very High | High | **P3** |
| Weather | Very High | High | **P3** |
| TAA | High | Medium-High | **P3** |

---

## Quick Start: Minimal Post-Processing Pipeline

To add a post-processing pipeline:

1. **Create framebuffer** for scene rendering
2. **Render scene** to texture instead of screen
3. **Full-screen quad** with post-process shader
4. **Chain effects**: Scene → Color Grade → Vignette → FXAA → Screen

```typescript
// Pseudo-code structure
class PostProcessPipeline {
  private sceneFramebuffer: WebGLFramebuffer;
  private postProcessShader: ShaderProgram;

  render(scene: () => void) {
    // 1. Render scene to texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);
    scene();

    // 2. Render full-screen quad with effects
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.postProcessShader.use();
    this.postProcessShader.setFloat('u_time', performance.now() / 1000);
    this.postProcessShader.setVec3('u_colorGrade', this.timeOfDayTint);
    this.drawFullScreenQuad();
  }
}
```

---

---

## Part 6: Sharpness, Upscaling & Perceived Resolution

### Current State

- Sprites are low-res pixel art (original Settlers 4 assets)
- 4 directions only (D0=right, D1=down-right, D2=down-left, D3=left)
- Direction blending shader exists (`entity-sprite-blend-frag.glsl`) - blends between adjacent directions
- No post-process sharpening or upscaling

### 6.1 Contrast Adaptive Sharpening (CAS)

[AMD FidelityFX CAS](https://gpuopen.com/fidelityfx-cas/) is ideal for this use case:

**Benefits:**
- Sharpens soft areas more, already-sharp edges less
- Restores detail lost by TAA or bilinear filtering
- Very low overhead (~0.5ms)
- Can upscale AND sharpen in single pass

**WebGL Implementation:**
```glsl
// Simplified CAS shader (full version at GPUOpen)
uniform sampler2D u_scene;
uniform float u_sharpness; // 0.0 - 1.0

vec3 cas(vec2 uv, vec2 texelSize) {
    vec3 center = texture(u_scene, uv).rgb;

    // Sample neighbors
    vec3 up    = texture(u_scene, uv + vec2(0, -texelSize.y)).rgb;
    vec3 down  = texture(u_scene, uv + vec2(0,  texelSize.y)).rgb;
    vec3 left  = texture(u_scene, uv + vec2(-texelSize.x, 0)).rgb;
    vec3 right = texture(u_scene, uv + vec2( texelSize.x, 0)).rgb;

    // Compute local contrast
    vec3 minRGB = min(center, min(min(up, down), min(left, right)));
    vec3 maxRGB = max(center, max(max(up, down), max(left, right)));

    // Adaptive sharpening weight
    vec3 weight = sqrt(min(minRGB, 1.0 - maxRGB) / maxRGB);
    weight *= -1.0 / (8.0 * mix(0.125, 0.25, u_sharpness) - 1.0);

    // Apply sharpening
    return (center + (up + down + left + right) * weight) / (1.0 + 4.0 * weight);
}
```

**Visual impact:** High - crisp, detailed sprites without halos
**Effort:** Low - single post-process pass

### 6.2 Neural Upscaling (Real-ESRGAN in Browser)

[web-realesrgan](https://github.com/xororz/web-realesrgan) runs Real-ESRGAN/Real-CUGAN in browser via TensorFlow.js:

**Options:**

| Approach | When | Performance |
|----------|------|-------------|
| **Pre-process assets** | Build time | No runtime cost |
| **Runtime upscale** | On sprite load | ~50-200ms per sprite |
| **WebGPU compute** | Per-frame (experimental) | Too slow currently |

**Recommendation:** Pre-upscale sprite atlases at build time
- Run Real-CUGAN 2× on original sprites
- Ship higher-res atlases
- No runtime overhead
- Can use anime-tuned models for pixel art

**Visual impact:** Very High - sprites look native HD
**Effort:** Medium (asset pipeline change)

### 6.3 Pixel Art Upscaling Shaders

For runtime upscaling without neural networks:

| Algorithm | Quality | Use Case |
|-----------|---------|----------|
| **xBR** | Excellent | Best for pixel art, preserves edges |
| **HQx** | Good | Classic, widely used |
| **Nearest** | Authentic | Retro look, sharp pixels |
| **Bilinear** | Blurry | Avoid for pixel art |

**xBR Shader** (simplified):
```glsl
// xBR detects edges and interpolates along them
// Full implementation: https://github.com/libretro/glsl-shaders/tree/master/xbr
// Preserves pixel art edges while smoothing diagonals
```

**Visual impact:** High for zoomed views
**Effort:** Medium (complex shader)

### 6.4 Subpixel Rendering

For extremely sharp text and UI:

- Use LCD subpixel layout (RGB stripes)
- Triple horizontal resolution for fonts
- Reduces apparent aliasing by 3×

**Note:** Only works for static UI, not sprites

---

## Part 7: AI Frame Generation for Animation

### The Opportunity

Currently settlers have only **4 directions** and **limited animation frames**. AI can generate:

1. **Intermediate directions** (4 → 8 or 16 directions)
2. **Intermediate animation frames** (smoother walk cycles)
3. **Direction transition frames** (instead of blending two sprites)

### 7.1 Optical Flow Interpolation (Bitmapflow)

[Bitmapflow](https://github.com/Bauxitedev/bitmapflow) generates in-between frames using optical flow:

**How it works:**
1. Takes two keyframes (e.g., direction D0 and D1)
2. Computes pixel motion vectors
3. Generates intermediate frame(s)

**Pros:**
- Works offline (build-time asset generation)
- No neural network required
- Good for simple motion

**Cons:**
- Can cause "morphing" artifacts on limbs
- Struggles with complex sprite changes
- May need artist cleanup

**Use case:** Generate 8 directions from 4:
```
D0 (right) ──[interpolate]──> D0.5 ──> D1 (down-right)
```

### 7.2 Neural Frame Interpolation

More advanced approaches use neural networks:

**[FILM (Frame Interpolation for Large Motion)](https://film-net.github.io/):**
- Google's state-of-the-art frame interpolation
- Handles large motion well
- Can run in browser via TensorFlow.js

**[RIFE (Real-Time Intermediate Flow Estimation)](https://github.com/megvii-research/ECCV2022-RIFE):**
- Very fast (~30ms per frame on GPU)
- Good for real-time or batch processing

**Use case:** Double animation frames:
```
Walk frame 1 ──[RIFE]──> frame 1.5 ──> Walk frame 2
(8 frames → 16 frames = smoother animation)
```

### 7.3 Sprite-Specific Neural Networks

Research systems designed for game sprites:

**[MarioNette](https://proceedings.neurips.cc/paper/2021/file/2bcab9d935d219641434683dd9d18a03-Paper.pdf):**
- Disentangles sprite, motion, and background
- Can transfer motion between sprites
- MIT research paper

**[Motion Mapper](https://www.deeplearning.ai/the-batch/motion-mapper/):**
- AI system for automated sprite animations
- Uses separate networks for sprite, motion, effects
- Can generate new frames from two reference frames

### 7.4 Implementation Strategy

**Phase 1: Build-Time Generation (Recommended)**
```
Original assets (4 directions, 8 frames)
        ↓
[Bitmapflow / RIFE interpolation]
        ↓
Enhanced assets (8 directions, 16 frames)
        ↓
Ship with game
```

**Benefits:**
- No runtime cost
- Can manually fix artifacts
- Deterministic results

**Phase 2: Runtime Blending Enhancement**

Current blend shader already mixes two directions. Enhance it:

```glsl
// Instead of simple linear blend:
vec4 blended = mix(color1, color2, v_blend);

// Use motion-aware blending:
vec2 motion = estimateMotion(v_texcoord1, v_texcoord2);
vec2 warpedUV1 = v_texcoord1.xy + motion * (1.0 - v_blend);
vec2 warpedUV2 = v_texcoord2.xy - motion * v_blend;
vec4 warped1 = resolveIndex(texture(u_spriteAtlas, vec3(warpedUV1, v_texcoord1.z)).r);
vec4 warped2 = resolveIndex(texture(u_spriteAtlas, vec3(warpedUV2, v_texcoord2.z)).r);
vec4 blended = mix(warped1, warped2, v_blend);
```

**Phase 3: Real-Time Neural Interpolation (Future)**

When WebGPU compute is mature:
- Small RIFE model in compute shader
- Generate intermediate frames on-demand
- Could work for 60fps target with 30fps source animations

### 7.5 Direction Expansion: 4 → 8 Directions

**Current system:**
```
      D3 (left)     D0 (right)
           \         /
            \       /
     D2 (down-left) D1 (down-right)
```

**With interpolation:**
```
        D7 (up-left)   D0 (up-right)
               \         /
      D6 (left)    ·    D1 (right)
               /         \
        D5 (down-left) D2 (down-right)
              \         /
               D4 (down)   D3 (down)
```

**Implementation:**
1. Generate D0.5, D1.5, D2.5, D3.5 offline using RIFE/Bitmapflow
2. Update animation system to use 8 directions
3. Existing blend shader handles transitions

### 7.6 Comparison: Build-Time vs Runtime

| Approach | Visual Quality | Performance | Flexibility |
|----------|---------------|-------------|-------------|
| **Build-time interpolation** | Excellent (can fix artifacts) | Zero runtime cost | Static |
| **Runtime blend shader** | Good (current) | Fast | Flexible |
| **Runtime neural interp** | Excellent | Expensive | Most flexible |

**Recommendation:** Start with build-time generation for direction expansion, keep runtime blend shader for transitions.

---

## Part 8: Complete Post-Processing Pipeline

### Recommended Order

```
Scene Render
    ↓
[Fog of War overlay]
    ↓
[SSAO] (optional)
    ↓
[Bloom extraction + blur]
    ↓
[Color Grading / Time of Day]
    ↓
[CAS Sharpening]
    ↓
[FXAA or TAA]
    ↓
[Vignette]
    ↓
[Film Grain] (optional)
    ↓
Final Output
```

### Minimal Viable Pipeline (Quick Start)

For immediate visual improvement with minimal effort:

```
Scene → Color Grade → CAS Sharpen → Vignette → Output
```

**Total additional cost:** ~1-2ms
**Visual improvement:** Significant

---

## Appendix A: Reference Games for Visual Style

- **Northgard** - Modern isometric RTS with excellent lighting
- **They Are Billions** - Detailed sprites with atmospheric effects
- **Frostpunk** - Particle effects and weather done right
- **Age of Empires 2 DE** - Classic sprites with modern polish
- **Factorio** - Clean visual feedback systems

## Appendix B: Resources

- [Isometric Lighting Tutorial](https://screamingbrainstudios.com/isometric-lighting/)
- [2D Lighting in Games](https://www.postphysical.io/blog/2d-environment-lighting-series-part1)
- [Pixel Art Scaling Algorithms](https://en.wikipedia.org/wiki/Pixel-art_scaling_algorithms)
- [WebGL Post-Processing](https://webplatform.github.io/docs/tutorials/post-processing_with_webgl/)
- [Orillusion WebGPU Effects](https://www.orillusion.com/en/guide/)
