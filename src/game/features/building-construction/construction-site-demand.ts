/**
 * ConstructionSiteDemandSystem — fulfills construction worker demands (diggers and builders).
 *
 * The demand records live in ConstructionWorkerDemands (created by the ConstructionSiteManager's
 * listener callbacks). This system drains unfulfilled demands on a ~1s interval — idle specialist
 * first, carrier recruitment second — and dispatches owned `Construction` jobs. As the kind's
 * {@link ConstructionJobOwner} it is called back directly: a completed job chains the next
 * DIG/BUILD job, a failed / preempted job or a removed unit releases the demand. Global
 * recruitment cap: 4 diggers and 4 builders per player across all sites.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import { UnitType } from '../../core/unit-types';
import { EntityType } from '../../entity';
import { JobKind } from '../../systems/choreo';
import { IntervalDrain } from '../../systems/unit-demand-loop';
import type { DispatchRecruitmentOpts } from '../recruit';
import type { JobService } from '../settler-tasks';
import type { ConstructionSiteManager, IndexedTile } from './construction-site-manager';
import type {
    ConstructionWorkerDemand,
    ConstructionWorkerDemands,
    ConstructionWorkerRole,
} from './construction-worker-demands';
import { constructionJobSpec, type ConstructionJobOwner, type ConstructionJobParams } from './construction-job-kind';
import { createLogger } from '@/utilities/logger';

const log = createLogger('ConstructionSiteDemand');

const TICK_INTERVAL = 1.0;
const MAX_DIGGERS_PER_PLAYER = 4;
const MAX_BUILDERS_PER_PLAYER = 4;

/** A job's work part — its params without the recruit segment. */
type ConstructionWork = Omit<ConstructionJobParams, 'recruit'>;

// ─── Config ──────────────────────────────────────────────────

export interface ConstructionSiteDemandConfig {
    gameState: GameState;
    eventBus: EventBus;
    siteManager: ConstructionSiteManager;
    demands: ConstructionWorkerDemands;
    findIdleSpecialist: (unitType: UnitType, player: number, nearX: number, nearY: number) => number | null;
    jobs: JobService;
    /** Full recruitment dispatch — find candidate, reserve its source, assign the `buildSpec` job. */
    dispatchRecruitment: (unitType: UnitType, player: number, opts: DispatchRecruitmentOpts) => number | null;
}

// ─── System ──────────────────────────────────────────────────

export class ConstructionSiteDemandSystem implements TickSystem, ConstructionJobOwner {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly siteManager: ConstructionSiteManager;
    private readonly demands: ConstructionWorkerDemands;
    private readonly findIdleSpecialist: ConstructionSiteDemandConfig['findIdleSpecialist'];
    private readonly jobs: JobService;
    private readonly dispatchRecruitment: ConstructionSiteDemandConfig['dispatchRecruitment'];
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly drain = new IntervalDrain(TICK_INTERVAL);

    constructor(config: ConstructionSiteDemandConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.siteManager = config.siteManager;
        this.demands = config.demands;
        this.findIdleSpecialist = config.findIdleSpecialist;
        this.jobs = config.jobs;
        this.dispatchRecruitment = config.dispatchRecruitment;
    }

    // ================================================================
    // Event registration
    // ================================================================

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'building:removed', ({ buildingId }) => {
            this.removeSite(buildingId);
        });

        this.subscriptions.subscribe(this.eventBus, 'construction:materialDelivered', ({ buildingId }) => {
            this.onMaterialsDelivered(buildingId);
        });
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    destroy(): void {
        this.unregisterEvents();
    }

    // ================================================================
    // TickSystem
    // ================================================================

    tick(dt: number): void {
        if (this.drain.tick(dt)) {
            this.drainDemands();
        }
    }

    // ================================================================
    // ConstructionJobOwner — called by the Construction kind handler
    // ================================================================

    isBound(unitId: number, siteId: number): boolean {
        return this.demands.demandOf(siteId, unitId) !== undefined;
    }

    /** A worker's job completed — push the next assignment (its demand may already be released). */
    onWorkerJobCompleted(unitId: number, siteId: number): void {
        const demand = this.demands.demandOf(siteId, unitId);
        if (!demand) {
            // Released meanwhile: leveling finished (digger demands replaced) or the site is gone.
            return;
        }
        if (demand.role === 'digger') {
            this.pushNextDiggerJob(demand);
        } else {
            this.pushNextBuilderJob(demand);
        }
    }

    /** A worker's job failed / was preempted / the worker died — release and re-demand. */
    onWorkerJobEnded(unitId: number, siteId: number): void {
        const demand = this.demands.demandOf(siteId, unitId);
        if (!demand) {
            return;
        }
        // Reset to unfulfilled (tile + worker released) so drain picks it up again
        this.demands.release(demand);
        log.debug(`Worker ${unitId} left site ${siteId}, demand reset`);
    }

    // ================================================================
    // Internal — events
    // ================================================================

    /** Materials delivered — re-create builder demands for vacant slots. */
    private onMaterialsDelivered(siteId: number): void {
        const site = this.siteManager.getSite(siteId);
        if (!site || !site.terrain.complete) {
            return;
        }
        if (!this.siteManager.hasAvailableMaterials(siteId)) {
            return;
        }
        this.demands.addVacantBuilderDemands(site);
    }

    // ================================================================
    // Internal — demand fulfillment
    // ================================================================

    /** Site gone (building removed / construction finished): cancel its workers' jobs, drop its demands. */
    private removeSite(siteId: number): void {
        for (const unitId of this.jobs.commitments.unitsOwnedBy(JobKind.Construction, siteId)) {
            this.jobs.cancel(unitId, JobKind.Construction);
        }
        this.demands.removeSite(siteId);
    }

    private drainDemands(): void {
        for (const [siteId, siteDemands] of this.demands.sites()) {
            // Discard if site no longer exists
            if (!this.siteManager.getSite(siteId)) {
                this.removeSite(siteId);
                continue;
            }

            for (const demand of siteDemands) {
                if (demand.workerId !== null) {
                    continue;
                }
                this.tryFulfill(demand);
            }
        }
    }

    private tryFulfill(demand: ConstructionWorkerDemand): void {
        const site = this.siteManager.getSiteOrThrow(demand.siteId, 'DemandSystem.tryFulfill');
        const unitType = demand.role === 'digger' ? UnitType.Digger : UnitType.Builder;

        // 1. Try idle specialist
        const specialistId = this.findIdleSpecialist(unitType, demand.player, site.tileX, site.tileY);

        if (specialistId !== null) {
            this.dispatchSpecialist(specialistId, demand);
            return;
        }

        // 2. Try carrier recruitment — RecruitSystem handles everything
        this.dispatchCarrierRecruitment(demand, unitType, site.tileX, site.tileY);
    }

    private dispatchSpecialist(unitId: number, demand: ConstructionWorkerDemand): void {
        const work = this.nextWork(demand);
        if (!work) {
            return;
        }

        const assigned = this.jobs.assign(unitId, constructionJobSpec({ ...work, recruit: null }));
        if (!assigned) {
            this.demands.release(demand);
            return;
        }

        this.bindWorker(demand, unitId);
        log.debug(`Specialist ${unitId} dispatched to site ${demand.siteId} as ${demand.role}`);
    }

    private dispatchCarrierRecruitment(
        demand: ConstructionWorkerDemand,
        unitType: UnitType,
        siteX: number,
        siteY: number
    ): void {
        // Recruitment cap limits auto-creation of new workers from carriers.
        // Idle specialists bypass this cap (handled in tryFulfill before this).
        if (this.remainingRecruitmentCap(demand.role, demand.player) <= 0) {
            return;
        }

        // Pre-reserve work resources before dispatching — if no work is available,
        // skip recruitment entirely.
        let reservedTile: IndexedTile | null = null;
        if (demand.role === 'digger') {
            reservedTile = this.reserveTile(demand);
            if (!reservedTile) {
                return;
            }
        } else if (!this.siteManager.hasAvailableMaterials(demand.siteId)) {
            return;
        }

        const carrierId = this.dispatchRecruitment(unitType, demand.player, {
            target: { x: siteX, y: siteY },
            buildSpec: (_carrierId, segment) =>
                constructionJobSpec({ ...this.workAt(demand, reservedTile), recruit: segment }),
        });

        if (carrierId === null) {
            this.demands.release(demand);
            return;
        }

        this.bindWorker(demand, carrierId);
        log.debug(
            `Carrier ${carrierId} dispatched with combined recruit+work job ` +
                `as ${demand.role} for site ${demand.siteId}`
        );
    }

    // ================================================================
    // Internal — job params
    // ================================================================

    /** The demand's next work: a freshly reserved tile (digger) or a work position (builder with materials). */
    private nextWork(demand: ConstructionWorkerDemand): ConstructionWork | null {
        if (demand.role === 'digger') {
            const tile = this.reserveTile(demand);
            return tile ? this.workAt(demand, tile) : null;
        }
        if (!this.siteManager.hasAvailableMaterials(demand.siteId)) {
            return null;
        }
        return this.workAt(demand, null);
    }

    /** Work on `tile` (digger), or at a random builder position of the site (`tile` null). */
    private workAt(demand: ConstructionWorkerDemand, tile: IndexedTile | null): ConstructionWork {
        const { siteId, role } = demand;
        if (tile) {
            return { siteId, role, tileIndex: tile.tileIndex, workPos: { x: tile.x, y: tile.y } };
        }
        return { siteId, role, tileIndex: null, workPos: this.siteManager.getRandomBuilderWorkPos(siteId) };
    }

    // ================================================================
    // Internal — next assignment push (from inside onCompleted)
    // ================================================================

    private pushNextDiggerJob(demand: ConstructionWorkerDemand): void {
        // The previous tile was completed by the DIG_TILE step — drop its reservation
        demand.reservedTileIndex = null;

        // Site may have been removed (building destroyed while digger was working)
        if (!this.siteManager.getSite(demand.siteId)) {
            log.debug(`Digger ${demand.workerId} released — site ${demand.siteId} removed`);
            this.demands.retire(demand);
            return;
        }

        const work = this.nextWork(demand);
        if (!work) {
            // No more tiles — worker done with this site
            log.debug(`Digger ${demand.workerId} finished all tiles at site ${demand.siteId}`);
            this.demands.retire(demand);
            return;
        }
        this.assignNext(demand, work);
    }

    private pushNextBuilderJob(demand: ConstructionWorkerDemand): void {
        // Site may have been completed and removed by the BUILD_STEP that just finished
        if (!this.siteManager.getSite(demand.siteId) || !this.siteManager.hasAvailableMaterials(demand.siteId)) {
            log.debug(`Builder ${demand.workerId} released — site ${demand.siteId} done or no materials`);
            this.demands.retire(demand);
            return;
        }
        this.assignNext(demand, this.workAt(demand, null));
    }

    /** Chain the bound worker's next job (no recruit: it already is a specialist). */
    private assignNext(demand: ConstructionWorkerDemand, work: ConstructionWork): void {
        const workerId = demand.workerId!;
        if (!this.jobs.assign(workerId, constructionJobSpec({ ...work, recruit: null }))) {
            this.demands.release(demand);
            log.debug(`Failed to assign next ${demand.role} job to worker ${workerId}`);
        }
    }

    // ================================================================
    // Internal — assignment helpers
    // ================================================================

    /** Pick an unleveled tile not held by another digger and record it on the demand. */
    private reserveTile(demand: ConstructionWorkerDemand): IndexedTile | null {
        const tile = this.siteManager.pickUnleveledTile(demand.siteId, this.demands.reservedTilesFor(demand.siteId));
        if (tile) {
            demand.reservedTileIndex = tile.tileIndex;
        }
        return tile;
    }

    /** Commit `unitId` to `demand`, then mark the site's digging/building phase as started. */
    private bindWorker(demand: ConstructionWorkerDemand, unitId: number): void {
        this.demands.bind(demand, unitId);
        if (demand.role === 'digger') {
            this.siteManager.markDiggingStarted(demand.siteId);
        } else {
            this.siteManager.markBuildingStarted(demand.siteId);
        }
    }

    /**
     * How many more workers of this role can be auto-recruited from carriers.
     * Counts all existing entities of the relevant type for the player —
     * not just demand-committed workers. This prevents over-recruitment when
     * workers finish their demands and become idle (demands removed but entities persist).
     */
    private remainingRecruitmentCap(role: ConstructionWorkerRole, player: number): number {
        const max = role === 'digger' ? MAX_DIGGERS_PER_PLAYER : MAX_BUILDERS_PER_PLAYER;
        const unitType = role === 'digger' ? UnitType.Digger : UnitType.Builder;

        const existing = this.gameState.entityIndex.query(EntityType.Unit, player, unitType).count();

        return Math.max(0, max - existing);
    }
}
