/**
 * ConstructionWorkerDemands — the digger/builder demand records of every construction site.
 *
 * Sole owner of construction worker assignment state: which worker is committed to which
 * site, and which unleveled tile each digger holds. Owns a Map<siteId, ConstructionWorkerDemand[]>
 * plus an O(1) unit → demand index.
 *
 * Pure bookkeeping (no settler-task or recruit access), so the ConstructionSiteManager can take
 * it as its ConstructionSiteListener at construction time: demands are created when the manager
 * registers a site or finishes leveling. ConstructionSiteDemandSystem fulfills them (finds and
 * dispatches workers) and drives bind/release/retire. Demands are derived state — on restore
 * they are rebuilt from site state.
 */

import type { EventBus } from '../../event-bus';
import type { ConstructionSiteListener } from './construction-site-manager';
import type { ConstructionSite } from './types';
import { createLogger } from '@/utilities/logger';

const log = createLogger('ConstructionWorkerDemands');

export type ConstructionWorkerRole = 'digger' | 'builder';

/** Tracks one worker demand for a construction site. */
export interface ConstructionWorkerDemand {
    /** Construction site (building entity ID). */
    siteId: number;
    /** Role: digger or builder. */
    role: ConstructionWorkerRole;
    /** Committed worker ID, or null if still searching for a candidate. */
    workerId: number | null;
    /** Player who owns the site. */
    player: number;
    /** Unleveled tile index held by this digger demand (released on completion/interrupt). */
    reservedTileIndex: number | null;
}

export class ConstructionWorkerDemands implements ConstructionSiteListener {
    private readonly eventBus: EventBus;

    /** All demands keyed by siteId. */
    private readonly demands = new Map<number, ConstructionWorkerDemand[]>();
    /** Committed worker → its demand. Kept in sync by bind/release only. */
    private readonly demandByWorker = new Map<number, ConstructionWorkerDemand>();

    constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
    }

    // ================================================================
    // ConstructionSiteListener
    // ================================================================

    /** Create demands for a newly registered site (diggers, or builders for mines). */
    onSiteRegistered(site: ConstructionSite): void {
        this.createFromSiteState(site);
    }

    /** Leveling completed — release digger demands, create builder demands. */
    onLevelingComplete(site: ConstructionSite): void {
        const existing = this.demands.get(site.buildingId);
        if (existing) {
            for (const demand of existing) {
                if (demand.role === 'digger') {
                    this.release(demand);
                }
            }
        }

        // Always create builder demands — even if input slots are empty right now.
        // On flat terrain, leveling completes instantly before carriers deliver anything.
        // The drain loop's tryFulfill already checks hasAvailableMaterials before
        // dispatching, so builders won't be sent until materials arrive.
        this.setRoleDemands(site, 'builder');
    }

    // ================================================================
    // Lifecycle
    // ================================================================

    /**
     * Rebuild all demands from restored site state. Demands are not persisted and
     * in-flight construction jobs are not restored, so every demand starts unbound
     * and the drain loop re-dispatches workers.
     */
    rebuildFromSites(sites: Iterable<ConstructionSite>): void {
        this.demands.clear();
        this.demandByWorker.clear();
        for (const site of sites) {
            this.createFromSiteState(site);
        }
    }

    /** Cancel all demands for a removed site, release workers. */
    removeSite(siteId: number): void {
        const siteDemands = this.demands.get(siteId);
        if (!siteDemands) {
            return;
        }

        for (const demand of siteDemands) {
            this.release(demand);
        }

        this.demands.delete(siteId);
        log.debug(`Removed all demands for site ${siteId}`);
    }

    /** Top up the site's builder demands to its required builder count. */
    addVacantBuilderDemands(site: ConstructionSite): void {
        // eslint-disable-next-line no-restricted-syntax -- site may have no demands yet; [] is the correct initial value
        const existing = this.demands.get(site.buildingId) ?? [];
        const activeBuilders = existing.filter(d => d.role === 'builder').length;
        const count = site.building.slots.required - activeBuilders;
        if (count <= 0) {
            return;
        }

        for (let i = 0; i < count; i++) {
            existing.push(makeDemand(site, 'builder'));
        }
        this.demands.set(site.buildingId, existing);
        log.debug(`Added ${count} builder demands for site ${site.buildingId} after delivery`);
    }

    // ================================================================
    // Queries
    // ================================================================

    /** All sites with demands, in insertion order (the drain order). */
    sites(): IterableIterator<[siteId: number, demands: ConstructionWorkerDemand[]]> {
        return this.demands.entries();
    }

    getDemands(siteId: number): readonly ConstructionWorkerDemand[] | undefined {
        return this.demands.get(siteId);
    }

    /** The demand a worker is committed to, if any. */
    getDemandForWorker(unitId: number): ConstructionWorkerDemand | undefined {
        return this.demandByWorker.get(unitId);
    }

    get demandCount(): number {
        let count = 0;
        for (const demands of this.demands.values()) {
            count += demands.length;
        }
        return count;
    }

    /** Tiles currently held by this site's digger demands. */
    reservedTilesFor(siteId: number): Set<number> {
        const reserved = new Set<number>();
        for (const d of this.demands.get(siteId)!) {
            if (d.reservedTileIndex !== null) {
                reserved.add(d.reservedTileIndex);
            }
        }
        return reserved;
    }

    // ================================================================
    // Assignment bookkeeping (single source of truth)
    // ================================================================

    /** Commit `unitId` to `demand`. Emits construction:workerAssigned. */
    bind(demand: ConstructionWorkerDemand, unitId: number): void {
        const current = this.demandByWorker.get(unitId);
        if (current) {
            throw new Error(
                `ConstructionWorkerDemands.bind: unit ${unitId} already committed to site ${current.siteId} ` +
                    `as ${current.role} (requested site ${demand.siteId} as ${demand.role})`
            );
        }
        demand.workerId = unitId;
        this.demandByWorker.set(unitId, demand);
        this.eventBus.emit('construction:workerAssigned', { buildingId: demand.siteId, unitId, role: demand.role });
    }

    /** Release the demand's tile reservation and committed worker; the demand stays (unbound). */
    release(demand: ConstructionWorkerDemand): void {
        demand.reservedTileIndex = null;
        if (demand.workerId === null) {
            return;
        }
        const unitId = demand.workerId;
        demand.workerId = null;
        this.demandByWorker.delete(unitId);
        this.eventBus.emit('construction:workerReleased', { buildingId: demand.siteId, unitId, role: demand.role });
    }

    /** Release the demand and remove it from its site. */
    retire(demand: ConstructionWorkerDemand): void {
        this.release(demand);
        const siteDemands = this.demands.get(demand.siteId)!;
        const idx = siteDemands.indexOf(demand);
        if (idx === -1) {
            throw new Error(
                `ConstructionWorkerDemands.retire: ${demand.role} demand not found on site ${demand.siteId}`
            );
        }
        siteDemands.splice(idx, 1);
        if (siteDemands.length === 0) {
            this.demands.delete(demand.siteId);
        }
    }

    // ================================================================
    // Internal
    // ================================================================

    /** Diggers while terrain still needs leveling, builders once it is complete. */
    private createFromSiteState(site: ConstructionSite): void {
        this.setRoleDemands(site, site.terrain.complete ? 'builder' : 'digger');
    }

    /** Replace the site's demands with `required` fresh, unbound demands for `role`. */
    private setRoleDemands(site: ConstructionSite, role: ConstructionWorkerRole): void {
        const count = role === 'digger' ? site.terrain.slots.required : site.building.slots.required;
        const siteDemands: ConstructionWorkerDemand[] = [];
        for (let i = 0; i < count; i++) {
            siteDemands.push(makeDemand(site, role));
        }
        this.demands.set(site.buildingId, siteDemands);
        log.debug(`Created ${count} ${role} demands for site ${site.buildingId}`);
    }
}

function makeDemand(site: ConstructionSite, role: ConstructionWorkerRole): ConstructionWorkerDemand {
    return { siteId: site.buildingId, role, workerId: null, player: site.player, reservedTileIndex: null };
}
