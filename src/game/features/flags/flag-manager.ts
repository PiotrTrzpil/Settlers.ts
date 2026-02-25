/**
 * Manages flag decoration entities for buildings.
 *
 * Each completed building gets a small animated flag placed at its tile position.
 * The flag's visual offset comes from BuildingInfo (flag.xOffset/yOffset),
 * applied by the entity renderer at draw time.
 *
 * Flag entities use EntityType.Decoration and do NOT occupy tiles.
 */

import type { GameState } from '../../game-state';
import { EntityType, BuildingType } from '../../entity';
import type { Race } from '../../race';

export class FlagManager {
    /** buildingEntityId → flagEntityId */
    private readonly buildingToFlag = new Map<number, number>();

    constructor(private readonly gameState: GameState) {}

    /**
     * Create a flag entity for a building.
     * @param buildingId The building entity ID
     * @param buildingType The building's BuildingType (stored as subType for offset lookup)
     * @param x Tile X of the building
     * @param y Tile Y of the building
     * @param player Player index (determines flag color)
     * @param race Race (for BuildingInfo lookup in renderer)
     */
    createFlag(buildingId: number, buildingType: BuildingType, x: number, y: number, player: number, race: Race): void {
        if (this.buildingToFlag.has(buildingId)) return;

        const flag = this.gameState.addEntity(EntityType.Decoration, buildingType, x, y, player);
        flag.race = race;
        this.buildingToFlag.set(buildingId, flag.id);
    }

    /**
     * Remove the flag entity associated with a building.
     */
    removeFlag(buildingId: number): void {
        const flagId = this.buildingToFlag.get(buildingId);
        if (flagId === undefined) return;
        this.buildingToFlag.delete(buildingId);
        this.gameState.removeEntity(flagId);
    }

    /**
     * Check if a building has a flag.
     */
    hasFlag(buildingId: number): boolean {
        return this.buildingToFlag.has(buildingId);
    }
}
