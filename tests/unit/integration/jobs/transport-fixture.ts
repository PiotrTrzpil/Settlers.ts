/**
 * Shared fixture for the Transport job specs: a storage area with logs, a sawmill without a worker
 * (so its log input demand is served by carriers and nothing consumes the logs) and N carriers.
 */

import { createSimulation, type Simulation } from '../../helpers/test-simulation';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { ChoreoTaskType } from '@/game/systems/choreo';
import type { JobState } from '@/game/features/settler-tasks';
import type { TransportJobRecord } from '@/game/features/logistics';

export interface TransportFixture {
    sim: Simulation;
    storageId: number;
    sawmillId: number;
    carriers: number[];
}

export function createTransportFixture(carrierCount: number, logs = 6): TransportFixture {
    const sim = createSimulation();
    const storageId = sim.placeBuilding(BuildingType.StorageArea);
    sim.injectOutput(storageId, EMaterialType.LOG, logs);
    const sawmillId = sim.placeBuilding(BuildingType.Sawmill, 0, true, undefined, false);
    const carriers = sim.spawnUnitNear(storageId, UnitType.Carrier, carrierCount);
    return { sim, storageId, sawmillId, carriers };
}

/** Every unit of `material` in the world: all pile slots (buildings, storage, free piles) plus carried goods. */
export function totalMaterial(sim: Simulation, material: EMaterialType): number {
    let total = 0;
    for (const slot of sim.services.inventoryManager.slotStore.values()) {
        if (slot.materialType === material) {
            total += slot.currentAmount;
        }
    }
    for (const entity of sim.state.entityIndex.query(EntityType.Unit)) {
        if (entity.carrying && entity.carrying.material === material) {
            total += entity.carrying.amount;
        }
    }
    return total;
}

/** The unit's running job (null when idle). */
export function jobOf(sim: Simulation, unitId: number): JobState | null {
    // Nullable by design: a unit that never ran a job has no runtime.
    const runtime = sim.services.settlerTaskSystem.runtimes.get(unitId);
    return runtime ? runtime.job : null;
}

/** Task type of the node the unit's job is at, or null when it runs no job. */
export function currentTask(sim: Simulation, unitId: number): ChoreoTaskType | null {
    const job = jobOf(sim, unitId);
    if (!job || job.nodeIndex >= job.nodes.length) {
        return null;
    }
    return job.nodes[job.nodeIndex]!.task;
}

/** Run until some carrier's transport job is at `task` (and, for inventory nodes, has started); return it. */
export function runUntilTransportAt(
    sim: Simulation,
    task: ChoreoTaskType,
    started: boolean
): { carrierId: number; record: TransportJobRecord } {
    let found: { carrierId: number; record: TransportJobRecord } | null = null;
    sim.runUntil(
        () => {
            for (const record of sim.services.jobStore.jobs.values()) {
                const job = jobOf(sim, record.carrierId);
                if (job && currentTask(sim, record.carrierId) === task && (!started || job.workStarted)) {
                    found = { carrierId: record.carrierId, record };
                    return true;
                }
            }
            return false;
        },
        { maxTicks: 20_000, label: `a carrier at ${task}` }
    );
    return found!;
}
