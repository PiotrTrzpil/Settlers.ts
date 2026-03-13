/**
 * Crop lifecycle system - manages planting, growth, harvesting, and decay.
 *
 * Extends GrowableSystem for shared growth/planting infrastructure.
 * Single system instance manages all crop types (grain, sunflower, agave, beehive).
 * Per-type behavior (timing, growth stages) is driven by CropTypeConfig.
 *
 * Logical stages:
 *   Growing -> Mature (planted by farmer, progress 0-1 maps through growing variations)
 *   Mature -> Harvesting -> Harvested (harvested by farmer, progress 0-1)
 *
 * Variation mapping per crop type:
 *   0..growingCount-1  = growing sprite variations (static)
 *   growingCount        = mature sprite (animated)
 *   growingCount+1      = harvested sprite (static)
 */

import { GrowableSystem, type GrowableConfig, type GrowableState, type PlantingCapable } from '../../systems/growth';
import type { CoreDeps } from '../feature';
import { EntityType } from '../../entity';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { Command, CommandResult } from '../../commands';
import { findEmptySpot } from '../../systems/spatial-search';
import type { EventBus } from '../../event-bus';
import type { Persistable } from '@/game/persistence';
import type { SerializedCrop } from '@/game/state/game-state-persistence';

// ── Stages ────────────────────────────────────────────────────

export enum CropStage {
    /** Crop is growing (progress 0-1 maps to growing variations) */
    Growing = 0,
    /** Fully grown, animated, ready for harvest */
    Mature = 1,
    /** Being harvested by a worker (progress 0-1) */
    Harvesting = 2,
    /** Harvested stub, decays and is removed */
    Harvested = 3,
}

// ── State ─────────────────────────────────────────────────────

export interface CropState extends GrowableState {
    stage: CropStage;
    cropType: MapObjectType;
    decayTimer: number;
}

// ── Per-type config ───────────────────────────────────────────

export interface CropTypeConfig {
    /** Seconds from planted to mature */
    growthTime: number;
    /** Seconds before harvested stub is removed */
    harvestDecayTime: number;
    /** Number of growing sprite variations (progress 0-1 maps to 0..growingCount-1) */
    growingCount: number;
}

const CROP_TYPE_CONFIGS: ReadonlyMap<MapObjectType, CropTypeConfig> = new Map([
    [MapObjectType.Grain, { growthTime: 110, harvestDecayTime: 20, growingCount: 4 }],
    [MapObjectType.Sunflower, { growthTime: 120, harvestDecayTime: 20, growingCount: 3 }],
    [MapObjectType.Agave, { growthTime: 130, harvestDecayTime: 25, growingCount: 3 }],
    [MapObjectType.Beehive, { growthTime: 100, harvestDecayTime: 15, growingCount: 1 }],
    [MapObjectType.Grape, { growthTime: 140, harvestDecayTime: 20, growingCount: 3 }],
]);

function getCropConfig(cropType: MapObjectType): CropTypeConfig {
    const config = CROP_TYPE_CONFIGS.get(cropType);
    if (!config) {
        throw new Error(`No config for crop type ${MapObjectType[cropType]} in CropSystem`);
    }
    return config;
}

// ── GrowableSystem config ─────────────────────────────────────

const PLANTING_SEARCH_RADIUS = 12;
const MIN_CROP_DISTANCE_SQ = 1;

const ALL_CROP_TYPES: readonly MapObjectType[] = [
    MapObjectType.Grain,
    MapObjectType.Sunflower,
    MapObjectType.Agave,
    MapObjectType.Beehive,
    MapObjectType.Grape,
];

const CROP_CONFIG: GrowableConfig = {
    growthTime: 45,
    plantingSearchRadius: PLANTING_SEARCH_RADIUS,
    minDistanceSq: MIN_CROP_DISTANCE_SQ,
    objectCategory: MapObjectCategory.Crops,
    plantableTypes: ALL_CROP_TYPES,
};

// ── CropSystem ────────────────────────────────────────────────

/**
 * Manages crop growth, harvesting, and decay for all crop types.
 * Uses EntityVisualService for visual state - no direct entity manipulation.
 */
export interface CropSystemConfig extends CoreDeps {
    visualService: EntityVisualService;
    executeCommand: (cmd: Command) => CommandResult;
}

export class CropSystem extends GrowableSystem<CropState> implements Persistable<SerializedCrop[]> {
    readonly persistKey = 'crops' as const;
    private readonly eventBus: EventBus;

    constructor(cfg: CropSystemConfig) {
        super({
            gameState: cfg.gameState,
            visualService: cfg.visualService,
            growableConfig: CROP_CONFIG,
            logName: 'CropSystem',
            executeCommand: cfg.executeCommand,
        });
        this.eventBus = cfg.eventBus;
    }

    // ── GrowableSystem implementation ────────────────────────────

    protected shouldRegister(objectType: MapObjectType): boolean {
        return CROP_TYPE_CONFIGS.has(objectType);
    }

    protected createState(planted: boolean, objectType: MapObjectType): CropState {
        const stage = planted ? CropStage.Growing : CropStage.Mature;
        const state: CropState = { stage, cropType: objectType, progress: 0, decayTimer: 0, currentOffset: 0 };
        state.currentOffset = this.getSpriteOffset(state);
        return state;
    }

    protected getSpriteOffset(state: CropState): number {
        const config = getCropConfig(state.cropType);

        switch (state.stage) {
            case CropStage.Growing: {
                const idx = Math.min(Math.floor(state.progress * config.growingCount), config.growingCount - 1);
                return idx;
            }
            case CropStage.Mature:
            case CropStage.Harvesting:
                return config.growingCount;
            case CropStage.Harvested:
                return config.growingCount + 1;
        }
    }

    protected onOffsetChanged(entityId: number, offset: number, state: CropState): void {
        const config = getCropConfig(state.cropType);
        // Mature variation gets looping animation (sway/bloom)
        if (offset === config.growingCount) {
            const startFrame = this.gameState.rng.nextInt(100);
            this.visualService.play(entityId, 'default', { loop: true, startFrame });
        } else {
            // Clear animation when leaving the mature stage (prevents stale animation)
            this.visualService.clearAnimation(entityId);
        }
    }

    protected tickState(entityId: number, state: CropState, dt: number): 'keep' | 'remove' {
        if (state.stage === CropStage.Growing) {
            const config = getCropConfig(state.cropType);
            state.progress += dt / config.growthTime;
            if (state.progress >= 1) {
                state.stage = CropStage.Mature;
                state.progress = 0;
                this.eventBus.emit('crop:matured', { entityId, cropType: state.cropType });
            }
            this.updateVisual(entityId, state);
        }

        if (state.stage === CropStage.Harvested) {
            state.decayTimer -= dt;
            if (state.decayTimer <= 0) {
                return 'remove';
            }
        }

        return 'keep';
    }

    protected buildPlantCommand(objectType: MapObjectType, x: number, y: number): Command {
        return { type: 'plant_crop', cropType: objectType, x, y };
    }

    // ── Crop-specific: queries ────────────────────────────────────

    getStage(entityId: number): CropStage | undefined {
        return this.states.get(entityId)?.stage;
    }

    getCropState(entityId: number): CropState | undefined {
        return this.states.get(entityId);
    }

    canHarvest(entityId: number): boolean {
        return this.states.get(entityId)?.stage === CropStage.Mature;
    }

    isHarvesting(entityId: number): boolean {
        return this.states.get(entityId)?.stage === CropStage.Harvesting;
    }

    // ── Crop-specific: harvesting ─────────────────────────────────

    startHarvesting(entityId: number): boolean {
        const state = this.states.get(entityId);
        if (!state || state.stage !== CropStage.Mature) {
            return false;
        }

        state.stage = CropStage.Harvesting;
        state.progress = 0;
        this.updateVisual(entityId, state);
        return true;
    }

    /**
     * Update harvesting progress.
     * @returns true if harvest is complete
     */
    updateHarvesting(entityId: number, progress: number): boolean {
        const state = this.states.get(entityId);
        if (!state || state.stage !== CropStage.Harvesting) {
            return false;
        }

        state.progress = Math.min(1, progress);

        if (state.progress >= 1) {
            const config = getCropConfig(state.cropType);
            state.stage = CropStage.Harvested;
            state.decayTimer = config.harvestDecayTime;
            state.progress = 0;
            this.updateVisual(entityId, state);
            this.eventBus.emit('crop:harvested', { entityId, cropType: state.cropType });
            return true;
        }

        this.updateVisual(entityId, state);
        return false;
    }

    cancelHarvesting(entityId: number): void {
        const state = this.states.get(entityId);
        if (state && state.stage === CropStage.Harvesting) {
            state.stage = CropStage.Mature;
            state.progress = 0;
            this.updateVisual(entityId, state);
        }
    }

    // ── Crop-type-specific planting ───────────────────────────────

    /**
     * Get a PlantingCapable adapter for a specific crop type.
     * Work handlers use this to plant only the correct crop.
     */
    getCropPlanter(cropType: MapObjectType): PlantingCapable {
        return {
            findPlantingSpot: (cx, cy, radius?) => this.findPlantingSpotForType(cx, cy, cropType, radius),
            plantEntity: (x, y, settlerId) => this.plantCropType(x, y, cropType, settlerId),
        };
    }

    /**
     * Find a planting spot with per-type proximity filtering.
     * Only same-type crops count for minimum distance.
     */
    findPlantingSpotForType(
        cx: number,
        cy: number,
        cropType: MapObjectType,
        radius?: number
    ): { x: number; y: number } | null {
        const searchRadius = radius ?? this.config.plantingSearchRadius;
        return findEmptySpot(cx, cy, {
            gameState: this.gameState,
            searchRadius,
            minRadius: 0,
            minDistanceSq: this.config.minDistanceSq,
            rng: this.gameState.rng,
            proximityEntities: [...this.gameState.spatialIndex.nearby(cx, cy, searchRadius * 2)],
            proximityFilter: entity => entity.type === EntityType.MapObject && entity.subType === cropType,
        });
    }

    /**
     * Plant a specific crop type at (x, y) via the command system.
     */
    plantCropType(x: number, y: number, cropType: MapObjectType, settlerId: number): void {
        const result = this._executeCommand(this.buildPlantCommand(cropType, x, y));
        if (result.success) {
            this.log.debug(`Settler ${settlerId} planted ${MapObjectType[cropType]} at (${x}, ${y})`);
        } else {
            this.log.debug(`Settler ${settlerId}: cannot plant at (${x}, ${y}): ${result.error}`);
        }
    }

    // ── Persistable ──────────────────────────────────────────────

    serialize(): SerializedCrop[] {
        const result: SerializedCrop[] = [];
        for (const [entityId, state] of this.getAllCropStates()) {
            result.push({
                entityId,
                stage: state.stage,
                cropType: state.cropType,
                progress: state.progress,
                decayTimer: state.decayTimer,
                currentOffset: state.currentOffset,
            });
        }
        return result;
    }

    deserialize(data: SerializedCrop[]): void {
        for (const c of data) {
            this.restoreCropState(c.entityId, {
                stage: c.stage,
                cropType: c.cropType,
                progress: c.progress,
                decayTimer: c.decayTimer,
                currentOffset: c.currentOffset,
            });
        }
    }

    // ── Backward-compatible aliases ──────────────────────────────

    *getAllCropStates(): IterableIterator<[number, CropState]> {
        yield* this.getAllStates();
    }

    restoreCropState(entityId: number, data: CropState): void {
        this.restoreState(entityId, data);
    }

    // ── Debug ─────────────────────────────────────────────────────

    getStats(): { byType: Record<string, number>; byStage: Record<CropStage, number> } {
        const byType: Record<string, number> = {};
        const byStage: Record<CropStage, number> = {
            [CropStage.Growing]: 0,
            [CropStage.Mature]: 0,
            [CropStage.Harvesting]: 0,
            [CropStage.Harvested]: 0,
        };

        for (const state of this.states.values()) {
            const typeName = MapObjectType[state.cropType];
            byType[typeName] = (byType[typeName] || 0) + 1;
            byStage[state.stage]++;
        }

        return { byType, byStage };
    }
}

// ── Sprite config (used by sprite loader) ─────────────────────

/**
 * Sprite configuration for a crop type.
 * Maps variation indices to GIL sprite indices.
 */
export interface CropSpriteConfig {
    /** GIL indices for growing stage variations (one static sprite per stage) */
    growingSprites: number[];
    /** GIL index range for the mature animated sprite */
    matureSprite: { start: number; count: number };
    /** GIL index for the harvested/cut sprite */
    harvestedSprite: number;
}

/**
 * Sprite configs for each crop type, keyed by MapObjectType value.
 * Used by sprite-render-manager to register map object sprites at the correct variation indices.
 */
export const CROP_SPRITE_CONFIGS: ReadonlyMap<MapObjectType, CropSpriteConfig> = new Map([
    [
        MapObjectType.Grain,
        {
            growingSprites: [1224, 1225, 1226, 1227],
            matureSprite: { start: 1228, count: 7 },
            harvestedSprite: 1235,
        },
    ],
    [
        MapObjectType.Sunflower,
        {
            growingSprites: [1620, 1621, 1622],
            matureSprite: { start: 1623, count: 8 },
            harvestedSprite: 1631,
        },
    ],
    [
        MapObjectType.Agave,
        {
            growingSprites: [1264, 1265, 1266],
            matureSprite: { start: 1267, count: 15 },
            harvestedSprite: 1282,
        },
    ],
    [
        MapObjectType.Beehive,
        {
            growingSprites: [1361],
            matureSprite: { start: 1361, count: 12 },
            harvestedSprite: 1373,
        },
    ],
    [
        MapObjectType.Grape,
        {
            growingSprites: [1125, 1126, 1127],
            matureSprite: { start: 1128, count: 2 },
            harvestedSprite: 1125,
        },
    ],
]);

/** Get the CropTypeConfig for a given MapObjectType, or undefined if not a crop. */
export function getCropTypeConfig(type: MapObjectType): CropTypeConfig | undefined {
    return CROP_TYPE_CONFIGS.get(type);
}
