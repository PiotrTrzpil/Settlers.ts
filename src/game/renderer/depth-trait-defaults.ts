/**
 * Flat-sprite depth traits — the only file coupling concrete subtypes to depth behavior.
 *
 * The depth sorter calls isFlatSprite() without knowing about trees or buildings.
 */

import { EntityType, BuildingType } from '../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { TREE_JOB_INDICES, TREE_JOB_OFFSET, TREE_JOBS_PER_TYPE } from './sprite-metadata';

const treeTypes = new Set(Object.keys(TREE_JOB_INDICES).map(Number) as MapObjectType[]);

/** Check if an entity renders flat on the ground (behind standing entities at the same tile). */
export function isFlatSprite(entityType: EntityType, subType: number | string, variation: number): boolean {
    if (entityType === EntityType.Building) {
        return subType === BuildingType.StorageArea;
    }
    if (entityType === EntityType.MapObject && treeTypes.has(subType as MapObjectType)) {
        return variation % TREE_JOBS_PER_TYPE >= TREE_JOB_OFFSET.FALLING;
    }
    return false;
}
