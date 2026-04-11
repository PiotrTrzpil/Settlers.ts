/**
 * Construction choreo executors — DIG_TILE and BUILD_STEP.
 *
 * Single-tick executors: work happens instantly on arrival, returning DONE
 * so the demand system can push the next assignment.
 */

import { ChoreoTaskType, TaskResult } from '../../../systems/choreo/types';
import type { ChoreoSystem, ChoreoExecutor } from '../../../systems/choreo/choreo-system';
import type { ConstructionSiteManager } from '../construction-site-manager';
import type { BuildingInventoryManager } from '../../../systems/inventory/building-inventory';

/** Number of build cycles before one material unit is consumed. */
const BUILD_CYCLES_PER_MATERIAL = 10;

/**
 * Create a DIG_TILE executor.
 * Reads siteId and tileIndex from job metadata, completes the tile, returns DONE.
 */
export function createDigTileExecutor(constructionSiteManager: ConstructionSiteManager): ChoreoExecutor {
    return (_settler, job) => {
        const siteId = job.metadata!['siteId'] as number;
        const tileIndex = job.metadata!['tileIndex'] as number;
        constructionSiteManager.completeTile(siteId, tileIndex);
        return TaskResult.DONE;
    };
}

/**
 * Create a BUILD_STEP executor.
 * Advances construction progress by one cycle's worth, consumes a material unit
 * every BUILD_CYCLES_PER_MATERIAL cycles by withdrawing it from the building's
 * inventory. This causes pile visuals to shrink proportionally as construction
 * progresses.
 */
export function createBuildStepExecutor(
    constructionSiteManager: ConstructionSiteManager,
    inventoryManager: BuildingInventoryManager
): ChoreoExecutor {
    const cycleCounters = new Map<number, number>();

    return (_settler, job) => {
        const siteId = job.metadata!['siteId'] as number;
        const site = constructionSiteManager.getSite(siteId);
        if (!site) {
            return TaskResult.DONE;
        }

        const progressPerMaterial = 1.0 / site.materials.totalCost;
        const progressPerCycle = progressPerMaterial / BUILD_CYCLES_PER_MATERIAL;

        // Consume one material unit every BUILD_CYCLES_PER_MATERIAL cycles.
        // Progress only advances when materials are available — no empty hammering.
        // eslint-disable-next-line no-restricted-syntax -- counter starts absent for new sites; 0 is the correct initial cycle count
        const count = (cycleCounters.get(siteId) ?? 0) + 1;
        if (count >= BUILD_CYCLES_PER_MATERIAL) {
            const material = constructionSiteManager.consumeNextMaterial(siteId);
            if (material !== null) {
                const withdrawn = inventoryManager.withdrawInput(siteId, material, 1);
                if (withdrawn === 0) {
                    throw new Error(
                        `Construction: site ${siteId} has no stock for ${material} — consumeNextMaterial returned it but input slot is empty`
                    );
                }
            }
            cycleCounters.set(siteId, 0);
        } else {
            cycleCounters.set(siteId, count);
        }

        // Advance progress based on consumed materials (totalOut sum across all cost materials).
        const consumedAmount = site.materials.costs.reduce(
            (sum, cost) => sum + inventoryManager.getThroughput(siteId, cost.material).totalOut,
            0
        );
        const targetProgress =
            // eslint-disable-next-line no-restricted-syntax -- counter just reset to 0 above; absent entry on first tick is equivalent to 0
            consumedAmount * progressPerMaterial + (cycleCounters.get(siteId) ?? 0) * progressPerCycle;
        constructionSiteManager.setConstructionProgress(siteId, targetProgress);

        return TaskResult.DONE;
    };
}

/** Register DIG_TILE and BUILD_STEP executors on the choreo system. */
export function registerConstructionExecutors(
    choreoSystem: ChoreoSystem,
    constructionSiteManager: ConstructionSiteManager,
    inventoryManager: BuildingInventoryManager
): void {
    choreoSystem.register(ChoreoTaskType.DIG_TILE, createDigTileExecutor(constructionSiteManager));
    choreoSystem.register(
        ChoreoTaskType.BUILD_STEP,
        createBuildStepExecutor(constructionSiteManager, inventoryManager)
    );
}
