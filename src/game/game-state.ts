import {
    Entity,
    EntityType,
    UnitType,
    tileKey,
    BuildingType,
    getBuildingFootprint,
    isUnitTypeSelectable,
} from './entity';
import { Race } from './race';
import { getBuildingDoorCorridor } from './buildings/types';
import type { MovementSystem, MovementController } from './systems/movement/index';
import { SeededRng, createGameRng } from './rng';
import { EventBus } from './event-bus';
import { SelectionManager } from './selection-manager';
import { StackedResourceManager } from './stacked-resource-manager';

/**
 * Legacy UnitState interface for backward compatibility.
 * This is a read-only view into a MovementController.
 * Note: Animation-related state (idleTime, etc.) is now managed by the animation system.
 */
export interface UnitStateView {
    readonly entityId: number;
    readonly path: ReadonlyArray<{ x: number; y: number }>;
    readonly pathIndex: number;
    readonly moveProgress: number;
    readonly speed: number;
    readonly prevX: number;
    readonly prevY: number;
}

/**
 * Interface for looking up unit states by entity ID.
 * Used by renderers and other systems that need to access unit movement state.
 */
export interface UnitStateLookup {
    get(entityId: number): UnitStateView | undefined;
}

/**
 * Adapter that wraps a MovementController as a UnitStateView.
 * Provides backward-compatible read access to movement state.
 */
class UnitStateAdapter implements UnitStateView {
    constructor(private controller: MovementController) {}

    get entityId(): number {
        return this.controller.entityId;
    }
    get path(): ReadonlyArray<{ x: number; y: number }> {
        return this.controller.path;
    }
    get pathIndex(): number {
        return this.controller.pathIndex;
    }
    get moveProgress(): number {
        return this.controller.progress;
    }
    get speed(): number {
        return this.controller.speed;
    }
    get prevX(): number {
        return this.controller.prevTileX;
    }
    get prevY(): number {
        return this.controller.prevTileY;
    }
}

/**
 * Adapter Map that provides legacy unitStates interface.
 * Wraps MovementSystem for backward compatibility with existing code.
 */
class UnitStateMap implements UnitStateLookup {
    constructor(private movementSystem: MovementSystem) {}

    get(entityId: number): UnitStateView | undefined {
        const controller = this.movementSystem.getController(entityId);
        return controller ? new UnitStateAdapter(controller) : undefined;
    }

    has(entityId: number): boolean {
        return this.movementSystem.hasController(entityId);
    }

    delete(entityId: number): boolean {
        if (this.movementSystem.hasController(entityId)) {
            this.movementSystem.removeController(entityId);
            return true;
        }
        return false;
    }

    values(): IterableIterator<UnitStateView> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- needed for generator context
        const self = this;
        return (function* () {
            for (const controller of self.movementSystem.getAllControllers()) {
                yield new UnitStateAdapter(controller);
            }
        })();
    }

    *[Symbol.iterator](): IterableIterator<[number, UnitStateView]> {
        for (const controller of this.movementSystem.getAllControllers()) {
            yield [controller.entityId, new UnitStateAdapter(controller)];
        }
    }
}

/** Determine entity selectability from type + subtype (no explicit override). */
function resolveEntitySelectable(type: EntityType, subType: number): boolean | undefined {
    switch (type) {
    case EntityType.Unit:
        return isUnitTypeSelectable(subType as UnitType);
    case EntityType.Building:
        return true;
    case EntityType.MapObject:
    case EntityType.StackedResource:
    case EntityType.Decoration:
    case EntityType.None:
        return false;
    }
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
 * - Stacked resource state → StackedResourceManager
 * - Movement → MovementSystem (created externally, set via initMovement)
 */
export class GameState {
    public entities: Entity[] = [];
    /** O(1) entity lookup by ID */
    private entityMap: Map<number, Entity> = new Map();

    /** Movement system for all units — set by GameServices before adding entities */
    public movement!: MovementSystem;

    /** Adapter providing UnitStateView lookup — wraps movement system */
    public unitStates!: UnitStateMap;

    /** Seeded RNG for deterministic game logic — use this instead of Math.random() */
    public readonly rng: SeededRng;

    /** Player entity selection state */
    public readonly selection: SelectionManager;

    /** Stacked resource state (quantities, building ownership) */
    public readonly resources: StackedResourceManager;

    public nextId = 1;

    /** Spatial lookup: "x,y" -> entityId */
    public tileOccupancy: Map<string, number> = new Map();

    /** Building footprint tiles — always blocks pathfinding regardless of ignoreOccupancy */
    public buildingOccupancy: Set<string> = new Set();

    /** Event bus for entity lifecycle events */
    private readonly eventBus: EventBus;

    constructor(eventBus: EventBus, seed?: number) {
        this.eventBus = eventBus;
        this.rng = createGameRng(seed);
        this.selection = new SelectionManager(this);
        this.resources = new StackedResourceManager(this);
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
     * Add an entity to the game state.
     * Selectability rules:
     * - Units: determined by UnitCategory (Military and Religious are selectable)
     * - Buildings: selectable
     * - MapObject/StackedResource: NOT selectable
     * Speed defaults to UnitTypeConfig value for units.
     */

    public addEntity(
        type: EntityType,
        subType: number,
        x: number,
        y: number,
        player: number,
        selectable?: boolean,
        variation?: number,
        race?: Race
    ): Entity {
        if (type === EntityType.Building && race === undefined) {
            throw new Error(
                `addEntity: race is required for buildings (BuildingType ${BuildingType[subType as BuildingType]})`
            );
        }
        const entityRace: Race = race !== undefined ? race : Race.Roman;
        const resolvedSelectable = selectable !== undefined ? selectable : resolveEntitySelectable(type, subType);

        const entity: Entity = {
            id: this.nextId++,
            type,
            x,
            y,
            player,
            subType,
            race: entityRace,
            selectable: resolvedSelectable,
        };

        this.entities.push(entity);
        this.entityMap.set(entity.id, entity);

        // Add occupancy for all tiles in the entity's footprint.
        // Decoration entities (flags, signs) are visual-only — no tile occupancy.
        if (type === EntityType.Decoration) {
            // no-op: decorations don't occupy tiles
        } else if (type === EntityType.Building) {
            const footprint = getBuildingFootprint(x, y, subType as BuildingType, entity.race);
            const passableKeys = getBuildingDoorCorridor(x, y, subType as BuildingType, entity.race, footprint);
            for (const tile of footprint) {
                const key = tileKey(tile.x, tile.y);
                this.tileOccupancy.set(key, entity.id);
                if (!passableKeys.has(key)) {
                    this.buildingOccupancy.add(key);
                } else {
                    // Corridor tile: ensure it's passable even if a previously-placed
                    // building's footprint added it to buildingOccupancy.
                    this.buildingOccupancy.delete(key);
                }
            }
        } else {
            this.tileOccupancy.set(tileKey(x, y), entity.id);
        }

        // Emit generic lifecycle event — subscribers handle type-specific initialization
        // (e.g., MovementSystem creates controllers for units, TreeSystem registers trees)
        this.eventBus.emit('entity:created', {
            entityId: entity.id,
            type,
            subType,
            x,
            y,
            player,
            variation: variation ?? 0,
        });

        return entity;
    }

    /**
     * Remove a building's non-door footprint tiles from buildingOccupancy.
     * Used for construction sites — their footprints should be walkable during leveling.
     */
    public clearBuildingFootprintBlock(buildingId: number): void {
        const entity = this.entityMap.get(buildingId);
        if (!entity || entity.type !== EntityType.Building) return;
        const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType, entity.race);
        for (const tile of footprint) {
            this.buildingOccupancy.delete(tileKey(tile.x, tile.y));
        }
    }

    /**
     * Re-add a building's non-door footprint tiles to buildingOccupancy.
     * Used when a construction site finishes leveling and the structure starts rising.
     */
    public restoreBuildingFootprintBlock(buildingId: number): void {
        const entity = this.entityMap.get(buildingId);
        if (!entity || entity.type !== EntityType.Building) return;
        const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType, entity.race);
        const passableKeys = getBuildingDoorCorridor(
            entity.x,
            entity.y,
            entity.subType as BuildingType,
            entity.race,
            footprint
        );
        for (const tile of footprint) {
            const key = tileKey(tile.x, tile.y);
            if (!passableKeys.has(key)) {
                this.buildingOccupancy.add(key);
            }
        }
    }

    public removeEntity(id: number): void {
        const entity = this.entityMap.get(id);
        if (!entity) return;

        const index = this.entities.indexOf(entity);
        if (index >= 0) {
            this.entities.splice(index, 1);
        }

        this.entityMap.delete(id);

        // Remove occupancy for all tiles in the entity's footprint
        if (entity.type === EntityType.Building) {
            const footprint = getBuildingFootprint(entity.x, entity.y, entity.subType as BuildingType, entity.race);
            for (const tile of footprint) {
                this.tileOccupancy.delete(tileKey(tile.x, tile.y));
                this.buildingOccupancy.delete(tileKey(tile.x, tile.y));
            }
        } else {
            this.tileOccupancy.delete(tileKey(entity.x, entity.y));
        }

        // Emit event for system cleanup (movement controllers, carrier state, inventory, etc.)
        this.eventBus.emit('entity:removed', { entityId: id });

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

    public getEntityAt(x: number, y: number): Entity | undefined {
        const id = this.tileOccupancy.get(tileKey(x, y));
        if (id === undefined) return undefined;
        return this.entityMap.get(id);
    }

    public getEntitiesInRadius(x: number, y: number, radius: number): Entity[] {
        const result: Entity[] = [];
        const r2 = radius * radius;
        for (const entity of this.entities) {
            const dx = entity.x - x;
            const dy = entity.y - y;
            if (dx * dx + dy * dy <= r2) {
                result.push(entity);
            }
        }
        return result;
    }

    /** Get all entities within a rectangular tile region */
    public getEntitiesInRect(x1: number, y1: number, x2: number, y2: number): Entity[] {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        return this.entities.filter(e => e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY);
    }

    /** Update occupancy when an entity moves */
    public updateEntityPosition(id: number, newX: number, newY: number): void {
        const entity = this.entityMap.get(id);
        if (!entity) return;

        // Only clear old occupancy if this entity still owns the tile
        // (another entity like a planted tree may have overwritten it)
        const oldKey = tileKey(entity.x, entity.y);
        if (this.tileOccupancy.get(oldKey) === id) {
            this.tileOccupancy.delete(oldKey);
        }
        entity.x = newX;
        entity.y = newY;
        // Units must not overwrite static entity (building/map object) occupancy
        const newKey = tileKey(newX, newY);
        const occupant = this.tileOccupancy.get(newKey);
        if (occupant === undefined || this.entityMap.get(occupant)?.type === EntityType.Unit) {
            this.tileOccupancy.set(newKey, id);
        }
    }
}
