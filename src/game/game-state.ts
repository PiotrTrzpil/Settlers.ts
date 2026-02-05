import { Entity, EntityType, UnitState, BuildingState, BuildingConstructionPhase, tileKey } from './entity';

/** Default building construction duration in seconds */
export const DEFAULT_CONSTRUCTION_DURATION = 30;

export class GameState {
    public entities: Entity[] = [];
    /** O(1) entity lookup by ID */
    private entityMap: Map<number, Entity> = new Map();
    public unitStates: Map<number, UnitState> = new Map();
    /** Building construction state tracking */
    public buildingStates: Map<number, BuildingState> = new Map();
    /** Primary selection (first selected entity or single selection) */
    public selectedEntityId: number | null = null;
    /** All selected entity IDs (for multi-select) */
    public selectedEntityIds: Set<number> = new Set();
    public nextId = 1;

    /** Spatial lookup: "x,y" -> entityId */
    public tileOccupancy: Map<string, number> = new Map();

    public addEntity(type: EntityType, subType: number, x: number, y: number, player: number): Entity {
        const entity: Entity = {
            id: this.nextId++,
            type,
            x,
            y,
            player,
            subType
        };

        this.entities.push(entity);
        this.entityMap.set(entity.id, entity);
        this.tileOccupancy.set(tileKey(x, y), entity.id);

        if (type === EntityType.Unit) {
            this.unitStates.set(entity.id, {
                entityId: entity.id,
                path: [],
                pathIndex: 0,
                moveProgress: 0,
                speed: 2, // tiles per second
                prevX: x,
                prevY: y
            });
        }

        if (type === EntityType.Building) {
            this.buildingStates.set(entity.id, {
                entityId: entity.id,
                phase: BuildingConstructionPhase.Poles,
                phaseProgress: 0,
                totalDuration: DEFAULT_CONSTRUCTION_DURATION,
                elapsedTime: 0,
                tileX: x,
                tileY: y,
                originalTerrain: null,
                terrainModified: false,
            });
        }

        return entity;
    }

    public removeEntity(id: number): void {
        const entity = this.entityMap.get(id);
        if (!entity) return;

        const index = this.entities.indexOf(entity);
        if (index >= 0) {
            this.entities.splice(index, 1);
        }

        this.entityMap.delete(id);
        this.tileOccupancy.delete(tileKey(entity.x, entity.y));
        this.unitStates.delete(id);
        this.buildingStates.delete(id);

        this.selectedEntityIds.delete(id);
        if (this.selectedEntityId === id) {
            this.selectedEntityId = null;
        }
    }

    public getEntity(id: number): Entity | undefined {
        return this.entityMap.get(id);
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

        return this.entities.filter(e =>
            e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY
        );
    }

    /** Update occupancy when an entity moves */
    public updateEntityPosition(id: number, newX: number, newY: number): void {
        const entity = this.entityMap.get(id);
        if (!entity) return;

        this.tileOccupancy.delete(tileKey(entity.x, entity.y));
        entity.x = newX;
        entity.y = newY;
        this.tileOccupancy.set(tileKey(newX, newY), id);
    }
}
