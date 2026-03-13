/**
 * ConstructionRequestSystem — tick system that creates material delivery demands for buildings under construction.
 *
 * Periodically scans all active construction sites and creates slot-agnostic demands
 * for each material that still has capacity. Multiple carriers can deliver in parallel —
 * matching the original game's behaviour. Slot assignment happens at job creation time.
 *
 * Demands are created as soon as a site is registered — carriers may deliver materials
 * during terrain leveling, parallel to the diggers, exactly as in Settlers 4.
 */

import type { TickSystem } from '../../core/tick-system';
import type { ConstructionSiteManager } from './construction-site-manager';
import { DemandPriority, type DemandQueue } from '../logistics/demand-queue';
import type { TransportJobStore } from '../logistics/transport-job-store';
import type { BuildingInventoryManager } from '../../systems/inventory';
import { SlotKind } from '../../core/pile-kind';

export class ConstructionRequestSystem implements TickSystem {
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly demandQueue: DemandQueue;
    private readonly jobStore: TransportJobStore;
    private readonly inventoryManager: BuildingInventoryManager;

    private accumulator = 0;
    private static readonly TICK_INTERVAL = 0.5; // seconds

    constructor(
        constructionSiteManager: ConstructionSiteManager,
        demandQueue: DemandQueue,
        jobStore: TransportJobStore,
        inventoryManager: BuildingInventoryManager
    ) {
        this.constructionSiteManager = constructionSiteManager;
        this.demandQueue = demandQueue;
        this.jobStore = jobStore;
        this.inventoryManager = inventoryManager;
    }

    tick(dt: number): void {
        this.accumulator += dt;
        if (this.accumulator < ConstructionRequestSystem.TICK_INTERVAL) {
            return;
        }
        this.accumulator -= ConstructionRequestSystem.TICK_INTERVAL;
        this.processSites();
    }

    private processSites(): void {
        for (const site of this.constructionSiteManager.getAllActiveSites()) {
            this.processSite(site.buildingId);
        }
    }

    /**
     * Estimate total capacity per material across all input slots and create
     * slot-agnostic demands for the remaining space (minus active demands/jobs).
     */
    private processSite(buildingId: number): void {
        const remainingCosts = this.constructionSiteManager.getRemainingCosts(buildingId);
        for (const cost of remainingCosts) {
            const slots = this.inventoryManager
                .getSlots(buildingId)
                .filter(s => s.kind === SlotKind.Input && s.materialType === cost.material);
            let totalSpace = 0;
            for (const slot of slots) {
                totalSpace += slot.maxCapacity - slot.currentAmount;
            }
            if (totalSpace <= 0) {
                continue;
            }

            const activeDemands = this.demandQueue.countDemands(buildingId, cost.material);
            const activeJobs = this.jobStore.getActiveJobCountForDest(buildingId, cost.material);
            const needed = totalSpace - activeDemands - activeJobs;
            for (let i = 0; i < needed; i++) {
                this.demandQueue.addDemand(buildingId, cost.material, 1, DemandPriority.Normal);
            }
        }
    }
}
