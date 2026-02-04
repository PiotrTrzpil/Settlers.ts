import { Entity, EntityType, UnitState } from './entity';

export class GameState {
    public entities: Entity[] = [];
    public unitStates: Map<number, UnitState> = new Map();
    public selectedEntityId: number | null = null;
    public nextId = 1;

    /** Spatial lookup: "x,y" -> entityId */
    public tileOccupancy: Map<string, number> = new Map();

    private static tileKey(x: number, y: number): string {
        return x + ',' + y;
    }

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
        this.tileOccupancy.set(GameState.tileKey(x, y), entity.id);

        if (type === EntityType.Unit) {
            this.unitStates.set(entity.id, {
                entityId: entity.id,
                path: [],
                pathIndex: 0,
                moveProgress: 0,
                speed: 2 // tiles per second
            });
        }

        return entity;
    }

    public removeEntity(id: number): void {
        const index = this.entities.findIndex(e => e.id === id);
        if (index < 0) return;

        const entity = this.entities[index];
        this.tileOccupancy.delete(GameState.tileKey(entity.x, entity.y));
        this.entities.splice(index, 1);
        this.unitStates.delete(id);

        if (this.selectedEntityId === id) {
            this.selectedEntityId = null;
        }
    }

    public getEntity(id: number): Entity | undefined {
        return this.entities.find(e => e.id === id);
    }

    public getEntityAt(x: number, y: number): Entity | undefined {
        const id = this.tileOccupancy.get(GameState.tileKey(x, y));
        if (id === undefined) return undefined;
        return this.getEntity(id);
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

    /** Update occupancy when an entity moves */
    public updateEntityPosition(id: number, newX: number, newY: number): void {
        const entity = this.getEntity(id);
        if (!entity) return;

        this.tileOccupancy.delete(GameState.tileKey(entity.x, entity.y));
        entity.x = newX;
        entity.y = newY;
        this.tileOccupancy.set(GameState.tileKey(newX, newY), id);
    }
}
