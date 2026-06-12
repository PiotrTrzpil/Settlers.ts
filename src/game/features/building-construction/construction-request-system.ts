/**
 * ConstructionRequestSystem — keeps construction-material standing orders in
 * sync with each active site's remaining costs.
 *
 * Writes the remaining cost per material (total cost minus delivered
 * throughput) into the DemandLedger as an absolute target. The dispatcher
 * derives the actual shortfall from live inventory + in-flight jobs, so
 * deliveries may run parallel to terrain leveling and cancelled transports
 * re-open the deficit automatically — matching the original game's behaviour.
 *
 * Targets are re-synced immediately on 'construction:materialDelivered':
 * a delivery lowers the remaining cost at the same moment the transport job
 * leaves the store, and both sides of the deficit must move together or the
 * dispatcher would briefly over-order. The periodic sync covers everything
 * else (new sites, leveling progress).
 *
 * Orders are cleared on building:completed / building:removed by
 * MaterialRequestSystem and LogisticsDispatcher.
 */

import type { TickSystem } from '../../core/tick-system';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { ConstructionSiteManager } from './construction-site-manager';
import { DemandPriority, type DemandLedger } from '../logistics/demand-ledger';

export class ConstructionRequestSystem implements TickSystem {
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly demandLedger: DemandLedger;
    private readonly subscriptions = new EventSubscriptionManager();

    private accumulator = 0;
    private static readonly TICK_INTERVAL = 0.5; // seconds

    constructor(constructionSiteManager: ConstructionSiteManager, demandLedger: DemandLedger, eventBus: EventBus) {
        this.constructionSiteManager = constructionSiteManager;
        this.demandLedger = demandLedger;

        this.subscriptions.subscribe(eventBus, 'construction:materialDelivered', ({ buildingId }) => {
            if (this.constructionSiteManager.hasSite(buildingId)) {
                this.syncSite(buildingId);
            }
        });
    }

    tick(dt: number): void {
        this.accumulator += dt;
        if (this.accumulator < ConstructionRequestSystem.TICK_INTERVAL) {
            return;
        }
        this.accumulator -= ConstructionRequestSystem.TICK_INTERVAL;
        for (const site of this.constructionSiteManager.getAllActiveSites()) {
            this.syncSite(site.buildingId);
        }
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
    }

    /**
     * Write the site's remaining costs as absolute targets.
     * A cost that reaches 0 removes its order (setTarget(…, 0) clears).
     */
    private syncSite(buildingId: number): void {
        const remainingCosts = this.constructionSiteManager.getRemainingCosts(buildingId);

        // Clear orders for materials whose cost is fully delivered
        for (const order of this.demandLedger.getTargetsForBuilding(buildingId)) {
            if (!remainingCosts.some(c => c.material === order.materialType)) {
                this.demandLedger.clearTarget(buildingId, order.materialType);
            }
        }

        for (const cost of remainingCosts) {
            this.demandLedger.setTarget(buildingId, cost.material, {
                priority: DemandPriority.Normal,
                target: cost.count,
            });
        }
    }
}
