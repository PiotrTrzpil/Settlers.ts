/**
 * ConstructionRequestSystem — tick system that creates material delivery requests for buildings under construction.
 *
 * Periodically scans all active construction sites and, for each material still needed,
 * ensures at most two active requests exist in the logistics system. This rate-limits
 * the number of carriers dispatched per material per site, matching the original game's
 * one-unit-at-a-time delivery behaviour while preventing logistics flooding.
 *
 * Requests are created as soon as a site is registered — carriers may deliver materials
 * during terrain leveling, parallel to the diggers, exactly as in Settlers 4.
 */

import type { TickSystem } from '../../tick-system';
import type { EMaterialType } from '../../economy/material-type';
import type { ConstructionSiteManager } from './construction-site-manager';
import type { RequestManager } from '../logistics/request-manager';
import { RequestPriority } from '../logistics/resource-request';

/** Maximum number of active (pending + in-progress) requests per material per construction site. */
const MAX_PENDING_PER_MATERIAL = 2;

export class ConstructionRequestSystem implements TickSystem {
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly requestManager: RequestManager;

    private accumulator = 0;
    private static readonly TICK_INTERVAL = 0.5; // seconds

    constructor(constructionSiteManager: ConstructionSiteManager, requestManager: RequestManager) {
        this.constructionSiteManager = constructionSiteManager;
        this.requestManager = requestManager;
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
                this.ensureRequestsForMaterial(site.buildingId, cost.material);
            }
        }
    }

    private ensureRequestsForMaterial(buildingId: number, material: EMaterialType): void {
        const activeRequests = this.requestManager
            .getRequestsForBuilding(buildingId)
            .filter(r => r.materialType === material).length;

        if (activeRequests < MAX_PENDING_PER_MATERIAL) {
            this.requestManager.addRequest(buildingId, material, 1, RequestPriority.Normal);
        }
    }
}
