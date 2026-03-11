/**
 * ConstructionRequestSystem — tick system that creates material delivery demands for buildings under construction.
 *
 * Periodically scans all active construction sites and, for each material still needed,
 * creates demands up to the remaining cost (capped at MAX_ACTIVE_PER_MATERIAL) so that
 * multiple carriers deliver in parallel — matching the original game's behaviour.
 *
 * Demands are created as soon as a site is registered — carriers may deliver materials
 * during terrain leveling, parallel to the diggers, exactly as in Settlers 4.
 */

import type { TickSystem } from '../../core/tick-system';
import type { EMaterialType } from '../../economy/material-type';
import type { ConstructionSiteManager } from './construction-site-manager';
import { DemandPriority, type DemandQueue } from '../logistics/demand-queue';
import type { TransportJobStore } from '../logistics/transport-job-store';

/** Maximum number of active (pending + in-progress) demands per material per construction site. */
const MAX_ACTIVE_PER_MATERIAL = 8;

export class ConstructionRequestSystem implements TickSystem {
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly demandQueue: DemandQueue;
    private readonly jobStore: TransportJobStore;

    private accumulator = 0;
    private static readonly TICK_INTERVAL = 0.5; // seconds

    constructor(
        constructionSiteManager: ConstructionSiteManager,
        demandQueue: DemandQueue,
        jobStore: TransportJobStore
    ) {
        this.constructionSiteManager = constructionSiteManager;
        this.demandQueue = demandQueue;
        this.jobStore = jobStore;
    }

    tick(dt: number): void {
        this.accumulator += dt;
        if (this.accumulator < ConstructionRequestSystem.TICK_INTERVAL) return;
        this.accumulator -= ConstructionRequestSystem.TICK_INTERVAL;
        this.processSites();
    }

    private processSites(): void {
        for (const site of this.constructionSiteManager.getAllActiveSites()) {
            const remainingCosts = this.constructionSiteManager.getRemainingCosts(site.buildingId);
            for (const cost of remainingCosts) {
                this.ensureRequestsForMaterial(site.buildingId, cost.material, cost.count);
            }
        }
    }

    private ensureRequestsForMaterial(buildingId: number, material: EMaterialType, remaining: number): void {
        const activeDemands = this.demandQueue.countDemands(buildingId, material);
        const activeJobs = this.jobStore.getActiveJobCountForDest(buildingId, material);
        const cap = Math.min(remaining - activeJobs, MAX_ACTIVE_PER_MATERIAL);
        const needed = cap - activeDemands;
        for (let i = 0; i < needed; i++) {
            this.demandQueue.addDemand(buildingId, material, 1, DemandPriority.Normal);
        }
    }
}
