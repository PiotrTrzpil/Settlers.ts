import {
    Entity,
    EntityType,
    UnitType,
    tileKey,
    BuildingType,
    getBuildingFootprint,
    type CarryingState,
    type Tile,
} from './entity';
import { Race } from './core/race';
import { getBuildingBlockArea, getBuildingPassableTiles } from './buildings/types';
import type { MovementSystem } from './systems/movement/index';
import { SeededRng, createGameRng } from './core/rng';
import { EventBus } from './event-bus';
import { SelectionManager } from './ui/selection-manager';
import { type ComponentStore, mapStore } from './ecs';
import { EntityIndex } from './entity-index';
import type { SpatialGrid } from './spatial-grid';
import { UnitStateMap, resolveEntitySelectable } from './unit-state-adapter';

export type { UnitStateView, UnitStateLookup } from './unit-state-adapter';

/** Options for addEntity — all optional, with sensible defaults. */
export interface AddEntityOptions {
    selectable?: boolean;
    variation?: number;
    race?: Race;
    /** Set false to skip occupancy registration (visual-only entities). Defaults to true. */
    occupancy?: boolean;
    /** Building is already completed (not a construction site). Sets buildingOccupancy at creation time. */
    completed?: boolean;
}

/** Options for addUnit. Race is validated at runtime (throws if missing). */
export interface AddUnitOptions {
    race?: Race;
    selectable?: boolean;
    /** Set false to skip occupancy registration (visual-only entities). Defaults to true. */
    occupancy?: boolean;
}

/** Options for addBuilding. Race is validated at runtime (throws if missing). */
export interface AddBuildingOptions {
    race?: Race;
}

/**
 * Core entity store and spatial index.
 *
 * GameState is responsible for:
 * - Entity CRUD (add, remove, get)
 * - Spatial queries (getEntityAt, getEntitiesInRect, getEntitiesInRadius)
 * - Tile occupancy tracking
 *
 * Extracted concerns (owned here but encapsulated in dedicated classes):
 * - Selection state → SelectionManager
 * - Movement → MovementSystem (created externally, set via initMovement)
 */
export class GameState {
    public entities: Entity[] = [];
    /** O(1) entity lookup by ID */
    private entityMap: Map<number, Entity> = new Map();

    /** Uniform read-only view for cross-cutting queries */
    readonly store: ComponentStore<Entity> = mapStore(this.entityMap);

    /** Fast lookup by entity type and player — maintained on add/remove. */
    public readonly entityIndex = new EntityIndex(id => this.entityMap.get(id));

    /** Spatial hash with territory-aware cell states — set via initSpatialIndex() */
    public spatialIndex!: SpatialGrid;

    /** Movement system for all units — set by GameServices before adding entities */
    public movement!: MovementSystem;

    /** Adapter providing UnitStateView lookup — wraps movement system */
    public unitStates!: UnitStateMap;

    /** Seeded RNG for deterministic game logic — use this instead of Math.random() */
    public readonly rng: SeededRng;

    /** Player entity selection state */
    public readonly selection: SelectionManager;

    public nextId = 1;

    /** Ground-layer occupancy: buildings (footprints), map objects, stacked piles */
    public groundOccupancy: Map<string, number> = new Map();

    /** Unit-layer occupancy: all walking/visible units (settlers, military) */
    public unitOccupancy: Map<string, number> = new Map();

    /** Building footprint tiles — always blocks pathfinding */
    public buildingOccupancy: Set<string> = new Set();

    /** All building footprint tiles (including door corridors) — used for placement gap check */
    public buildingFootprint: Set<string> = new Set();

    /** Per-player race mapping (player index → Race). Set via setPlayerRaces() before adding entities. */
    public playerRaces: ReadonlyMap<number, Race> = new Map();

    /** Event bus for entity lifecycle events */
    private readonly eventBus: EventBus;

    constructor(eventBus: EventBus, currentPlayerFn: () => number, seed?: number) {
        this.eventBus = eventBus;
        this.rng = createGameRng(seed);
        this.selection = new SelectionManager(this, currentPlayerFn);
    }

    /**
     * Initialize the movement system (and legacy unitStates adapter).
     * Called by GameServices before any entities are added.
     */
    public initMovement(movement: MovementSystem): void {
        this.movement = movement;
        this.unitStates = new UnitStateMap(movement);
    }

    /**
     * Initialize the spatial index for map objects and stacked piles.
     * Called by the TerritoryFeature after terrain data and getOwner are available.
     */
    public initSpatialIndex(spatialIndex: SpatialGrid): void {
        this.spatialIndex = spatialIndex;
    }

    /**
     * Add an entity to the game state.
     * Selectability rules:
     * - Units: determined by UnitCategory (Military and Religious are selectable)
     * - Buildings: selectable
     * - MapObject/StackedPile: NOT selectable
     * Speed defaults to UnitTypeConfig value for units.
     */

    public addEntity(
        type: EntityType,
        subType: number | string,
        tile: Tile,
        player: number,
        opts?: AddEntityOptions
    ): Entity {
        const { selectable, variation, occupancy: explicitOccupancy, race: explicitRace, completed } = opts ?? {};
        // eslint-disable-next-line no-restricted-syntax -- optional flag with sensible boolean default
        const occupancy = explicitOccupancy ?? true;

        // Resolve race: explicit opt > player lookup > fallback for non-unit/building types
        const race = explicitRace ?? this.playerRaces.get(player);
        if (type === EntityType.Building && race === undefined) {
            throw new Error(`addEntity: race is required for buildings (BuildingType ${String(subType)})`);
        }
        if (type === EntityType.Unit && race === undefined) {
            throw new Error(`addEntity: race is required for units (UnitType ${subType})`);
        }
        // Race is unused for MapObject / StackedPile / Decoration — any value works.
        const entityRace: Race = race ?? Race.Roman;
        const resolvedSelectable = selectable !== undefined ? selectable : resolveEntitySelectable(type, subType);

        // Buildings start non-operational (under construction) unless explicitly completed.
        // All other entity types are operational by default.
        // eslint-disable-next-line no-restricted-syntax -- completed is an optional parameter; false is the correct default (buildings start under construction)
        const operational = type === EntityType.Building ? (completed ?? false) : true;

        const entity: Entity = {
            id: this.nextId++,
            type,
            x: tile.x,
            y: tile.y,
            player,
            subType,
            race: entityRace,
            selectable: resolvedSelectable,
            operational,
        };

        this.entities.push(entity);
        this.entityMap.set(entity.id, entity);
        this.entityIndex.add(entity.id, type, player);

        if (occupancy) {
            this.addSpatialAndOccupancy(entity, type, subType, tile, completed);
        }

        // Emit generic lifecycle event — subscribers handle type-specific initialization
        // (e.g., MovementSystem creates controllers for units, TreeSystem registers trees)
        this.eventBus.emit('entity:created', {
            entityId: entity.id,
            entityType: type,
            subType,
            x: tile.x,
            y: tile.y,
            player,
            // eslint-disable-next-line no-restricted-syntax -- variation is optional in AddEntityOptions; 0 is the correct default sprite variation
            variation: variation ?? 0,
        });

        return entity;
    }

    /**
     * Restore an entity from a snapshot — populates entity table and occupancy maps
     * WITHOUT emitting entity:created events.
     *
     * Used during snapshot restoration so features restore their own state from
     * serialized data rather than reacting to creation events.
     * The caller must set nextId appropriately before/after calling this.
     */
    public restoreEntity(data: {
        id: number;
        type: EntityType;
        subType: number | string;
        x: number;
        y: number;
        player: number;
        race?: Race;
        carrying?: CarryingState;
        hidden?: boolean;
    }): Entity {
        const race = data.race ?? this.playerRaces.get(data.player) ?? Race.Roman;
        const resolvedSelectable = resolveEntitySelectable(data.type, data.subType);

        const entity: Entity = {
            id: data.id,
            type: data.type,
            x: data.x,
            y: data.y,
            player: data.player,
            subType: data.subType,
            race,
            selectable: resolvedSelectable,
            operational: true,
        };

        if (data.carrying) {
            entity.carrying = data.carrying;
        }
        if (data.hidden) {
            entity.hidden = data.hidden;
        }

        this.entities.push(entity);
        this.entityMap.set(entity.id, entity);
        this.entityIndex.add(entity.id, data.type, data.player);

        // Update nextId to stay ahead of restored entity IDs
        if (data.id >= this.nextId) {
            this.nextId = data.id + 1;
        }

        this.addSpatialAndOccupancy(entity, data.type, data.subType, data);

        return entity;
    }

    /** Add entity to spatial index and occupancy maps (ground or unit layer). */
    private addSpatialAndOccupancy(
        entity: Entity,
        type: EntityType,
        subType: number | string,
        tile: Tile,
        completed?: boolean
    ): void {
        // Add to spatial grid for map objects and stacked piles
        if (type === EntityType.MapObject || type === EntityType.StackedPile) {
            this.spatialIndex.add(entity.id, tile);
        }

        // Route to correct occupancy layer.
        // Decoration entities (flags, signs) are visual-only — no occupancy.
        if (type === EntityType.Decoration) {
            return;
        }

        if (type === EntityType.Building) {
            this.addBuildingOccupancy(entity, subType, tile, completed);
        } else if (type === EntityType.Unit) {
            this.unitOccupancy.set(tileKey(tile), entity.id);
        } else {
            this.addGroundEntityOccupancy(entity.id, type, subType, tile);
        }
    }

    /** Register building footprint in ground occupancy. */
    private addBuildingOccupancy(entity: Entity, subType: number | string, tile: Tile, completed?: boolean): void {
        // buildingOccupancy is NOT set here by default — construction sites start walkable.
        // Completed buildings set it via restoreBuildingFootprintBlock (excludes door tiles).
        const footprint = getBuildingFootprint(tile, subType as BuildingType, entity.race);
        for (const footprintTile of footprint) {
            const key = tileKey(footprintTile);
            this.groundOccupancy.set(key, entity.id);
            this.buildingFootprint.add(key);
        }
        if (completed) {
            this.restoreBuildingFootprintBlock(entity.id);
        }
    }

    /**
     * Register a non-building, non-unit entity (MapObject, StackedPile) in ground occupancy.
     *
     * StackedPiles are allowed on building footprint tiles (input/output/storage slots
     * sit on the building footprint by design). All other overlaps are rejected.
     */
    private addGroundEntityOccupancy(entityId: number, type: EntityType, subType: number | string, tile: Tile): void {
        const key = tileKey(tile);
        const occupantId = this.groundOccupancy.get(key);
        if (occupantId !== undefined) {
            const occupant = this.entityMap.get(occupantId);

            // Piles on building footprint tiles are valid (input/output/storage slots)
            if (type === EntityType.StackedPile && occupant?.type === EntityType.Building) {
                // Don't overwrite the building in groundOccupancy — the building owns the tile.
                // The pile is tracked via spatialIndex (set in addSpatialAndOccupancy).
                return;
            }

            const desc =
                occupant?.type === EntityType.Building
                    ? `building #${occupantId} (${String(occupant.subType)})`
                    : // eslint-disable-next-line no-restricted-syntax -- occupant type may be unknown when building an error description; 0 gives a safe enum fallback for display only
                      `${EntityType[occupant?.type ?? 0]} #${occupantId}`;
            throw new Error(
                `addEntity: cannot place ${EntityType[type]} (subType=${String(subType)}) at (${tile.x},${tile.y}) — tile occupied by ${desc}`
            );
        }
        this.groundOccupancy.set(key, entityId);
    }

    /** Spawn a unit. Race is required (throws if missing). */
    public addUnit(unitType: UnitType, tile: Tile, player: number, opts?: AddUnitOptions): Entity {
        return this.addEntity(EntityType.Unit, unitType, tile, player, opts);
    }

    /** Place a building. Race is required (throws if missing). */
    public addBuilding(buildingType: BuildingType, tile: Tile, player: number, opts?: AddBuildingOptions): Entity {
        return this.addEntity(EntityType.Building, buildingType, tile, player, opts);
    }

    /**
     * Remove a building's non-door footprint tiles from buildingOccupancy.
     * Used for construction sites — their footprints should be walkable during leveling.
     */
    public clearBuildingFootprintBlock(buildingId: number): void {
        const entity = this.entityMap.get(buildingId);
        if (!entity || entity.type !== EntityType.Building) {
            return;
        }
        const blockArea = getBuildingBlockArea(entity, entity.subType as BuildingType, entity.race);
        for (const tile of blockArea) {
            this.buildingOccupancy.delete(tileKey(tile));
        }
    }

    /**
     * Re-add a building's non-door footprint tiles to buildingOccupancy.
     * Used when a construction site finishes leveling and the structure starts rising.
     */
    public restoreBuildingFootprintBlock(buildingId: number): void {
        const entity = this.entityMap.get(buildingId);
        if (!entity || entity.type !== EntityType.Building) {
            return;
        }
        const blockArea = getBuildingBlockArea(entity, entity.subType as BuildingType, entity.race);
        const passableKeys = getBuildingPassableTiles(entity, entity.subType as BuildingType, entity.race, blockArea);
        for (const tile of blockArea) {
            const key = tileKey(tile);
            if (!passableKeys.has(key)) {
                this.buildingOccupancy.add(key);
            }
        }
    }

    public removeEntity(id: number): void {
        const entity = this.entityMap.get(id);
        if (!entity) {
            return;
        }

        const index = this.entities.indexOf(entity);
        if (index >= 0) {
            this.entities.splice(index, 1);
        }

        // Remove from spatial grid before index removal
        if (entity.type === EntityType.MapObject || entity.type === EntityType.StackedPile) {
            this.spatialIndex.remove(id);
        }

        this.entityIndex.remove(id, entity.type, entity.player);

        // Remove occupancy from the correct layer
        if (entity.type === EntityType.Building) {
            const footprint = getBuildingFootprint(entity, entity.subType as BuildingType, entity.race);
            for (const tile of footprint) {
                const key = tileKey(tile);
                this.groundOccupancy.delete(key);
                this.buildingOccupancy.delete(key);
                this.buildingFootprint.delete(key);
            }
        } else if (entity.type === EntityType.Unit) {
            const key = tileKey(entity);
            if (this.unitOccupancy.get(key) === id) {
                this.unitOccupancy.delete(key);
            }
        } else {
            this.groundOccupancy.delete(tileKey(entity));
        }

        this.entityMap.delete(id);

        // Emit AFTER deleting from entityMap. Pass the entity snapshot so handlers
        // (e.g. MaterialTransfer.onEntityRemoved) can read state without querying entityMap.
        this.eventBus.emit('entity:removed', { entityId: id, entity });

        this.selection.deselect(id);
    }

    public getEntity(id: number): Entity | undefined {
        return this.entityMap.get(id);
    }

    /**
     * Get an entity by ID, throwing if it doesn't exist.
     * Use this when the entity MUST exist by contract.
     * @param id Entity ID
     * @param context Optional context for error message (e.g., "source building", "carrier")
     * @throws Error if entity not found, with ID and context
     */
    public getEntityOrThrow(id: number, context?: string): Entity {
        const entity = this.entityMap.get(id);
        if (!entity) {
            const ctx = context ? ` (${context})` : '';
            throw new Error(`Entity ${id}${ctx} not found`);
        }
        return entity;
    }

    /** Get the ground entity (building/map-object/pile) at a tile, or undefined. */
    public getGroundEntityAt(tile: Tile): Entity | undefined {
        const id = this.groundOccupancy.get(tileKey(tile));
        if (id === undefined) {
            return undefined;
        }
        return this.entityMap.get(id);
    }

    /** Get the unit at a tile, or undefined. */
    public getUnitAt(tile: Tile): Entity | undefined {
        const id = this.unitOccupancy.get(tileKey(tile));
        if (id === undefined) {
            return undefined;
        }
        return this.entityMap.get(id);
    }

    /**
     * Get any entity at a tile. Checks ground first, then unit layer.
     * Most callers should use getGroundEntityAt() or getUnitAt() instead.
     */
    public getEntityAt(tile: Tile): Entity | undefined {
        return this.getGroundEntityAt(tile) ?? this.getUnitAt(tile);
    }

    public getEntitiesInRadius(center: Tile, radius: number): Entity[] {
        const result: Entity[] = [];
        const r2 = radius * radius;
        for (const entity of this.entities) {
            const dx = entity.x - center.x;
            const dy = entity.y - center.y;
            if (dx * dx + dy * dy <= r2) {
                result.push(entity);
            }
        }
        return result;
    }

    /** Get all entities within a rectangular tile region */
    public getEntitiesInRect(topLeft: Tile, bottomRight: Tile): Entity[] {
        const minX = Math.min(topLeft.x, bottomRight.x);
        const maxX = Math.max(topLeft.x, bottomRight.x);
        const minY = Math.min(topLeft.y, bottomRight.y);
        const maxY = Math.max(topLeft.y, bottomRight.y);

        return this.entities.filter(e => e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY);
    }

    /**
     * Re-index an entity under a new player. Updates entity.player, entity.race, and EntityIndex.
     * Used when a building is captured during a siege.
     */
    public changeEntityOwner(entityId: number, newPlayer: number): void {
        const entity = this.getEntityOrThrow(entityId, 'changeEntityOwner');
        const oldPlayer = entity.player;

        const newRace = this.playerRaces.get(newPlayer);
        if (newRace === undefined) {
            throw new Error(`changeEntityOwner: no race mapping for player ${newPlayer}`);
        }

        // Re-index: remove from old (type, player) bucket, add to new
        this.entityIndex.remove(entityId, entity.type, oldPlayer);
        entity.player = newPlayer;
        // Buildings keep their original race (visual/sprite identity); only units change race
        if (entity.type !== EntityType.Building) {
            entity.race = newRace;
        }
        this.entityIndex.add(entityId, entity.type, newPlayer);

        this.eventBus.emit('building:ownerChanged', {
            buildingId: entityId,
            buildingType: entity.subType as BuildingType,
            oldPlayer,
            newPlayer,
            level: 'info',
        });
    }

    /**
     * Remove a unit's occupancy entry (e.g. when it enters a building).
     * Only clears if the entity currently owns the tile.
     */
    public clearTileOccupancy(entityId: number): void {
        const entity = this.entityMap.get(entityId);
        if (!entity) {
            return;
        }
        const key = tileKey(entity);
        if (this.unitOccupancy.get(key) === entityId) {
            this.unitOccupancy.delete(key);
        }
    }

    /**
     * Restore a unit's occupancy entry (e.g. when it exits a building).
     */
    public restoreTileOccupancy(entityId: number): void {
        const entity = this.entityMap.get(entityId);
        if (!entity) {
            return;
        }
        const key = tileKey(entity);
        this.unitOccupancy.set(key, entityId);
    }

    /** Update occupancy when a unit moves. Only units move, so always uses unitOccupancy. */
    public updateEntityPosition(id: number, newPos: Tile): void {
        const entity = this.entityMap.get(id);
        if (!entity) {
            return;
        }

        // Clear old occupancy if this entity still owns the tile
        const oldKey = tileKey(entity);
        if (this.unitOccupancy.get(oldKey) === id) {
            this.unitOccupancy.delete(oldKey);
        }
        entity.x = newPos.x;
        entity.y = newPos.y;
        this.unitOccupancy.set(tileKey(newPos), id);
    }
}
