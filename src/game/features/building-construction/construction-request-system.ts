/**
 * ConstructionRequestSystem — tick system that creates material delivery requests for buildings under construction.
 *
 * Periodically scans all active construction sites and, for each material still needed,
 * creates requests up to the remaining cost (capped at MAX_ACTIVE_PER_MATERIAL) so that
 * multiple carriers deliver in parallel — matching the original game's behaviour.
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
const MAX_ACTIVE_PER_MATERIAL = 8;

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
                this.ensureRequestsForMaterial(site.buildingId, cost.material, cost.count);
            }
        }
    }

    private ensureRequestsForMaterial(buildingId: number, material: EMaterialType, remaining: number): void {
        const activeRequests = this.requestManager
            .getRequestsForBuilding(buildingId)
            .filter(r => r.materialType === material).length;

        const cap = Math.min(remaining, MAX_ACTIVE_PER_MATERIAL);
        for (let i = activeRequests; i < cap; i++) {
            this.requestManager.addRequest(buildingId, material, 1, RequestPriority.Normal);
        }
    }
}
