/**
 * Populates resource stacks from map entity data.
 * Maps S4GoodType to internal EMaterialType and creates stacked resource entities.
 */

import { EntityType } from '../entity';
import { GameState } from '../game-state';
import { S4_TO_MATERIAL_TYPE } from '../game-data-access';
import { LogHandler } from '@/utilities/log-handler';
import type { MapStackData } from '@/resources/map/map-entity-data';
import { S4GoodType } from '@/resources/map/s4-types';

const log = new LogHandler('Map:Stacks');

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
