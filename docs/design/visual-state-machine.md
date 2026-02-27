# Design: Unified Entity Visual State

## Problem

Entity visual appearance is controlled by two independent systems that don't know about each other:

1. **`entity.variation`** — a numeric index selecting a static sprite (set by domain systems like TreeSystem, StoneSystem, CropSystem)
2. **`AnimationService`** — holds per-entity animation state (sequence key, frame, direction, playing flag)

The renderer's `getAnimated()` method silently prioritises animation state over variation. When an animation exists (even stopped), `getAnimatedSprite()` returns the animation frame using `animatedEntry.staticSprite` as fallback — the variation-specific sprite is ignored entirely. This caused the tree-cutting bug: sway animation kept overriding cutting-stage sprites.

The root cause is **dual ownership with implicit priority** — no single source of truth for "what should this entity look like right now."

## Goal

Replace the split `entity.variation` + `AnimationService` state with a single **`EntityVisualState`** per entity that the renderer reads. Domain systems set visual intents; the renderer resolves sprites from those intents. No implicit overrides, no animation-vs-variation races.

## Design

### New type: `EntityVisualState`

```typescript
interface EntityVisualState {
  /** Static sprite variation index (trees: variant*11+stage, stones: variant*13+level) */
  variation: number;
  /** Animation sequence key, or null for static sprite */
  sequenceKey: string | null;
  /** Whether animation loops */
  loop: boolean;
  /** Current frame index */
  currentFrame: number;
  /** Elapsed ms within current frame */
  elapsedMs: number;
  /** Direction index (0-5 for units, variant index for trees) */
  direction: number;
  /** Whether animation is actively advancing */
  playing: boolean;
  /** Direction transition fields (units only) */
  previousDirection?: number;
  directionTransitionProgress?: number;
}
```

Key difference from current design: `variation` and animation fields live in the **same struct**. The renderer reads one object and decides: if `sequenceKey !== null` and animation data exists, use animation frame; otherwise use `variation` for static sprite lookup. No implicit fallback chain — the intent is explicit.

### New service: `EntityVisualService`

Replaces `AnimationService`. Owns the `Map<number, EntityVisualState>`.

```typescript
class EntityVisualService {
  private states = new Map<number, EntityVisualState>();

  // ── Variation (static sprites) ──────────────────────────
  setVariation(entityId: number, variation: number): void;
  getVariation(entityId: number): number;

  // ── Animation ───────────────────────────────────────────
  playAnimation(entityId: number, sequenceKey: string, opts?: PlayOptions): void;
  stopAnimation(entityId: number): void;   // sets sequenceKey = null
  setDirection(entityId: number, direction: number): void;

  // ── Combined (for domain systems that change both) ──────
  setVariationAndStopAnimation(entityId: number, variation: number): void;
  setVariationAndPlayAnimation(entityId: number, variation: number, seq: string, opts?: PlayOptions): void;

  // ── Intent API (for settler task animations) ────────────
  applyIntent(entityId: number, intent: AnimationIntent): void;

  // ── Renderer reads ──────────────────────────────────────
  getState(entityId: number): EntityVisualState | null;

  // ── Lifecycle ───────────────────────────────────────────
  remove(entityId: number): void;
  update(deltaMs: number): void;  // advance playing animations
}
```

**Rules enforced by the API:**
- `setVariation()` does NOT touch animation fields → static sprite changes don't break running animations (units walking)
- `stopAnimation()` nulls `sequenceKey` → renderer falls back to `variation` automatically
- `setVariationAndStopAnimation()` is the atomic operation for "change visual stage and clear animation" (trees entering cutting, crops entering harvested)
- `playAnimation()` does NOT touch `variation` → animation overlays don't corrupt the variation index

### Renderer changes

`EntitySpriteResolver.getAnimated()` becomes:

```typescript
private resolveSprite(entity: Entity, visualState: EntityVisualState | null): SpriteEntry | null {
    if (!visualState || !this.sprites) return null;

    // 1. Try animation path
    if (visualState.sequenceKey !== null) {
        const animatedEntry = this.sprites.getAnimatedEntity(entity.type, entity.subType, entity.race);
        if (animatedEntry) {
            const dirMap = animatedEntry.animationData.sequences.get(visualState.sequenceKey);
            const seq = dirMap?.get(visualState.direction);
            if (seq?.frames.length) {
                const idx = seq.loop
                    ? visualState.currentFrame % seq.frames.length
                    : Math.min(visualState.currentFrame, seq.frames.length - 1);
                return seq.frames[idx] ?? null;
            }
        }
        // Animation requested but sequence not found → fall through to static
    }

    // 2. Static sprite from variation
    return this.getStaticSprite(entity, visualState.variation);
}
```

No implicit `staticSprite` fallback from the animated entry — if animation can't resolve, it falls through to `variation`-based lookup. This is the key behavioral change.

### `entity.variation` field

Removed from `Entity`. All reads go through `EntityVisualService.getState()`. This eliminates the dual-source problem at the type level.

---

## Subsystems & migration plan

### Subsystem 1: EntityVisualService

**Create** `src/game/animation/entity-visual-service.ts`

- Move state map from `AnimationService`
- Add `variation` field to state
- Add combined methods (`setVariationAndStopAnimation`, etc.)
- Keep `update(deltaMs)` frame-advance logic unchanged
- Keep `applyIntent()` for settler task animations

**Estimated scope:** ~150 lines, 1 new file.

### Subsystem 2: Remove `entity.variation` from Entity

**Edit** `src/game/entity.ts`

- Remove `variation` property from `Entity` interface/class
- Compilation errors will surface every callsite that needs migration

**Edit** every file that reads/writes `entity.variation`:

| File | Current usage | Migration |
|------|--------------|-----------|
| `growable-system.ts` (lines 115, 138, 231) | `entity.variation = offset` | `visualService.setVariation(entityId, offset)` |
| `growable-system.ts` `onOffsetChanged` | hook after variation set | Subclass calls `visualService.setVariationAndPlayAnimation` or `setVariationAndStopAnimation` |
| `stone-system.ts` (lines 75, 100) | `entity.variation = getVariation(state)` | `visualService.setVariation(entityId, variation)` |
| `entity-sprite-resolver.ts` (line 118) | `entity.variation ?? 0` | `visualService.getState(entityId)?.variation ?? 0` |
| `entity-sprite-resolver.ts` `hasTexturedSpriteMap` (line 203) | reads variation implicitly | Use variation=0 for existence check (unchanged) |
| `raw-object-registry.ts` | sets initial variation on map load | Call `visualService.setVariation()` after entity creation |
| `inventory-visualizer.ts` | stacked resources use quantity not variation | No change needed (StackedResource uses direction, not variation) |

### Subsystem 3: Migrate domain systems

#### TreeSystem (`tree-system.ts`)

- Constructor: accept `EntityVisualService` instead of `AnimationService`
- `onOffsetChanged()`:
  - NORMAL → `visualService.setVariationAndPlayAnimation(id, offset, 'default', { loop: true, direction: variant })`
  - Other → `visualService.setVariationAndStopAnimation(id, offset)`
- `startCutting()`: remove manual `animationService.remove()` — `setVariationAndStopAnimation` handles it atomically
- `GrowableSystem.updateVisual()`: call `visualService.setVariation()` instead of `entity.variation = offset`

#### CropSystem (`crop-system.ts`)

- Same pattern as TreeSystem
- `onOffsetChanged()`:
  - Mature offset → `setVariationAndPlayAnimation(id, offset, 'default', { loop: true })`
  - Other → `setVariationAndStopAnimation(id, offset)`

#### StoneSystem (`stone-system.ts`)

- No animation involvement — just replace `entity.variation = x` with `visualService.setVariation(id, x)`

#### GrowableSystem base class (`growable-system.ts`)

- Constructor: accept `EntityVisualService` instead of `AnimationService`
- `updateVisual()`: call `visualService.setVariation()` and then `onOffsetChanged()` — or combine into a single `onVisualChanged()` hook that subclasses implement
- Remove `animationService` field, replace with `visualService`

### Subsystem 4: Migrate settler animation callers

These only use animation (not variation), so migration is mechanical rename:

| Caller | File | Change |
|--------|------|--------|
| `IdleAnimationController` | `idle-animation-controller.ts` | `animationService.play/stop/setDirection/applyIntent/getState` → `visualService.*` |
| `UnitStateMachine` | `unit-state-machine.ts` | Same renames |
| `CombatSystem` | `combat/combat-system.ts` | Same renames |
| `GameServices` cleanup | `game-services.ts` | `animationService.remove()` → `visualService.remove()` |
| `GameLoop` | `game-loop.ts` | `animationService.update()` → `visualService.update()` |

### Subsystem 5: Migrate renderer

**`entity-sprite-resolver.ts`:**
- Constructor: accept `getVisualState: (id: number) => EntityVisualState | null` instead of `getAnimState`
- `getMapObject()`: read `visualState.variation` instead of `entity.variation`
- `getAnimated()` → replace with `resolveSprite()` (see design above)
- `resolveUnit()`: read direction transition fields from `EntityVisualState`
- `getUnitSpriteForDirection()`: accept `EntityVisualState` instead of `AnimationState`

**`render-context.ts`:**
- `IRenderContext.getAnimationState` → `getVisualState: (id: number) => EntityVisualState | null`

**`render-passes/transition-blend-pass.ts`:**
- Read `previousDirection` / `directionTransitionProgress` from `EntityVisualState`

**`render-passes/entity-sprite-pass.ts`:**
- No structural change — still calls `spriteResolver.resolve(entity)`

**`render-passes/types.ts`:**
- `PassContext.getAnimState` → `getVisualState`

### Subsystem 6: Delete AnimationService

- Remove `src/game/animation/animation-service.ts`
- Update `src/game/animation/index.ts` exports
- Remove `AnimationState` interface (replaced by `EntityVisualState`)
- Keep `AnimationIntent` and `AnimationResolver` — they produce intents consumed by `EntityVisualService.applyIntent()`

---

## Parallelisation plan

Dependencies between subsystems:

```
S1 (EntityVisualService)
  ├── S2 (remove entity.variation) ─── depends on S1
  ├── S3 (domain systems) ──────────── depends on S1
  ├── S4 (settler animation callers) ─ depends on S1
  └── S5 (renderer) ───────────────── depends on S1
S6 (delete AnimationService) ───────── depends on S2+S3+S4+S5
```

**Phase 1** (sequential): Implement S1 — the new `EntityVisualService`. This is the foundation.

**Phase 2** (parallel — 4 agents): S2, S3, S4, S5 can all run simultaneously once S1 exists. Each touches different files:

| Agent | Subsystem | Files touched |
|-------|-----------|---------------|
| A | S2: Entity.variation removal | `entity.ts`, `raw-object-registry.ts` |
| B | S3: Domain systems | `growable-system.ts`, `tree-system.ts`, `crop-system.ts`, `stone-system.ts`, `tree-feature.ts`, `crop-feature.ts`, `stone-feature.ts` |
| C | S4: Settler animation | `idle-animation-controller.ts`, `unit-state-machine.ts`, `combat-system.ts`, `game-services.ts`, `game-loop.ts` |
| D | S5: Renderer | `entity-sprite-resolver.ts`, `render-context.ts`, `animation-helpers.ts`, `transition-blend-pass.ts`, `types.ts` |

**Phase 3** (sequential): S6 — delete `AnimationService`, clean up exports.

**Phase 4** (sequential): Run `pnpm lint` and `pnpm test:unit` to catch integration issues.

---

## Risk assessment

| Risk | Mitigation |
|------|-----------|
| Direction transition fields on non-unit entities | `EntityVisualState` includes optional transition fields; only units set them. Renderer checks before using. |
| Performance: extra map lookup per entity per frame | Same as current — one `Map.get()` per entity. Variation was on entity before (O(1) field access) but the map lookup is already paid for animation state. Net zero. |
| Stacked resources use `entity.subType` + direction, not variation | StackedResource rendering reads quantity→direction, not variation. No change needed. |
| Building render state (construction progress) | Buildings use `BuildingRenderState` from a separate callback — orthogonal to this change. No impact. |
| Test breakage | Unit tests that create entities with `entity.variation` need to use `visualService.setVariation()` instead. `test-game.ts` helper needs updating. |

## Files created/deleted

| Action | File |
|--------|------|
| **Create** | `src/game/animation/entity-visual-service.ts` |
| **Delete** | `src/game/animation/animation-service.ts` |
| **Edit** | ~20 files (see subsystem tables above) |
