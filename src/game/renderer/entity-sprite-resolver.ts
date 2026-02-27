/**
 * EntitySpriteResolver — resolves which sprite to render for each entity.
 *
 * Extracted from EntityRenderer to isolate sprite lookup/animation logic
 * from GL drawing code. Has no WebGL dependencies — only reads from
 * SpriteRenderManager and state providers.
 */

import { Entity, EntityType, BuildingType, UnitType, type StackedResourceState } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { EMaterialType } from '../economy';
import type { SpriteEntry } from './sprite-metadata/sprite-metadata';
import type { SpriteRenderManager } from './sprite-render-manager';
import type { AnimationState } from '../animation';
import type { BuildingRenderState, PlacementEntityType } from './render-context';
import type { LayerVisibility } from './layer-visibility';
import { getAnimatedSprite, getAnimatedSpriteForDirection } from './animation-helpers';
import { LogHandler } from '@/utilities/log-handler';

// ============================================================================
// Result types (replaces sentinel string 'transitioning')
// ============================================================================

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
}

// ============================================================================
// EntitySpriteResolver
// ============================================================================

export class EntitySpriteResolver {
    private static log = new LogHandler('SpriteResolver');

    constructor(
        private readonly sprites: SpriteRenderManager | null,
        private readonly getAnimState: (entityId: number) => AnimationState | null,
        private readonly getBuildingRenderState: (entityId: number) => BuildingRenderState,
        private readonly resourceStates: ReadonlyMap<number, StackedResourceState>,
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
            };
        },
        [EntityType.MapObject]: entity => ({
            skip: false,
            transitioning: false,
            sprite: this.getMapObject(entity),
            progress: 1,
        }),
        [EntityType.StackedResource]: entity => ({
            skip: false,
            transitioning: false,
            sprite: this.getResource(entity),
            progress: 1,
        }),
        [EntityType.Unit]: entity => this.resolveUnit(entity),
        [EntityType.Decoration]: () => ({ skip: true, transitioning: false, sprite: null, progress: 1 }),
        [EntityType.None]: () => ({ skip: true, transitioning: false, sprite: null, progress: 1 }),
    };

    /** Resolve an entity's sprite for rendering. */
    resolve(entity: Entity): SpriteResolveResult {
        return this.resolveMap[entity.type](entity);
    }

    // ── Per-type resolution ─────────────────────────────────────

    /** Building sprite with construction state. */
    private getBuilding(entity: Entity): { sprite: SpriteEntry | null; progress: number } {
        if (!this.sprites) return { sprite: null, progress: 1 };

        const renderState = this.getBuildingRenderState(entity.id);
        const buildingType = entity.subType as BuildingType;

        let sprite: SpriteEntry | null;
        if (renderState.useConstructionSprite) {
            sprite =
                this.sprites.getBuildingConstruction(buildingType, entity.race) ??
                this.sprites.getBuilding(buildingType, entity.race);
        } else {
            const fallback = this.sprites.getBuilding(buildingType, entity.race);
            sprite = this.getAnimated(entity, fallback);
        }

        return { sprite, progress: renderState.verticalProgress };
    }

    /** Map object sprite with layer visibility check. */
    private getMapObject(entity: Entity): SpriteEntry | null {
        if (!this.sprites) return null;

        // When decoration textures are disabled, skip all environment sprites (trees, stones, plants, crops, etc.)
        if (!this.layerVisibility.decorationTextures) return null;

        const variation = entity.variation ?? 0;
        const fallback = this.sprites.getMapObject(entity.subType as MapObjectType, variation);

        // Try animated sprite — getAnimated is O(1) and returns fallback if no animation
        return this.getAnimated(entity, fallback);
    }

    /** Stacked resource sprite based on quantity. */
    private getResource(entity: Entity): SpriteEntry | null {
        if (!this.sprites) return null;
        const state = this.resourceStates.get(entity.id);
        const quantity = state?.quantity ?? 1;
        const direction = Math.max(0, Math.min(quantity - 1, 7));
        return this.sprites.getResource(entity.subType as EMaterialType, direction) ?? null;
    }

    /** Unit sprite resolution — returns transitioning if mid-direction-change. */
    private resolveUnit(entity: Entity): SpriteResolveResult {
        if (!this.sprites) return { skip: false, transitioning: false, sprite: null, progress: 1 };

        const animState = this.getAnimState(entity.id);

        // Detect direction transition (needs blend shader)
        if (animState?.directionTransitionProgress !== undefined && animState.previousDirection !== undefined) {
            return { skip: false, transitioning: true, sprite: null, progress: 1 };
        }

        const direction = animState?.direction ?? 0;
        const fallback = this.sprites.getUnit(entity.subType as UnitType, direction, entity.race);
        const sprite = this.getAnimated(entity, fallback);
        return { skip: false, transitioning: false, sprite, progress: 1 };
    }

    // ── Animation helpers ───────────────────────────────────────

    /** Get the current animation frame for an entity, or fall back to static sprite. */
    private getAnimated(entity: Entity, fallbackSprite: SpriteEntry | null): SpriteEntry | null {
        if (!this.sprites) return fallbackSprite;

        const animState = this.getAnimState(entity.id);
        if (!animState) return fallbackSprite;

        const animatedEntry = this.sprites.getAnimatedEntity(entity.type, entity.subType, entity.race);
        if (!animatedEntry) return fallbackSprite;

        try {
            return getAnimatedSprite(animState, animatedEntry.animationData, animatedEntry.staticSprite);
        } catch (e) {
            const typeName =
                entity.type === EntityType.Unit
                    ? UnitType[entity.subType]
                    : `${EntityType[entity.type]}:${entity.subType}`;
            EntitySpriteResolver.log.error(
                `Animation error for ${typeName} (id=${entity.id}): seq='${animState.sequenceKey}', ` +
                    `available=[${[...animatedEntry.animationData.sequences.keys()].join(', ')}]`
            );
            throw e;
        }
    }

    /** Get animated sprite for a specific direction (used for direction transitions). */
    getUnitSpriteForDirection(
        unitType: UnitType,
        animState: AnimationState,
        direction: number,
        race?: number
    ): SpriteEntry | null {
        if (!this.sprites) return null;

        const fallback = this.sprites.getUnit(unitType, direction, race);
        const animatedEntry = this.sprites.getAnimatedEntity(EntityType.Unit, unitType, race);
        if (!animatedEntry) return fallback;

        return getAnimatedSpriteForDirection(animState, animatedEntry.animationData, direction, fallback);
    }

    // ── Query helpers ───────────────────────────────────────────

    /**
     * Strategy map from EntityType to hasTexturedSprite check function.
     */
    private readonly hasTexturedSpriteMap: Record<EntityType, (entity: Entity) => boolean> = {
        [EntityType.Building]: entity => !!this.sprites?.getBuilding(entity.subType as BuildingType, entity.race),
        [EntityType.MapObject]: entity => {
            if (!this.layerVisibility.decorationTextures) return false;
            return !!this.sprites?.getMapObject(entity.subType as MapObjectType);
        },
        [EntityType.StackedResource]: entity => !!this.sprites?.getResource(entity.subType as EMaterialType),
        [EntityType.Unit]: entity => !!this.sprites?.getUnit(entity.subType as UnitType, 0, entity.race),
        [EntityType.Decoration]: () => false,
        [EntityType.None]: () => false,
    };

    /** Check if entity has a sprite available (for color fallback decisions). */
    hasTexturedSprite(entity: Entity): boolean {
        if (!this.sprites) return false;
        return this.hasTexturedSpriteMap[entity.type](entity);
    }

    /** Get sprite for placement preview by entity type. Exhaustive switch ensures compile-time safety. */
    getPreviewSprite(
        entityType: PlacementEntityType,
        subType: number,
        variation?: number,
        race?: number,
        level?: number
    ): SpriteEntry | null {
        if (!this.sprites) return null;

        switch (entityType) {
        case 'building':
            return this.sprites.getBuilding(subType as BuildingType, race);
        case 'resource':
            return this.sprites.getResource(subType as EMaterialType, variation ?? 0);
        case 'unit':
            return this.getUnitPreviewSprite(subType as UnitType, race, level ?? 1);
        default: {
            const _exhaustive: never = entityType;
            return _exhaustive;
        }
        }
    }

    /** Get unit preview sprite, using level-specific idle frame for military units. */
    private getUnitPreviewSprite(unitType: UnitType, race?: number, level: number = 1): SpriteEntry | null {
        if (!this.sprites) return null;
        if (level > 1) {
            const animated = this.sprites.getAnimatedEntity(EntityType.Unit, unitType, race);
            const seqKey = `default.${level}`;
            const dirMap = animated?.animationData.sequences.get(seqKey);
            const seq = dirMap?.get(0);
            if (seq?.frames[0]) return seq.frames[0];
        }
        return this.sprites.getUnit(unitType, 0, race);
    }
}
