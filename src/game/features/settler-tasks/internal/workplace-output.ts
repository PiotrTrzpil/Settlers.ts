/**
 * Workplace output capacity — whether a job's product would still fit into its home
 * building's output pile. A worker whose output is full waits at home instead of starting.
 */

import type { Entity } from '../../../entity';
import { EMaterialType } from '../../../economy';
import type { BuildingInventoryManager } from '../../inventory';
import { ChoreoTaskType, type ChoreoJob } from '../choreo-types';

/** Node types that put a produced good into the home building's output. */
const OUTPUT_TASKS: ReadonlySet<ChoreoTaskType> = new Set([
    ChoreoTaskType.PUT_GOOD,
    ChoreoTaskType.PUT_GOOD_VIRTUAL,
    ChoreoTaskType.RESOURCE_GATHERING,
    ChoreoTaskType.RESOURCE_GATHERING_VIRTUAL,
]);

/** Parse a material string (e.g. 'GOOD_LOG' or 'LOG') to EMaterialType, or null. */
function parseMaterial(entity: string): EMaterialType | null {
    const key = entity.replace(/^GOOD_/, '');
    const value = EMaterialType[key as keyof typeof EMaterialType] as EMaterialType | undefined;
    // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
    return value ?? null;
}

/**
 * True when the output good declared by the job's first PUT_GOOD / RESOURCE_GATHERING node
 * (or, for multi-recipe jobs without one, the building's production output) has no room left.
 */
export function isWorkplaceOutputFull(
    inventoryManager: BuildingInventoryManager,
    homeBuilding: Entity,
    job: ChoreoJob
): boolean {
    const outputNode = job.nodes.find(n => OUTPUT_TASKS.has(n.task));
    if (!outputNode?.entity) {
        return false;
    }

    const material = parseMaterial(outputNode.entity);
    if (material === null) {
        // GOOD_NO_GOOD / missing entity: fall back to production-config output capacity
        // (ToolSmith, WeaponSmith, and other multi-recipe interior jobs).
        return !inventoryManager.canStoreOutput(homeBuilding.id);
    }

    const slot = inventoryManager.findOutputSlot(homeBuilding.id, material);
    return slot !== undefined && slot.currentAmount >= slot.maxCapacity;
}
