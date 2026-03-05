# Design: Entity Visual System

## Problem

Entity appearance is controlled by three independent mechanisms with no coordination:

| Mechanism | Owner | What it controls |
|-----------|-------|-----------------|
| `entity.variation` | Domain systems (TreeSystem, StoneSystem, CropSystem) | Static sprite selection (growth stage, depletion level) |
| `AnimationService` state | Task system, domain systems, combat | Animated sprite (walk cycle, sway, work animation) |
| `BuildingOverlayManager` | Building system | Additional sprite layers (smoke, wheels, flags) |

The renderer silently prioritises animation over variation. When an `AnimationState` exists (even stopped/stale), `getAnimatedSprite()` returns the animation frame and uses `animatedEntry.staticSprite` as fallback — the variation-specific sprite is discarded. This caused the tree-cutting bug: sway animation kept overriding cutting-stage sprites because nobody cleared it.

The root cause is **dual ownership with implicit priority** — two systems write, one reads, and the reader picks a winner the writers don't know about.

## Goals

1. **Single source of truth** per entity for "what should this look like"
2. **Atomic visual transitions** — changing stage + clearing animation is one call, not two
3. **Correct fallback** — animation that can't resolve falls through to variation, not to a hardcoded static sprite
4. **Cover all entity types** — units, map objects, buildings (with overlay layers), resources
5. **Easy API** — domain systems express intent, not rendering mechanics

## All entity visual behaviours

Before designing, inventory every visual pattern in the game:

### Units (settlers, military)
```
Visual = animation(sequenceKey, direction, frame) with static fallback(unitType, direction, race)

Dimensions:
  - sequenceKey: 'default', 'walk', 'carry_N', 'work.0', 'fight.N', level variants ('default.2', 'walk.3')
  - direction: 0-5 (hex directions)
  - race: Roman/Viking/Mayan/DarkTribe/Trojan (determines sprite file)
  - level: 1-3 (military only — selects sequence variant)
  - carrying: material type (selects carry_N sequence)
  - directionTransition: blend old→new direction sprites during turns

Always animated. Animation drives appearance. Static sprite is a fallback only.
```

### Trees
```
Visual = variation(variant × 11 + stageOffset)
         + optional animation('default', direction=variant) when Normal

Stages: Growing(3 sprites) → Normal(1 sprite + sway anim) → Cutting(7 sprites) → Cut(stump) → removed
Variants: 0-N per tree type (random on creation)

Mostly static. Animation only during Normal stage (looping sway).
Key transition: Normal→Cutting must atomically stop sway and switch to cutting sprite.
```

### Crops (grain, sunflower, agave, beehive)
```
Visual = variation(stageOffset)
         + optional animation('default') when Mature

Stages: Growing(N sprites) → Mature(1 sprite + bloom anim) → Harvesting → Harvested(1 sprite) → removed

Same pattern as trees: static with optional animation at one stage.
```

### Stones
```
Visual = variation(variant × 13 + depletionLevel)

Always static. No animation. 2 variants × 13 depletion levels.
```

### Buildings
```
Main sprite: construction sprite OR completed sprite (boolean flag)
  + verticalProgress (0-1, controls sprite clipping during rise)
  + optional animation ('default' sequence for windmills etc.)

Overlay layers (0-N per building, each independent):
  - Layer position: BehindBuilding / AboveBuilding / Flag / AboveFlag
  - Condition: always / working / idle
  - Independent animation timing (own elapsedMs, frameDuration, loop flag)
  - Pixel offset from building origin
  - Optional team coloring

Special: flags computed from performance.now() at 12fps, not managed by overlay timer.
```

### Stacked resources
```
Visual = getResource(materialType, direction=quantity-1)

Static. Quantity (1-8) maps to direction index. No animation, no variation.
```

### Flags / Territory dots
```
Flags: animated (24 frames × 8 player colors), managed by DecorationSpriteCategory
Territory dots: static (1 sprite × 8 player colors)

Not managed by entity visual system — rendered by dedicated passes.
```

---

## Design

### Core type: `EntityVisualState`

One struct per entity. Owns both the static sprite selection and the optional animation overlay.

```typescript
interface EntityVisualState {
  /** Static sprite index. Always set. Renderer uses this when animation is null or can't resolve. */
  variation: number;

  /** Active animation, or null for static-only entities. */
  animation: AnimationPlayback | null;
}

interface AnimationPlayback {
  sequenceKey: string;
  direction: number;
  currentFrame: number;
  elapsedMs: number;
  loop: boolean;
  playing: boolean;
}

/** Unit-only: smooth direction change. Stored separately because most entities never use it. */
interface DirectionTransition {
  previousDirection: number;
  progress: number;   // 0.0 = old direction, 1.0 = new direction
}
```

**Why `animation: ... | null` instead of a flag?**
- `null` means "no animation state exists" — renderer skips animation lookup entirely
- No stale state can leak through: clearing animation removes it, not just pauses it
- Type system enforces that you check for null before reading animation fields

### Service: `EntityVisualService`

Replaces `AnimationService`. Single owner of all `EntityVisualState` instances.

```typescript
class EntityVisualService {
  private states = new Map<number, EntityVisualState>();
  private transitions = new Map<number, DirectionTransition>();  // sparse, units only

  // ── Lifecycle ────────────────────────────────────────────────

  /** Create visual state for a new entity. */
  init(entityId: number, variation?: number): void;

  /** Remove all visual state for a destroyed entity. */
  remove(entityId: number): void;

  // ── Static sprite (variation) ────────────────────────────────

  /** Change static sprite selection. Does NOT touch animation. */
  setVariation(entityId: number, variation: number): void;

  // ── Animation ────────────────────────────────────────────────

  /** Start or update an animation. Does NOT touch variation. */
  play(entityId: number, sequenceKey: string, opts?: {
    loop?: boolean;
    direction?: number;
    startFrame?: number;
  }): void;

  /** Clear animation entirely — renderer falls back to variation. */
  clearAnimation(entityId: number): void;

  /** Update animation direction without changing sequence. */
  setDirection(entityId: number, direction: number): void;

  // ── Atomic combined operations ───────────────────────────────
  // These prevent the bug class where variation and animation are
  // changed in separate calls with a render frame in between.

  /** Set variation AND clear animation. One call. No stale animation possible.
   *  Use when: tree enters cutting, crop enters harvested, any static stage. */
  setStatic(entityId: number, variation: number): void;

  /** Set variation AND start animation. One call.
   *  Use when: tree enters Normal (sway), crop enters Mature (bloom). */
  setAnimated(entityId: number, variation: number, sequenceKey: string, opts?: PlayOptions): void;

  // ── Intent API (task system) ─────────────────────────────────

  /** Apply a resolved animation intent (from AnimationResolver).
   *  Used by IdleAnimationController, combat system, etc. */
  applyIntent(entityId: number, intent: AnimationIntent): void;

  // ── Direction transitions (units only) ───────────────────────

  startDirectionTransition(entityId: number, from: number, to: number): void;
  updateDirectionTransition(entityId: number, progress: number): void;
  clearDirectionTransition(entityId: number): void;
  getDirectionTransition(entityId: number): DirectionTransition | null;

  // ── Query ────────────────────────────────────────────────────

  getState(entityId: number): EntityVisualState | null;

  // ── Frame tick ───────────────────────────────────────────────

  /** Advance all playing animations by deltaMs. Called once per frame. */
  update(deltaMs: number): void;
}
```

### API usage by entity type

```typescript
// ─── Trees ──────────────────────────────────────────────────────
// Normal stage: animated sway
visualService.setAnimated(treeId, normalVariation, 'default', {
  loop: true, direction: variant
});

// Start cutting: atomic switch to static cutting sprite
visualService.setStatic(treeId, cuttingVariation);

// Cutting progress updates: just change variation (no animation involved)
visualService.setVariation(treeId, fallingVariation);
visualService.setVariation(treeId, cutting1Variation);
// ...

// Cancel cutting: back to animated sway
visualService.setAnimated(treeId, normalVariation, 'default', {
  loop: true, direction: variant
});


// ─── Crops ──────────────────────────────────────────────────────
// Same pattern as trees
visualService.setAnimated(cropId, matureVariation, 'default', { loop: true });
visualService.setStatic(cropId, harvestedVariation);


// ─── Stones ─────────────────────────────────────────────────────
// Always static — just variation changes
visualService.setVariation(stoneId, newDepletionVariation);


// ─── Units ──────────────────────────────────────────────────────
// Walk
visualService.play(settlerId, 'walk', { loop: true, direction: dir });

// Idle
visualService.applyIntent(settlerId, resolveIdleIntent(entity));

// Carry material
visualService.play(settlerId, carrySequenceKey(material), { loop: true, direction: dir });

// Change direction while walking
visualService.setDirection(settlerId, newDir);

// Direction transition (smooth blend)
visualService.startDirectionTransition(settlerId, oldDir, newDir);
// ... each tick:
visualService.updateDirectionTransition(settlerId, progress);
// ... when done:
visualService.clearDirectionTransition(settlerId);


// ─── Buildings ──────────────────────────────────────────────────
// Completed building with animation (e.g. windmill)
visualService.play(buildingId, 'default', { loop: true });

// Static completed building — no visual service call needed
// (BuildingRenderState handles construction sprite selection separately)
```

### `entity.variation` removal

The `variation` field is removed from the `Entity` type. All reads and writes migrate to `EntityVisualService`.

Domain systems that currently write `entity.variation = X` call `visualService.setVariation(id, X)` or one of the atomic methods.

The renderer reads variation from `visualService.getState(id)` instead of `entity.variation`. When `getState()` returns null (e.g. decorations), the entity is skipped or rendered with a default — this is nullable-by-design at the render boundary.

### Renderer resolution

`EntitySpriteResolver` receives `getVisualState: (id) => EntityVisualState | null` instead of `getAnimState`.

New resolution logic for map objects:

```typescript
private resolveMapObject(entity: Entity): SpriteEntry | null {
  const vs = this.getVisualState(entity.id);
  if (!vs) return null;  // legitimate: entity type not tracked by visual service

  const staticSprite = this.sprites!.getMapObject(entity.subType as MapObjectType, vs.variation);

  if (vs.animation) {
    const entry = this.sprites!.getAnimatedEntity(entity.type, entity.subType, entity.race);
    if (entry) {
      const frame = resolveAnimationFrame(vs.animation, entry.animationData);
      if (frame) return frame;
    }
  }

  return staticSprite;
}
```

Key difference from current code: the fallback is always the **variation-aware static sprite**, never `animatedEntry.staticSprite`. If animation can't resolve (missing sequence, cleared animation), you get the correct variation sprite.

Unit resolution:

```typescript
private resolveUnit(entity: Entity): SpriteResolveResult {
  const vs = this.getVisualState(entity.id);
  if (!vs) return { skip: false, transitioning: false, sprite: null, progress: 1 };

  const transition = this.getDirectionTransition(entity.id);
  if (transition) {
    return { skip: false, transitioning: true, sprite: null, progress: 1 };
  }

  const direction = vs.animation?.direction ?? 0;  // direction defaults to 0 when no animation — OK, this IS a nullable-by-design field
  const staticSprite = this.sprites!.getUnit(entity.subType as UnitType, direction, entity.race);

  if (vs.animation) {
    const entry = this.sprites!.getAnimatedEntity(entity.type, entity.subType, entity.race);
    if (entry) {
      const frame = resolveAnimationFrame(vs.animation, entry.animationData);
      if (frame) return { skip: false, transitioning: false, sprite: frame, progress: 1 };
    }
  }

  return { skip: false, transitioning: false, sprite: staticSprite, progress: 1 };
}
```

### Building overlays — no change

Building overlays stay as-is. They are a **separate rendering concern**: additional sprites drawn at offsets relative to the building, each with independent animation timing and working/idle conditions.

The overlay system is already well-separated:
- `OverlayRegistry` — static definitions from XML
- `BuildingOverlayManager` — runtime state (per-overlay `elapsedMs`, `active` flag)
- `overlay-resolution.ts` — glue layer resolving instances to render data
- `EntitySpritePass` — emits overlay sprites at correct layers

This architecture is sound. Overlays don't interact with `entity.variation` or `AnimationService`, so the visual service refactor doesn't affect them.

The one improvement worth noting: overlay animation uses raw `elapsedMs / frameDurationMs` math while the main animation uses `AnimationPlayback`. These could share the `AnimationPlayback` type for consistency, but it's cosmetic — no bug risk.

### BuildingRenderState — no change

Building construction state (`useConstructionSprite`, `verticalProgress`) stays as a separate pull-model query. It controls which sprite atlas entry to use and how much to clip — fundamentally different from variation-based sprite selection.

Buildings that animate when completed (windmills, etc.) use `visualService.play()` for the main sprite animation. This coexists cleanly with `BuildingRenderState`: the render state selects construction-vs-completed, and the animation state selects the frame within the completed sprite's animation.

---

## Subsystems & parallel implementation plan

### Dependency graph

```
S1: EntityVisualService (new file)
 │
 ├─► S2: Remove entity.variation from Entity type
 ├─► S3: Migrate domain systems (trees, crops, stones, growable base)
 ├─► S4: Migrate animation callers (idle controller, unit state machine, combat)
 └─► S5: Migrate renderer (sprite resolver, render context, blend pass)
      │
      ▼
S6: Delete AnimationService + clean up exports
      │
      ▼
S7: Lint + test
```

S2-S5 are fully parallel (no file overlap).

### S1: EntityVisualService (sequential — foundation)

**Create** `src/game/animation/entity-visual-service.ts`

- `EntityVisualState` and `AnimationPlayback` types
- `DirectionTransition` type
- `EntityVisualService` class with full API
- `update(deltaMs)` frame-advance loop (moved from AnimationService)
- ~180 lines

This subsystem has zero dependencies on existing code except the `AnimationIntent` type (kept).

### S2: Remove `entity.variation` (parallel)

**Files:** `entity.ts`, `raw-object-registry.ts`

| File | Change |
|------|--------|
| `entity.ts` | Remove `variation` property from Entity |
| `raw-object-registry.ts` | Replace `entity.variation = X` with `visualService.setVariation(id, X)` |

### S3: Migrate domain systems (parallel)

**Files:** `growable-system.ts`, `tree-system.ts`, `crop-system.ts`, `stone-system.ts`, `tree-feature.ts`, `crop-feature.ts`, `stone-feature.ts`

| System | Change |
|--------|--------|
| `GrowableSystem` | Constructor takes `EntityVisualService`. `updateVisual()` calls `visualService.setVariation()` instead of `entity.variation = offset`. Remove `animationService` field. |
| `TreeSystem` | `onOffsetChanged()`: NORMAL → `setAnimated()`, other → `setStatic()`. Remove manual `animationService.remove()` in `startCutting()`. |
| `CropSystem` | Same pattern as TreeSystem. Mature → `setAnimated()`, other stages → `setStatic()`. |
| `StoneSystem` | Replace `entity.variation = X` with `visualService.setVariation(id, X)`. No animation involvement. |
| Feature files | Pass `EntityVisualService` instead of `AnimationService` to system constructors. |

### S4: Migrate animation callers (parallel)

**Files:** `idle-animation-controller.ts`, `unit-state-machine.ts`, `combat-system.ts`, `game-services.ts`, `game-loop.ts`

Mechanical renames — these callers only use animation (not variation):

| Caller | Change |
|--------|--------|
| `IdleAnimationController` | `animationService.play/stop/setDirection/applyIntent/getState` → `visualService.play/clearAnimation/setDirection/applyIntent/getState` |
| `UnitStateMachine` | Same renames |
| `CombatSystem` | Same renames |
| `GameServices` | `animationService.remove()` → `visualService.remove()` in cleanup |
| `GameLoop` | `animationService.update(dt)` → `visualService.update(dt)` |

**Note:** `animationService.stop()` (freeze on frame) becomes `clearAnimation()` (remove animation). The old `stop()` left stale state that could override variation — the new API eliminates that by design.

### S5: Migrate renderer (parallel)

**Files:** `entity-sprite-resolver.ts`, `render-context.ts`, `transition-blend-pass.ts`, `render-passes/types.ts`, `animation-helpers.ts`

| File | Change |
|------|--------|
| `render-context.ts` | `getAnimationState` → `getVisualState: (id) => EntityVisualState \| null` |
| `render-passes/types.ts` | `PassContext.getAnimState` → `getVisualState`. Add `getDirectionTransition`. |
| `entity-sprite-resolver.ts` | Constructor takes `getVisualState`. Rewrite `getMapObject()`, `resolveUnit()`, `getAnimated()` per resolution logic above. Read `variation` from visual state, not entity. |
| `animation-helpers.ts` | `getAnimatedSprite` takes `AnimationPlayback` instead of `AnimationState`. Remove `staticSprite` fallback parameter — caller provides fallback. |
| `transition-blend-pass.ts` | Read `DirectionTransition` from `getDirectionTransition()` instead of `AnimationState` fields. |

### S6: Delete AnimationService (sequential — after S2-S5)

- Delete `src/game/animation/animation-service.ts`
- Remove `AnimationState` interface from `src/game/animation.ts` (replaced by `EntityVisualState`)
- Update `src/game/animation/index.ts` exports
- Keep `AnimationIntent`, `AnimationResolver`, `AnimationData`, `AnimationSequence` — these are consumed by `EntityVisualService.applyIntent()` and the sprite metadata system

### S7: Validate (sequential)

```sh
pnpm lint    # Type-check + ESLint
pnpm test:unit
```

---

## Contracts, error handling, and edge cases

### API contracts

Every method follows optimistic programming: required state must exist, violations throw with context.

```typescript
// ── Lifecycle ────────────────────────────────────────────────

init(entityId: number, variation = 0): void {
  if (this.states.has(entityId)) {
    throw new Error(
      `EntityVisualService.init: entity ${entityId} already initialized. ` +
      `Call remove() before re-initializing.`
    );
  }
  this.states.set(entityId, { variation, animation: null });
}

remove(entityId: number): void {
  // Cleanup path — safe to call on non-existent entities (destroy order is not guaranteed)
  this.states.delete(entityId);
  this.transitions.delete(entityId);
}

// ── State access ─────────────────────────────────────────────

/** For domain systems that own the entity — entity MUST have visual state. */
getStateOrThrow(entityId: number, caller: string): EntityVisualState {
  const state = this.states.get(entityId);
  if (!state) {
    throw new Error(
      `EntityVisualService.getStateOrThrow: entity ${entityId} has no visual state ` +
      `(caller: ${caller}). Was init() called? Total tracked: ${this.states.size}`
    );
  }
  return state;
}

/** For renderer — returns null for entities without visual state (decorations, etc.). */
getState(entityId: number): EntityVisualState | null {
  return this.states.get(entityId) ?? null;
}
```

**Two access patterns, explicit intent:**

| Method | Use when | Returns |
|--------|----------|---------|
| `getStateOrThrow(id, 'TreeSystem')` | Domain systems modifying their entities — state **must** exist | `EntityVisualState` (throws if missing) |
| `getState(id)` | Renderer resolving any entity — some legitimately have no visual state | `EntityVisualState \| null` |

### Mutation methods — all throw on missing state

```typescript
setVariation(entityId: number, variation: number): void {
  this.getStateOrThrow(entityId, 'setVariation').variation = variation;
}

play(entityId: number, sequenceKey: string, opts?: PlayOptions): void {
  const state = this.getStateOrThrow(entityId, 'play');
  state.animation = {
    sequenceKey,
    direction: opts?.direction ?? 0,
    currentFrame: opts?.startFrame ?? 0,
    elapsedMs: 0,
    loop: opts?.loop ?? false,
    playing: true,
  };
}

clearAnimation(entityId: number): void {
  this.getStateOrThrow(entityId, 'clearAnimation').animation = null;
}

setStatic(entityId: number, variation: number): void {
  const state = this.getStateOrThrow(entityId, 'setStatic');
  state.variation = variation;
  state.animation = null;
}

setAnimated(entityId: number, variation: number, sequenceKey: string, opts?: PlayOptions): void {
  const state = this.getStateOrThrow(entityId, 'setAnimated');
  state.variation = variation;
  state.animation = {
    sequenceKey,
    direction: opts?.direction ?? 0,
    currentFrame: opts?.startFrame ?? 0,
    elapsedMs: 0,
    loop: opts?.loop ?? false,
    playing: true,
  };
}

setDirection(entityId: number, direction: number): void {
  const state = this.getStateOrThrow(entityId, 'setDirection');
  if (!state.animation) {
    throw new Error(
      `EntityVisualService.setDirection: entity ${entityId} has no active animation. ` +
      `Call play() first or use setVariation() for static entities.`
    );
  }
  state.animation.direction = direction;
}
```

### Renderer resolution — optimistic with correct fallback

```typescript
// Renderer uses getState() (nullable) — entities like decorations may not have visual state.
// But when visual state exists, reads are direct (no ?? fallbacks on guaranteed fields).

private resolveMapObject(entity: Entity): SpriteEntry | null {
  const vs = this.getVisualState(entity.id);
  if (!vs) return null;  // legitimate: entity type not tracked by visual service

  const staticSprite = this.sprites!.getMapObject(entity.subType as MapObjectType, vs.variation);

  if (vs.animation) {
    const entry = this.sprites!.getAnimatedEntity(entity.type, entity.subType, entity.race);
    if (entry) {
      const frame = resolveAnimationFrame(vs.animation, entry.animationData);
      if (frame) return frame;
      // Animation sequence missing or exhausted — fall through to static sprite.
      // This is expected (e.g. sequence not in sprite data), not an error.
    }
  }

  return staticSprite;
}
```

### Edge cases

| Scenario | Handling | Rationale |
|----------|----------|-----------|
| `init()` called twice for same entity | Throws with entity ID and instruction to call `remove()` first | Prevents silent state overwrite — indicates lifecycle bug |
| `setVariation()` / `play()` / etc. on uninitialized entity | Throws via `getStateOrThrow()` with caller name and entity ID | Fail fast — domain system has a registration bug |
| `remove()` on non-existent entity | No-op (no throw) | Cleanup path — destroy order between systems is not guaranteed |
| `setDirection()` on entity with no animation | Throws with entity ID and guidance to use `play()` first | Prevents silent direction writes that would be ignored |
| `update()` advances animation past last frame (non-looping) | Set `playing = false`, clamp to last frame | Natural completion — entity stays on final frame until explicitly cleared |
| `clearAnimation()` during direction transition | Clears animation; transition stays (units may be mid-turn) | Transition is orthogonal — cleared independently by movement system |
| `startDirectionTransition()` on non-unit entity | Works (no type restriction) — but practically only called by movement | No artificial guard; contract enforced by callers, not service |
| Renderer encounters `animation.sequenceKey` not in sprite data | Returns `null` from `resolveAnimationFrame()`, falls back to static sprite | Expected for partial sprite data; not an error worth throwing for |
| Renderer encounters entity with `getState()` returning null | Returns `null` or skip result depending on entity type | Legitimate — decorations, None type entities have no visual state |

### What NOT to guard against (trust the contract)

These are internal invariants — defensive checks would hide bugs:

- `variation` being negative (domain systems compute valid offsets)
- `direction` being out of range (movement system produces valid hex directions)
- `sequenceKey` being empty string (callers always pass known constants)
- `AnimationPlayback` fields being NaN (arithmetic is well-defined)

---

## What this design makes impossible

| Bug class | Why it can't happen |
|-----------|-------------------|
| Stale animation overriding variation | `setStatic()` atomically clears animation. No intermediate state between render frames. |
| Forgotten animation cleanup | `animation: null` means no animation. Renderer skips animation lookup entirely — can't accidentally resolve to a stale frame. |
| Wrong fallback sprite | Renderer always falls back to `variation`-based lookup, never to `animatedEntry.staticSprite`. |
| Variation/animation out of sync | `setAnimated()` sets both atomically. No window where variation says "cutting" but animation says "sway". |
| Direction transition on non-units | `DirectionTransition` is a separate sparse map. Only units that explicitly start a transition have one. |

## What this design preserves

| Concern | Status |
|---------|--------|
| Building overlays (multi-layer, independent animation) | Unchanged — orthogonal system |
| Building construction (construction sprite, vertical progress) | Unchanged — `BuildingRenderState` pull model |
| Animation data registration (sprite metadata, sequences, directions) | Unchanged — `SpriteMetadataRegistry` |
| Animation resolver (semantic intent → sequence key) | Unchanged — `AnimationIntent` consumed by `applyIntent()` |
| Flag/territory dot rendering | Unchanged — dedicated render passes |
| Stacked resource rendering | Unchanged — uses quantity→direction, not variation |

## Files summary

| Action | File | Lines (est.) |
|--------|------|-------------|
| Create | `src/game/animation/entity-visual-service.ts` | ~180 |
| Delete | `src/game/animation/animation-service.ts` | ~160 |
| Edit | `src/game/animation.ts` | Remove `AnimationState`, add `EntityVisualState` exports |
| Edit | `src/game/animation/index.ts` | Update exports |
| Edit | `src/game/entity.ts` | Remove `variation` field |
| Edit | `src/game/features/growth/growable-system.ts` | ~10 lines changed |
| Edit | `src/game/features/trees/tree-system.ts` | ~15 lines changed |
| Edit | `src/game/features/crops/crop-system.ts` | ~15 lines changed |
| Edit | `src/game/features/stones/stone-system.ts` | ~5 lines changed |
| Edit | `src/game/features/trees/tree-feature.ts` | Constructor arg |
| Edit | `src/game/features/crops/crop-feature.ts` | Constructor arg |
| Edit | `src/game/features/stones/stone-feature.ts` | Constructor arg |
| Edit | `src/game/features/settler-tasks/idle-animation-controller.ts` | Renames |
| Edit | `src/game/features/settler-tasks/unit-state-machine.ts` | Renames |
| Edit | `src/game/features/combat/combat-system.ts` | Renames |
| Edit | `src/game/game-services.ts` | Wire new service |
| Edit | `src/game/game-loop.ts` | `update()` call |
| Edit | `src/game/renderer/entity-sprite-resolver.ts` | Rewrite resolution |
| Edit | `src/game/renderer/render-context.ts` | Type change |
| Edit | `src/game/renderer/render-passes/types.ts` | Type change |
| Edit | `src/game/renderer/render-passes/transition-blend-pass.ts` | Read from new type |
| Edit | `src/game/renderer/animation-helpers.ts` | Simplify fallback |
| Edit | `src/resources/map/raw-object-registry.ts` | Use service |
| Edit | `tests/unit/helpers/test-game.ts` | Wire service |
