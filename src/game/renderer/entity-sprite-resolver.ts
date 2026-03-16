/**
 * EntitySpriteResolver — resolves which sprite to render for each entity.
 *
 * Extracted from EntityRenderer to isolate sprite lookup/animation logic
 * from GL drawing code. Has no WebGL dependencies — only reads from
 * SpriteRenderManager and state providers.
 */

import { Entity, EntityType, BuildingType, UnitType, type StackedPileState } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { EMaterialType } from '../economy';
import type { SpriteEntry } from './sprite-metadata/sprite-metadata';
import type { SpriteRenderManager } from './sprite-render-manager';
import type { EntityVisualState, AnimationPlayback, DirectionTransition } from '../animation/entity-visual-service';
import type { BuildingRenderState, PlacementEntityType } from './render-context';
import type { LayerVisibility } from './layer-visibility';
import { resolveAnimationFrame, getAnimatedSpriteForDirection } from './animation-helpers';
import { toSpriteDirection } from './sprite-direction';

// ============================================================================
// Result types (replaces sentinel string 'transitioning')
// ============================================================================

/** Pre-resolved sprites for a direction transition (old → new cross-fade). */
export interface TransitionSpriteData {
    readonly oldSprite: SpriteEntry;
    readonly newSprite: SpriteEntry;
    readonly blendFactor: number;
}

/** Resolved sprite data for a single entity. */
export interface SpriteResolveResult {
    /** True if entity should be skipped entirely (e.g., progress <= 0) */
    skip: boolean;
    /** True if entity is transitioning between directions (needs blend shader) */
    transitioning: boolean;
    /** The resolved sprite, or null if unavailable */
    sprite: SpriteEntry | null;
    /** Vertical visibility progress (0.0 = hidden, 1.0 = fully visible) */
    progress: number;
    /** Pre-resolved transition sprites (only set when transitioning=true) */
    transitionData: TransitionSpriteData | null;
}

const SKIP_RESULT: SpriteResolveResult = {
    skip: true,
    transitioning: false,
    sprite: null,
    progress: 1,
    transitionData: null,
};

// ============================================================================
// EntitySpriteResolver
// ============================================================================

export class EntitySpriteResolver {
    constructor(
        private readonly sprites: SpriteRenderManager | null,
        private readonly getVisualState: (entityId: number) => EntityVisualState | null,
        private readonly getDirectionTransition: (entityId: number) => DirectionTransition | null,
        private readonly getBuildingRenderState: (entityId: number) => BuildingRenderState,
        private readonly pileStates: ReadonlyMap<number, StackedPileState>,
        private readonly layerVisibility: LayerVisibility
    ) {}

    // ── Unified resolve ─────────────────────────────────────────

    /**
     * Strategy map from EntityType to resolve function.
     * Each entry returns a SpriteResolveResult for the given entity.
     */
    private readonly resolveMap: Record<EntityType, (entity: Entity) => SpriteResolveResult> = {
        [EntityType.Building]: entity => {
            const result = this.getBuilding(entity);
            return {
                skip: result.progress <= 0,
                transitioning: false,
                sprite: result.sprite,
                progress: result.progress,
                transitionData: null,
            };
        },
        [EntityType.MapObject]: entity => ({
            skip: false,
            transitioning: false,
            sprite: this.getMapObject(entity),
            progress: 1,
            transitionData: null,
        }),
        [EntityType.StackedPile]: entity => ({
            skip: false,
            transitioning: false,
            sprite: this.getPileSprite(entity),
            progress: 1,
            transitionData: null,
        }),
        [EntityType.Unit]: this.resolveUnit.bind(this),
        [EntityType.Decoration]: () => SKIP_RESULT,
        [EntityType.None]: () => SKIP_RESULT,
    };

    /** Resolve an entity's sprite for rendering. */
    resolve(entity: Entity): SpriteResolveResult {
        return this.resolveMap[entity.type](entity);
    }

    // ── Per-type resolution ─────────────────────────────────────

    /** Building sprite with construction state. */
    private getBuilding(entity: Entity): { sprite: SpriteEntry | null; progress: number } {
        if (!this.sprites) {
            return { sprite: null, progress: 1 };
        }

        const renderState = this.getBuildingRenderState(entity.id);
        const buildingType = entity.subType as BuildingType;

        let sprite: SpriteEntry | null;
        if (renderState.useConstructionSprite) {
            sprite =
                this.sprites.registry.getBuildingConstruction(buildingType, entity.race) ??
                this.sprites.registry.getBuilding(buildingType, entity.race);
        } else {
            const fallback = this.sprites.registry.getBuilding(buildingType, entity.race);
            const vs = this.getVisualState(entity.id);
            if (vs?.animation) {
                const animEntry = this.sprites.registry.getAnimatedEntity(
                    entity.type,
                    entity.subType as number,
                    entity.race
                );
                if (animEntry) {
                    const frame = resolveAnimationFrame(
                        vs.animation,
                        animEntry.animationData,
                        entity.type,
                        entity.subType as number
                    );
                    if (frame) {
                        sprite = frame;
                    } else {
                        sprite = fallback;
                    }
                } else {
                    sprite = fallback;
                }
            } else {
                sprite = fallback;
            }
        }

        return { sprite, progress: renderState.verticalProgress };
    }

    /** Map object sprite with layer visibility check. */
    private getMapObject(entity: Entity): SpriteEntry | null {
        if (!this.sprites) {
            return null;
        }

        // When decoration textures are disabled, skip all environment sprites (trees, stones, plants, crops, etc.)
        if (!this.layerVisibility.decorationTextures) {
            return null;
        }

        const vs = this.getVisualState(entity.id);
        const variation = vs?.variation ?? 0;
        const staticSprite = this.sprites.registry.getMapObject(entity.subType as MapObjectType, variation);

        if (vs?.animation) {
            const entry = this.sprites.registry.getAnimatedEntity(entity.type, entity.subType as number, entity.race);
            if (entry) {
                const frame = resolveAnimationFrame(
                    vs.animation,
                    entry.animationData,
                    entity.type,
                    entity.subType as number
                );
                if (frame) {
                    return frame;
                }
            }
        }

        return staticSprite;
    }

    /** Stacked resource sprite based on quantity. */
    private getPileSprite(entity: Entity): SpriteEntry | null {
        if (!this.sprites) {
            return null;
        }
        const state = this.pileStates.get(entity.id);
        if (!state) {
            throw new Error(`No resource state for entity ${entity.id} (${entity.subType})`);
        }
        const quantity = state.quantity;
        const direction = Math.max(0, Math.min(quantity - 1, 7));
        return this.sprites.registry.getGoodSprite(entity.subType as EMaterialType, direction) ?? null;
    }

    /** Unit sprite resolution — pre-resolves transition sprites if mid-direction-change. */
    private resolveUnit(entity: Entity): SpriteResolveResult {
        const noSprite: SpriteResolveResult = {
            skip: false,
            transitioning: false,
            sprite: null,
            progress: 1,
            transitionData: null,
        };
        if (!this.sprites) {
            return noSprite;
        }

        const vs = this.getVisualState(entity.id);
        if (!vs) {
            return noSprite;
        }

        // Detect direction transition — resolve both direction sprites up-front
        const transition = this.getDirectionTransition(entity.id);
        if (transition && vs.animation) {
            const unitType = entity.subType as UnitType;
            const oldSprite = this.getUnitSpriteForDirection(
                unitType,
                vs.animation,
                toSpriteDirection(transition.previousDirection),
                entity.race
            );
            const newSprite = this.getUnitSpriteForDirection(
                unitType,
                vs.animation,
                toSpriteDirection(vs.animation.direction),
                entity.race
            );
            if (oldSprite && newSprite) {
                return {
                    skip: false,
                    transitioning: true,
                    sprite: null,
                    progress: 1,
                    transitionData: { oldSprite, newSprite, blendFactor: transition.progress },
                };
            }
        }

        const spriteDir = toSpriteDirection(vs.animation?.direction ?? 0);
        const staticSprite = this.sprites.registry.getUnit(entity.subType as UnitType, spriteDir, entity.race);

        if (vs.animation) {
            const unitType = entity.subType as UnitType;
            const entry = this.sprites.registry.getAnimatedEntity(entity.type, unitType, entity.race);
            if (entry) {
                const frame = resolveAnimationFrame(
                    vs.animation,
                    entry.animationData,
                    entity.type,
                    unitType,
                    spriteDir
                );
                if (frame) {
                    return { skip: false, transitioning: false, sprite: frame, progress: 1, transitionData: null };
                }
            }
        }

        return { skip: false, transitioning: false, sprite: staticSprite, progress: 1, transitionData: null };
    }

    /** Get animated sprite for a specific direction (used for direction transitions). */
    getUnitSpriteForDirection(
        unitType: UnitType,
        playback: AnimationPlayback,
        spriteDir: number,
        race?: number
    ): SpriteEntry | null {
        if (!this.sprites) {
            return null;
        }

        const fallback = this.sprites.registry.getUnit(unitType, spriteDir, race);
        const animatedEntry = this.sprites.registry.getAnimatedEntity(EntityType.Unit, unitType, race);
        if (!animatedEntry) {
            return fallback;
        }

        return getAnimatedSpriteForDirection(
            playback,
            animatedEntry.animationData,
            spriteDir,
            fallback,
            EntityType.Unit,
            unitType
        );
    }

    // ── Query helpers ───────────────────────────────────────────

    /**
     * Strategy map from EntityType to hasTexturedSprite check function.
     */
    private readonly hasTexturedSpriteMap: Record<EntityType, (entity: Entity) => boolean> = {
        [EntityType.Building]: entity =>
            !!this.sprites?.registry.getBuilding(entity.subType as BuildingType, entity.race),
        [EntityType.MapObject]: entity => {
            if (!this.layerVisibility.decorationTextures) {
                return false;
            }
            return !!this.sprites?.registry.getMapObject(entity.subType as MapObjectType);
        },
        [EntityType.StackedPile]: entity => !!this.sprites?.registry.getGoodSprite(entity.subType as EMaterialType),
        [EntityType.Unit]: entity => !!this.sprites?.registry.getUnit(entity.subType as UnitType, 0, entity.race),
        [EntityType.Decoration]: () => false,
        [EntityType.None]: () => false,
    };

    /** Check if entity has a sprite available (for color fallback decisions). */
    hasTexturedSprite(entity: Entity): boolean {
        if (!this.sprites) {
            return false;
        }
        return this.hasTexturedSpriteMap[entity.type](entity);
    }

    /** Get sprite for placement preview by entity type. Exhaustive switch ensures compile-time safety. */
    getPreviewSprite(
        entityType: PlacementEntityType,
        subType: number | string,
        variation?: number,
        race?: number,
        level?: number
    ): SpriteEntry | null {
        if (!this.sprites) {
            return null;
        }

        switch (entityType) {
            case 'building':
                return race !== undefined ? this.sprites.registry.getBuilding(subType as BuildingType, race) : null;
            case 'pile':
                return this.sprites.registry.getGoodSprite(subType as unknown as EMaterialType, variation ?? 0);
            case 'unit':
                return this.getUnitPreviewSprite(subType as UnitType, race, level ?? 1);
            default: {
                const _exhaustive: never = entityType;
                return _exhaustive;
            }
        }
    }

    /** Get unit preview sprite — each leveled UnitType has its own registered sprites. */
    private getUnitPreviewSprite(unitType: UnitType, race?: number, _level?: number): SpriteEntry | null {
        if (!this.sprites) {
            return null;
        }
        return this.sprites.registry.getUnit(unitType, 0, race);
    }
}
