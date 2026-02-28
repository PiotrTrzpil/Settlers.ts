/**
 * Base class for systems that manage map objects with growth stages.
 *
 * Shared by: trees (forester), grain farms, sunflower farms, agave farms.
 * Each creates entities on free tiles that grow over time through visual stages.
 *
 * Provides:
 * - Entity state tracking (register/unregister)
 * - Growth progression helper (advanceGrowth)
 * - Planting spot search (findPlantingSpot via findEmptySpot)
 * - Entity planting via commands (plantEntity, plantEntitiesNear)
 * - Visual updates with change detection (via EntityVisualService)
 * - Persistence helpers (getAllStates, restoreState)
 */

import type { TickSystem } from '../../tick-system';
import type { GameState } from '../../game-state';
import { EntityType } from '../../entity';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { findEmptySpot } from '../../systems/spatial-search';
import type { Command, CommandResult } from '../../commands';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import { LogHandler } from '@/utilities/log-handler';

/** Minimum state shared by all growable entities */
export interface GrowableState {
    /** Growth progress (0-1). Interpretation depends on the subclass/stage. */
    progress: number;
    /** Current sprite variation offset (used for change detection in updateVisual) */
    currentOffset: number;
}

/** Configuration for a growable system */
export interface GrowableConfig {
    /** Seconds from planted (progress=0) to mature (progress=1) */
    growthTime: number;
    /** Tile search radius when finding planting spots */
    plantingSearchRadius: number;
    /** Min squared distance between same-category entities. 0 to skip proximity check. */
    minDistanceSq: number;
    /** Object category for proximity filtering in findPlantingSpot */
    objectCategory: MapObjectCategory;
    /** Object types that can be randomly selected when planting */
    plantableTypes: readonly MapObjectType[];
    /** If true, all 4 cardinal neighbors must also be free when planting */
    requireFreeNeighbors?: boolean;
}

/** Interface for systems that support finding spots and planting entities */
export interface PlantingCapable {
    findPlantingSpot(cx: number, cy: number, radius?: number): { x: number; y: number } | null;
    plantEntity(x: number, y: number, settlerId: number): void;
}

/**
 * Abstract base for systems managing growable map objects.
 * Subclasses implement domain-specific stages, visuals, and tick behavior.
 */
// prettier-ignore
export abstract class GrowableSystem<TState extends GrowableState = GrowableState> implements TickSystem, PlantingCapable {
    protected readonly states = new Map<number, TState>();
    protected readonly gameState: GameState;
    protected readonly visualService: EntityVisualService;
    protected readonly config: GrowableConfig;
    protected readonly log: LogHandler;
    protected _executeCommand!: (cmd: Command) => CommandResult;

    constructor(gameState: GameState, visualService: EntityVisualService, config: GrowableConfig, logName: string) {
        this.gameState = gameState;
        this.visualService = visualService;
        this.config = config;
        this.log = new LogHandler(logName);
    }

    /** Wire up command execution (called after command system is initialized) */
    setCommandExecutor(executor: (cmd: Command) => CommandResult): void {
        this._executeCommand = executor;
    }

    // ── Abstract methods (subclass must implement) ───────────────

    /** Return true if this objectType should be managed by this system */
    protected abstract shouldRegister(objectType: MapObjectType): boolean;

    /** Create initial state for a registered entity */
    protected abstract createState(planted: boolean, objectType: MapObjectType): TState;

    /** Map current state to a sprite variation offset */
    protected abstract getSpriteOffset(state: TState): number;

    /** Called when sprite offset changes (for starting/stopping animations) */
    protected abstract onOffsetChanged(entityId: number, newOffset: number, state: TState): void;

    /** Advance entity state by dt. Return 'remove' to delete the entity after this tick. */
    protected abstract tickState(entityId: number, state: TState, dt: number): 'keep' | 'remove';

    /** Build the Command object for planting an entity of the given type at (x, y) */
    protected abstract buildPlantCommand(objectType: MapObjectType, x: number, y: number): Command;

    // ── State management ─────────────────────────────────────────

    /**
     * Register an entity with this system.
     * Only registers if shouldRegister() returns true for the object type.
     * @param planted If true, entity starts in growing state; otherwise mature/normal
     */
    register(entityId: number, objectType: MapObjectType, planted: boolean = false): void {
        if (!this.shouldRegister(objectType)) return;

        this.gameState.getEntityOrThrow(entityId, `${this.config.objectCategory} for registration`);
        const state = this.createState(planted, objectType);
        this.states.set(entityId, state);

        this.visualService.setVariation(entityId, state.currentOffset);
        this.onOffsetChanged(entityId, state.currentOffset, state);
    }

    /** Remove entity state (called on entity removal) */
    unregister(entityId: number): void {
        this.states.delete(entityId);
    }

    /** Get entity state by ID */
    getState(entityId: number): TState | undefined {
        return this.states.get(entityId);
    }

    // ── Visual update ────────────────────────────────────────────

    /** Update visual variation if the sprite offset changed. */
    protected updateVisual(entityId: number, state: TState): void {
        const offset = this.getSpriteOffset(state);
        if (offset !== state.currentOffset) {
            state.currentOffset = offset;
            this.visualService.setVariation(entityId, offset);
            this.onOffsetChanged(entityId, offset, state);
        }
    }

    // ── Growth helper ────────────────────────────────────────────

    /**
     * Advance growth progress by dt. Returns true when growth completes (progress >= 1).
     * Resets progress to 0 on completion so the subclass can transition to the next stage.
     */
    protected advanceGrowth(state: TState, dt: number): boolean {
        state.progress += dt / this.config.growthTime;
        if (state.progress >= 1) {
            state.progress = 0;
            return true;
        }
        return false;
    }

    // ── Tick ─────────────────────────────────────────────────────

    tick(dt: number): void {
        const toRemove: number[] = [];

        for (const [entityId, state] of this.states) {
            if (this.tickState(entityId, state, dt) === 'remove') {
                toRemove.push(entityId);
            }
        }

        for (const entityId of toRemove) {
            this.gameState.removeEntity(entityId);
        }
    }

    // ── Planting ─────────────────────────────────────────────────

    /** Find an empty tile near (cx, cy) that respects spacing constraints */
    findPlantingSpot(cx: number, cy: number, radius?: number): { x: number; y: number } | null {
        return findEmptySpot(cx, cy, {
            gameState: this.gameState,
            searchRadius: radius ?? this.config.plantingSearchRadius,
            minDistanceSq: this.config.minDistanceSq,
            requireFreeNeighbors: this.config.requireFreeNeighbors,
            proximityFilter: entity =>
                entity.type === EntityType.MapObject &&
                OBJECT_TYPE_CATEGORY[entity.subType as MapObjectType] === this.config.objectCategory,
        });
    }

    /** Plant a random entity type at (x, y) via the command system */
    plantEntity(x: number, y: number, settlerId: number): void {
        const objectType = this.gameState.rng.pick(this.config.plantableTypes);
        if (!objectType) throw new Error(`GrowableSystem.plantEntity: plantableTypes is empty (${this.constructor.name})`);
        const result = this._executeCommand(this.buildPlantCommand(objectType, x, y));

        if (result.success) {
            this.log.debug(`Settler ${settlerId} planted ${MapObjectType[objectType]} at (${x}, ${y})`);
        } else {
            this.log.debug(`Settler ${settlerId}: cannot plant at (${x}, ${y}): ${result.error}`);
        }
    }

    /** Plant multiple entities near a position. Returns number planted. */
    plantEntitiesNear(cx: number, cy: number, count: number, radius?: number): number {
        const searchRadius = radius ?? this.config.plantingSearchRadius;
        let planted = 0;

        for (let i = 0; i < count; i++) {
            const spot = this.findPlantingSpot(cx, cy, searchRadius);
            if (!spot) break;

            const objectType = this.gameState.rng.pick(this.config.plantableTypes);
            if (!objectType) throw new Error(`GrowableSystem.plantEntitiesNear: plantableTypes is empty (${this.constructor.name})`);
            const result = this._executeCommand(this.buildPlantCommand(objectType, spot.x, spot.y));
            if (result.success) planted++;
        }

        return planted;
    }

    // ── Persistence ──────────────────────────────────────────────

    /** Iterate all states for serialization */
    *getAllStates(): IterableIterator<[number, TState]> {
        yield* this.states.entries();
    }

    /** Restore a state from serialized data. Updates entity visual variation. */
    restoreState(entityId: number, data: TState): void {
        this.states.set(entityId, data);
        this.visualService.setVariation(entityId, data.currentOffset);
    }

    /** Number of entities tracked */
    get entityCount(): number {
        return this.states.size;
    }
}
