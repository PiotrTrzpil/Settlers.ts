/**
 * Populates resource stacks from map entity data.
 * Maps S4GoodType to internal EMaterialType and creates stacked resource entities.
 */

import { EntityType } from '../entity';
import { EMaterialType } from '../economy/material-type';
import { GameState } from '../game-state';
import { LogHandler } from '@/utilities/log-handler';
import type { MapStackData } from '@/resources/map/map-entity-data';
import { S4GoodType } from '@/resources/map/s4-types';

const log = new LogHandler('Map:Stacks');

/**
 * Mapping from S4GoodType to internal EMaterialType.
 * Only includes types that are implemented in the engine.
 */
const S4_TO_MATERIAL_TYPE: Partial<Record<S4GoodType, EMaterialType>> = {
    [S4GoodType.LOG]: EMaterialType.LOG,
    [S4GoodType.STONE]: EMaterialType.STONE,
    [S4GoodType.COAL]: EMaterialType.COAL,
    [S4GoodType.IRONORE]: EMaterialType.IRONORE,
    [S4GoodType.GOLDORE]: EMaterialType.GOLDORE,
    [S4GoodType.GRAIN]: EMaterialType.GRAIN,
    [S4GoodType.PIG]: EMaterialType.PIG,
    [S4GoodType.WATER]: EMaterialType.WATER,
    [S4GoodType.FISH]: EMaterialType.FISH,
    [S4GoodType.BOARD]: EMaterialType.BOARD,
    [S4GoodType.IRONBAR]: EMaterialType.IRONBAR,
    [S4GoodType.GOLDBAR]: EMaterialType.GOLDBAR,
    [S4GoodType.FLOUR]: EMaterialType.FLOUR,
    [S4GoodType.BREAD]: EMaterialType.BREAD,
    [S4GoodType.MEAT]: EMaterialType.MEAT,
    [S4GoodType.WINE]: EMaterialType.WINE,
    [S4GoodType.AXE]: EMaterialType.AXE,
    [S4GoodType.PICKAXE]: EMaterialType.PICKAXE,
    [S4GoodType.SAW]: EMaterialType.SAW,
    [S4GoodType.HAMMER]: EMaterialType.HAMMER,
    [S4GoodType.SCYTHE]: EMaterialType.SCYTHE,
    [S4GoodType.ROD]: EMaterialType.ROD,
    [S4GoodType.SWORD]: EMaterialType.SWORD,
    [S4GoodType.BOW]: EMaterialType.BOW,
    [S4GoodType.SULFUR]: EMaterialType.SULFUR,
    [S4GoodType.ARMOR]: EMaterialType.ARMOR,
    [S4GoodType.BATTLEAXE]: EMaterialType.BATTLEAXE,
    [S4GoodType.AGAVE]: EMaterialType.AGAVE,
    [S4GoodType.BLOWGUN]: EMaterialType.BLOWGUN,
    [S4GoodType.GOAT]: EMaterialType.GOAT,
    [S4GoodType.MEAD]: EMaterialType.MEAD,
    [S4GoodType.HONEY]: EMaterialType.HONEY,
    [S4GoodType.SHEEP]: EMaterialType.SHEEP,
    [S4GoodType.SHOVEL]: EMaterialType.SHOVEL,
    [S4GoodType.BACKPACKCATAPULT]: EMaterialType.CATAPULT,
    [S4GoodType.GOOSE]: EMaterialType.GOOSE,
    [S4GoodType.TEQUILA]: EMaterialType.TEQUILA,
    [S4GoodType.SUNFLOWER]: EMaterialType.SUNFLOWER,
    [S4GoodType.SUNFLOWEROIL]: EMaterialType.SUNFLOWEROIL,
};

/**
 * Create stacked resource entities from parsed map stack data.
 *
 * Each stack has an amount of 1–8 items. Amounts outside this range indicate
 * a parsing error and the entry is skipped.
 *
 * @returns Number of stacks successfully created
 */
export function populateMapStacks(state: GameState, stacks: MapStackData[]): number {
    let created = 0;
    let skipped = 0;

    for (const stackData of stacks) {
        if (stackData.materialType === S4GoodType.NONE || stackData.amount <= 0) {
            skipped++;
            continue;
        }

        const materialType = S4_TO_MATERIAL_TYPE[stackData.materialType];
        if (materialType === undefined) {
            log.debug(
                `Skipping unmapped material type: ${S4GoodType[stackData.materialType]} at (${stackData.x}, ${stackData.y})`
            );
            skipped++;
            continue;
        }

        if (state.getEntityAt(stackData.x, stackData.y)) {
            log.debug(`Skipping stack at occupied tile (${stackData.x}, ${stackData.y})`);
            skipped++;
            continue;
        }

        const entity = state.addEntity(EntityType.StackedResource, materialType, stackData.x, stackData.y, 0);
        state.resources.createState(entity.id);
        state.resources.setQuantity(entity.id, stackData.amount);

        created++;
    }

    if (skipped > 0) {
        log.debug(`Skipped ${skipped} stacks (unmapped types, occupied tiles, invalid amount, or empty)`);
    }

    return created;
}
