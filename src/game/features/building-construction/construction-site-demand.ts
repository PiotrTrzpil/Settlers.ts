/**
 * ConstructionSiteDemandSystem — fulfills construction worker demands (diggers and builders).
 *
 * The demand records live in ConstructionWorkerDemands (created by the ConstructionSiteManager's
 * listener callbacks). This system drains unfulfilled demands on a ~1s interval — idle specialist
 * first, carrier recruitment second — and pushes the next work assignment when a worker's job
 * completes. Global recruitment cap: 4 diggers and 4 builders per player across all sites.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { ChoreoJobState } from '../../systems/choreo/types';
import { UnitType } from '../../core/unit-types';
import { EntityType, Tile } from '../../entity';
import type { DispatchRecruitmentOpts } from '../recruit';
import type { ConstructionSiteManager, IndexedTile } from './construction-site-manager';
import type {
    ConstructionWorkerDemand,
    ConstructionWorkerDemands,
    ConstructionWorkerRole,
} from './construction-worker-demands';
import { buildDigTileJob, buildBuildStepJob, buildRecruitDiggerJob, buildRecruitBuilderJob } from './construction-jobs';
import { createLogger } from '@/utilities/logger';
import {
    IntervalDrain,
    handleDemandJobCompleted,
    handleDemandJobFailed,
    type UnitDemandJobHandlers,
} from '../../systems/unit-demand-loop';
import { JobKind } from '../../systems/choreo/types';

const log = createLogger('ConstructionSiteDemand');

const TICK_INTERVAL = 1.0;
const MAX_DIGGERS_PER_PLAYER = 4;
const MAX_BUILDERS_PER_PLAYER = 4;

// ─── Config ──────────────────────────────────────────────────

export interface ConstructionSiteDemandConfig {
    gameState: GameState;
    eventBus: EventBus;
    siteManager: ConstructionSiteManager;
    demands: ConstructionWorkerDemands;
    findIdleSpecialist: (unitType: UnitType, player: number, nearX: number, nearY: number) => number | null;
    assignJob: (unitId: number, job: ChoreoJobState, moveTo?: Tile) => boolean;
    /** Full recruitment dispatch — find candidate, build choreo, assign job, register transform. */
    dispatchRecruitment: (unitType: UnitType, player: number, opts?: DispatchRecruitmentOpts) => number | null;
}

// ─── System ──────────────────────────────────────────────────

export class ConstructionSiteDemandSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly siteManager: ConstructionSiteManager;
    private readonly demands: ConstructionWorkerDemands;
    private readonly findIdleSpecialist: ConstructionSiteDemandConfig['findIdleSpecialist'];
    private readonly assignJob: ConstructionSiteDemandConfig['assignJob'];
    private readonly dispatchRecruitment: ConstructionSiteDemandConfig['dispatchRecruitment'];
    private readonly subscriptions = new EventSubscriptionManager();
    private readonly drain = new IntervalDrain(TICK_INTERVAL);

    private readonly jobHandlers: UnitDemandJobHandlers<ConstructionWorkerDemand> = {
        ownsKind: kind => kind === JobKind.Construction,
        findByUnit: unitId => this.demands.getDemandForWorker(unitId),
        onJobCompleted: demand => this.onWorkerJobCompleted(demand),
        onJobFailed: (demand, unitId) => this.onWorkerJobFailed(demand, unitId),
    };

    constructor(config: ConstructionSiteDemandConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.siteManager = config.siteManager;
        this.demands = config.demands;
        this.findIdleSpecialist = config.findIdleSpecialist;
        this.assignJob = config.assignJob;
        this.dispatchRecruitment = config.dispatchRecruitment;
    }

    // ================================================================
    // Event registration
    // ================================================================

    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'settler:taskCompleted', ({ unitId, kind }) => {
            handleDemandJobCompleted(this.jobHandlers, unitId, kind);
        });

        this.subscriptions.subscribe(this.eventBus, 'settler:taskFailed', ({ unitId, kind }) => {
            handleDemandJobFailed(this.jobHandlers, unitId, kind);
        });

        this.subscriptions.subscribe(this.eventBus, 'building:removed', ({ buildingId }) => {
            this.demands.removeSite(buildingId);
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

    /** A worker's choreo job completed — push next assignment. */
    private onWorkerJobCompleted(demand: ConstructionWorkerDemand): void {
        if (demand.role === 'digger') {
            this.pushNextDiggerJob(demand);
        } else {
            this.pushNextBuilderJob(demand);
        }
    }

    /** A worker's choreo job failed — release and re-demand. */
    private onWorkerJobFailed(demand: ConstructionWorkerDemand, unitId: number): void {
        // Reset to unfulfilled (tile + worker released) so drain picks it up again
        this.demands.release(demand);
        log.debug(`Worker ${unitId} failed at site ${demand.siteId}, demand reset`);
    }

    // ================================================================
    // Internal — demand fulfillment
    // ================================================================

    private drainDemands(): void {
        for (const [siteId, siteDemands] of this.demands.sites()) {
            // Discard if site no longer exists
            if (!this.siteManager.getSite(siteId)) {
                this.demands.removeSite(siteId);
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
        const job = this.buildFirstJob(demand);
        if (!job) {
            return;
        }

        const assigned = this.assignJob(unitId, job);
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
            buildJob: candidate => {
                const toolPile = candidate.toolPile!;
                if (demand.role === 'digger') {
                    return buildRecruitDiggerJob(
                        toolPile.x,
                        toolPile.y,
                        toolPile.pileEntityId,
                        reservedTile!.x,
                        reservedTile!.y,
                        demand.siteId,
                        reservedTile!.tileIndex
                    );
                }
                const pos = this.siteManager.getRandomBuilderWorkPos(demand.siteId);
                return buildRecruitBuilderJob(
                    toolPile.x,
                    toolPile.y,
                    toolPile.pileEntityId,
                    pos.x,
                    pos.y,
                    demand.siteId
                );
            },
        });

        if (carrierId === null) {
            this.demands.release(demand);
            return;
        }

        this.bindWorker(demand, carrierId);
        log.debug(
            `Carrier ${carrierId} dispatched with combined recruit+work choreo ` +
                `as ${demand.role} for site ${demand.siteId}`
        );
    }

    // ================================================================
    // Internal — job building
    // ================================================================

    private buildFirstJob(demand: ConstructionWorkerDemand): ChoreoJobState | null {
        if (demand.role === 'digger') {
            return this.buildDiggerJob(demand);
        }
        return this.buildBuilderJob(demand);
    }

    private buildDiggerJob(demand: ConstructionWorkerDemand): ChoreoJobState | null {
        const tile = this.reserveTile(demand);
        if (!tile) {
            return null;
        }
        return buildDigTileJob(tile.x, tile.y, demand.siteId, tile.tileIndex);
    }

    private buildBuilderJob(demand: ConstructionWorkerDemand): ChoreoJobState | null {
        if (!this.siteManager.hasAvailableMaterials(demand.siteId)) {
            return null;
        }
        const pos = this.siteManager.getRandomBuilderWorkPos(demand.siteId);
        return buildBuildStepJob(pos.x, pos.y, demand.siteId);
    }

    // ================================================================
    // Internal — next assignment push
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

        const tile = this.reserveTile(demand);
        if (!tile) {
            // No more tiles — worker done with this site
            log.debug(`Digger ${demand.workerId} finished all tiles at site ${demand.siteId}`);
            this.demands.retire(demand);
            return;
        }

        const workerId = demand.workerId!;
        const job = buildDigTileJob(tile.x, tile.y, demand.siteId, tile.tileIndex);
        if (!this.assignJob(workerId, job)) {
            this.demands.release(demand);
            log.debug(`Failed to assign next dig job to worker ${workerId}`);
        }
    }

    private pushNextBuilderJob(demand: ConstructionWorkerDemand): void {
        // Site may have been completed and removed by the BUILD_STEP that just finished
        if (!this.siteManager.getSite(demand.siteId) || !this.siteManager.hasAvailableMaterials(demand.siteId)) {
            log.debug(`Builder ${demand.workerId} released — site ${demand.siteId} done or no materials`);
            this.demands.retire(demand);
            return;
        }

        const workerId = demand.workerId!;
        const pos = this.siteManager.getRandomBuilderWorkPos(demand.siteId);
        const job = buildBuildStepJob(pos.x, pos.y, demand.siteId);
        if (!this.assignJob(workerId, job)) {
            this.demands.release(demand);
            log.debug(`Failed to assign next build job to worker ${workerId}`);
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
