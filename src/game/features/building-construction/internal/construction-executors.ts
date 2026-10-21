/**
 * Construction choreo executors — DIG_TILE and BUILD_STEP.
 *
 * Single-tick executors: work happens instantly on arrival, returning DONE
 * so the Construction job's owner can push the next assignment. Both read their
 * site (and tile) from `node.args`, and are irreversible: a restored job never
 * snaps back across a completed dig / build step.
 */

import { ChoreoTaskType, TaskResult, type ChoreoNode } from '../../../systems/choreo/types';
import type { ChoreoSystem, ChoreoExecutor, ChoreoNodeHooks } from '../../../systems/choreo/choreo-system';
import type { ConstructionSiteManager } from '../construction-site-manager';
import type { BuildingInventoryManager } from '../../inventory';

/** Number of build cycles before one material unit is consumed. */
const BUILD_CYCLES_PER_MATERIAL = 10;

/** A completed dig / build step is never repeated by a restored job. */
const CONSTRUCTION_WORK_HOOKS: ChoreoNodeHooks = { irreversible: true };

function digTileArgs(node: ChoreoNode): { readonly siteId: number; readonly tileIndex: number } {
    if (!node.args || node.args.task !== 'digTile') {
        throw new Error(`DIG_TILE node has no digTile args`);
    }
    return node.args;
}

function buildStepSiteId(node: ChoreoNode): number {
    if (!node.args || node.args.task !== 'buildStep') {
        throw new Error(`BUILD_STEP node has no buildStep args`);
    }
    return node.args.siteId;
}

/**
 * Create a DIG_TILE executor.
 * Reads siteId and tileIndex from the node args, completes the tile, returns DONE.
 * The site must exist (its removal cancels the diggers' jobs) — a missing one throws ⇒ FAILED.
 */
export function createDigTileExecutor(constructionSiteManager: ConstructionSiteManager): ChoreoExecutor {
    return (_settler, _job, node) => {
        const { siteId, tileIndex } = digTileArgs(node);
        constructionSiteManager.completeTile(siteId, tileIndex);
        return TaskResult.DONE;
    };
}

/**
 * Create a BUILD_STEP executor.
 * Advances construction progress by one cycle's worth, consumes a material unit
 * every BUILD_CYCLES_PER_MATERIAL cycles by withdrawing it from the building's
 * inventory. This causes pile visuals to shrink proportionally as construction
 * progresses. A site that completed while the builder walked is gone — DONE, nothing to build.
 */
export function createBuildStepExecutor(
    constructionSiteManager: ConstructionSiteManager,
    inventoryManager: BuildingInventoryManager
): ChoreoExecutor {
    return (_settler, _job, node) => {
        const siteId = buildStepSiteId(node);
        const site = constructionSiteManager.getSite(siteId);
        if (!site) {
            return TaskResult.DONE;
        }

        const progressPerMaterial = 1.0 / site.materials.totalCost;
        const progressPerCycle = progressPerMaterial / BUILD_CYCLES_PER_MATERIAL;

        // Consume one material unit every BUILD_CYCLES_PER_MATERIAL cycles.
        // Progress only advances when materials are available — no empty hammering.
        if (constructionSiteManager.advanceBuildCycle(siteId, BUILD_CYCLES_PER_MATERIAL)) {
            const material = constructionSiteManager.consumeNextMaterial(siteId);
            if (material !== null) {
                const withdrawn = inventoryManager.withdrawInput(siteId, material, 1);
                if (withdrawn === 0) {
                    throw new Error(
                        `Construction: site ${siteId} has no stock for ${material} — consumeNextMaterial returned it but input slot is empty`
                    );
                }
            }
        }

        // Advance progress based on consumed materials (totalOut sum across all cost materials).
        const consumedAmount = site.materials.costs.reduce(
            (sum, cost) => sum + inventoryManager.getThroughput(siteId, cost.material).totalOut,
            0
        );
        const targetProgress =
            consumedAmount * progressPerMaterial + constructionSiteManager.getBuildCycle(siteId) * progressPerCycle;
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
    choreoSystem.register(
        ChoreoTaskType.DIG_TILE,
        createDigTileExecutor(constructionSiteManager),
        CONSTRUCTION_WORK_HOOKS
    );
    choreoSystem.register(
        ChoreoTaskType.BUILD_STEP,
        createBuildStepExecutor(constructionSiteManager, inventoryManager),
        CONSTRUCTION_WORK_HOOKS
    );
}
