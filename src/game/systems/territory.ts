import { Entity, EntityType, BuildingType } from '../entity';
import { MapSize } from '@/utilities/map-size';

/** No owner sentinel value */
export const NO_OWNER = -1;

/** Territory radius for each building type (in tiles) */
export const BUILDING_TERRITORY_RADIUS: Record<number, number> = {
    [BuildingType.Lumberjack]: 4,
    [BuildingType.Warehouse]: 6,
    [BuildingType.Sawmill]: 4,
    [BuildingType.Stonecutter]: 4,
    [BuildingType.Farm]: 6,
    [BuildingType.Windmill]: 4,
    [BuildingType.Bakery]: 4,
    [BuildingType.Fishery]: 4,
    [BuildingType.PigFarm]: 5,
    [BuildingType.Slaughterhouse]: 4,
    [BuildingType.Waterworks]: 4,
    [BuildingType.CoalMine]: 4,
    [BuildingType.IronMine]: 4,
    [BuildingType.GoldMine]: 4,
    [BuildingType.IronSmelter]: 4,
    [BuildingType.GoldSmelter]: 4,
    [BuildingType.WeaponSmith]: 4,
    [BuildingType.ToolSmith]: 4,
    [BuildingType.Barrack]: 5,
    [BuildingType.Forester]: 6,
    [BuildingType.LivingHouse]: 4,
    [BuildingType.Tower]: 10,
    [BuildingType.Winegrower]: 6,
};

/**
 * Territory system: computes a per-tile ownership map based on building positions.
 *
 * Each building claims tiles within its territory radius.
 * Military buildings (Guardhouse) have the largest radius.
 * When territories overlap, the closest building wins.
 */
export class TerritoryMap {
    /** Per-tile owner: player index, or NO_OWNER (-1) */
    public readonly owner: Int8Array;
    /** Per-tile distance to nearest owning building (for conflict resolution) */
    private readonly distance: Float32Array;

    private readonly mapSize: MapSize;

    constructor(mapSize: MapSize) {
        this.mapSize = mapSize;
        const size = mapSize.width * mapSize.height;
        this.owner = new Int8Array(size).fill(NO_OWNER);
        this.distance = new Float32Array(size).fill(Infinity);
    }

    /**
     * Rebuild the territory map from scratch using all building entities.
     * Called when buildings are added or removed.
     */
    public rebuild(buildings: Entity[]): void {
        // Reset
        this.owner.fill(NO_OWNER);
        this.distance.fill(Infinity);

        for (const building of buildings) {
            if (building.type !== EntityType.Building) continue;

            const radius = BUILDING_TERRITORY_RADIUS[building.subType] ?? 4;
            this.claimTerritory(building.x, building.y, building.player, radius);
        }
    }

    /** Claim tiles around (cx, cy) for the given player within the given radius */
    private claimTerritory(cx: number, cy: number, player: number, radius: number): void {
        const r2 = radius * radius;
        const minX = Math.max(0, cx - radius);
        const maxX = Math.min(this.mapSize.width - 1, cx + radius);
        const minY = Math.max(0, cy - radius);
        const maxY = Math.min(this.mapSize.height - 1, cy + radius);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dx = x - cx;
                const dy = y - cy;
                const dist2 = dx * dx + dy * dy;
                if (dist2 > r2) continue;

                const dist = Math.sqrt(dist2);
                const idx = this.mapSize.toIndex(x, y);

                // Closest building wins
                if (dist < this.distance[idx]) {
                    this.owner[idx] = player;
                    this.distance[idx] = dist;
                }
            }
        }
    }

    /** Check if a tile is owned by a specific player */
    public isOwnedBy(x: number, y: number, player: number): boolean {
        const idx = this.mapSize.toIndex(x, y);
        return this.owner[idx] === player;
    }

    /** Get the owner of a tile, or NO_OWNER */
    public getOwner(x: number, y: number): number {
        return this.owner[this.mapSize.toIndex(x, y)];
    }
}
