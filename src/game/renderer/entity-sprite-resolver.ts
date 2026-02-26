/**
 * EntitySpriteResolver — resolves which sprite to render for each entity.
 *
 * Extracted from EntityRenderer to isolate sprite lookup/animation logic
 * from GL drawing code. Has no WebGL dependencies — only reads from
 * SpriteRenderManager and state providers.
 */

import { Entity, EntityType, BuildingType, UnitType, MapObjectType, type StackedResourceState } from '../entity';
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

    /** Resolve an entity's sprite for rendering. */
    resolve(entity: Entity): SpriteResolveResult {
        switch (entity.type) {
        case EntityType.Building: {
            const result = this.getBuilding(entity);
            return {
                skip: result.progress <= 0,
                transitioning: false,
                sprite: result.sprite,
                progress: result.progress,
            };
        }
        case EntityType.MapObject:
            return { skip: false, transitioning: false, sprite: this.getMapObject(entity), progress: 1 };
        case EntityType.StackedResource:
            return { skip: false, transitioning: false, sprite: this.getResource(entity), progress: 1 };
        case EntityType.Unit:
            return this.resolveUnit(entity);
        case EntityType.Decoration:
        case EntityType.None:
            return { skip: true, transitioning: false, sprite: null, progress: 1 };
        }
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

        // When decoration textures are disabled, skip sprites for non-tree objects
        if (!this.layerVisibility.decorationTextures && entity.subType > 17) return null;

        const variation = entity.variation ?? 0;
        const fallback = this.sprites.getMapObject(entity.subType as MapObjectType, variation);

        // Only use animated sprite for normal trees (variation 3), others are static
        return variation === 3 ? this.getAnimated(entity, fallback) : fallback;
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
    getUnitSpriteForDirection(unitType: UnitType, animState: AnimationState, direction: number): SpriteEntry | null {
        if (!this.sprites) return null;

        const fallback = this.sprites.getUnit(unitType, direction);
        const animatedEntry = this.sprites.getAnimatedEntity(EntityType.Unit, unitType);
        if (!animatedEntry) return fallback;

        return getAnimatedSpriteForDirection(animState, animatedEntry.animationData, direction, fallback);
    }

    // ── Query helpers ───────────────────────────────────────────

    /** Check if entity has a sprite available (for color fallback decisions). */
    hasTexturedSprite(entity: Entity): boolean {
        if (!this.sprites) return false;

        switch (entity.type) {
        case EntityType.Building:
            return !!this.sprites.getBuilding(entity.subType as BuildingType, entity.race);
        case EntityType.MapObject:
            if (!this.layerVisibility.decorationTextures && entity.subType > 17) return false;
            return !!this.sprites.getMapObject(entity.subType as MapObjectType);
        case EntityType.StackedResource:
            return !!this.sprites.getResource(entity.subType as EMaterialType);
        case EntityType.Unit:
            return !!this.sprites.getUnit(entity.subType as UnitType, 0, entity.race);
        case EntityType.Decoration:
        case EntityType.None:
            return false;
        }
    }

    /** Get sprite for placement preview by entity type. Exhaustive switch ensures compile-time safety. */
    getPreviewSprite(
        entityType: PlacementEntityType,
        subType: number,
        variation?: number,
        race?: number
    ): SpriteEntry | null {
        if (!this.sprites) return null;

        switch (entityType) {
        case 'building':
            return this.sprites.getBuilding(subType as BuildingType, race);
        case 'resource':
            return this.sprites.getResource(subType as EMaterialType, variation ?? 0);
        case 'unit':
            return this.sprites.getUnit(subType as UnitType, 0, race);
        default: {
            const _exhaustive: never = entityType;
            return _exhaustive;
        }
        }
    }
}
