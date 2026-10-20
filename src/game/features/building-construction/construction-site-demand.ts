/**
 * ConstructionSiteDemandSystem — site-driven demand orchestration for
 * construction workers (diggers and builders).
 *
 * Sole owner of construction worker assignment: which worker is committed to
 * which site, and which unleveled tile each digger holds. Owns a
 * Map<siteId, ConstructionWorkerDemand[]> plus an O(1) unit → demand index.
 *
 * Creates demands when the ConstructionSiteManager reports a registered site or
 * completed leveling (via ConstructionSiteListener), fulfills them via tick-driven
 * drain (~1s), and pushes next work assignments when jobs complete. Demands are
 * derived state — on restore they are rebuilt from site state. Global recruitment
 * cap: 4 diggers and 4 builders per player across all sites.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { ChoreoJobState } from '../../systems/choreo/types';
import { UnitType } from '../../core/unit-types';
import { EntityType, Tile } from '../../entity';
import type { DispatchRecruitmentOpts } from '../recruit';
import type { ConstructionSiteListener, ConstructionSiteManager, IndexedTile } from './construction-site-manager';
import type { ConstructionSite } from './types';
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

// ─── Public types ────────────────────────────────────────────

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

// ─── Config ──────────────────────────────────────────────────

export interface ConstructionSiteDemandConfig {
    gameState: GameState;
    eventBus: EventBus;
    siteManager: ConstructionSiteManager;
    findIdleSpecialist: (unitType: UnitType, player: number, nearX: number, nearY: number) => number | null;
    assignJob: (unitId: number, job: ChoreoJobState, moveTo?: Tile) => boolean;
    /** Full recruitment dispatch — find candidate, build choreo, assign job, register transform. */
    dispatchRecruitment: (unitType: UnitType, player: number, opts?: DispatchRecruitmentOpts) => number | null;
}

// ─── System ──────────────────────────────────────────────────

export class ConstructionSiteDemandSystem implements TickSystem, ConstructionSiteListener {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly siteManager: ConstructionSiteManager;
    private readonly findIdleSpecialist: ConstructionSiteDemandConfig['findIdleSpecialist'];
    private readonly assignJob: ConstructionSiteDemandConfig['assignJob'];
    private readonly dispatchRecruitment: ConstructionSiteDemandConfig['dispatchRecruitment'];
    private readonly subscriptions = new EventSubscriptionManager();

    /** All demands keyed by siteId. */
    private readonly demands = new Map<number, ConstructionWorkerDemand[]>();
    /** Committed worker → its demand. Kept in sync by bindWorker/unbindWorker only. */
    private readonly demandByWorker = new Map<number, ConstructionWorkerDemand>();
    private readonly drain = new IntervalDrain(TICK_INTERVAL);

    private readonly jobHandlers: UnitDemandJobHandlers<ConstructionWorkerDemand> = {
        ownsKind: kind => kind === JobKind.Construction,
        findByUnit: unitId => this.demandByWorker.get(unitId),
        onJobCompleted: demand => this.onWorkerJobCompleted(demand),
        onJobFailed: (demand, unitId) => this.onWorkerJobFailed(demand, unitId),
    };

    constructor(config: ConstructionSiteDemandConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.siteManager = config.siteManager;
        this.findIdleSpecialist = config.findIdleSpecialist;
        this.assignJob = config.assignJob;
        this.dispatchRecruitment = config.dispatchRecruitment;
    }

    // ================================================================
    // ConstructionSiteListener
    // ================================================================

    /** Create demands for a newly registered site (diggers, or builders for mines). */
    onSiteRegistered(siteId: number): void {
        const site = this.siteManager.getSiteOrThrow(siteId, 'DemandSystem.onSiteRegistered');
        this.createDemandsFromSiteState(site);
    }

    /** Called when leveling completes — release digger demands, create builder demands. */
    onLevelingComplete(siteId: number): void {
        const site = this.siteManager.getSiteOrThrow(siteId, 'DemandSystem.onLevelingComplete');

        const existing = this.demands.get(siteId);
        if (existing) {
            for (const demand of existing) {
                if (demand.role === 'digger') {
                    this.releaseDemand(demand);
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
    // Public API
    // ================================================================

    /**
     * Rebuild all demands from restored site state. Demands are not persisted and
     * in-flight construction jobs are not restored, so every demand starts unbound
     * and the drain loop re-dispatches workers.
     */
    rebuildFromSites(): void {
        this.demands.clear();
        this.demandByWorker.clear();
        for (const siteId of this.siteManager.getAllSiteIds()) {
            this.createDemandsFromSiteState(this.siteManager.getSiteOrThrow(siteId, 'DemandSystem.rebuildFromSites'));
        }
    }

    /** Cancel all demands for a removed site, release workers. */
    onSiteRemoved(siteId: number): void {
        const siteDemands = this.demands.get(siteId);
        if (!siteDemands) {
            return;
        }

        for (const demand of siteDemands) {
            this.releaseDemand(demand);
        }

        this.demands.delete(siteId);
        log.debug(`Removed all demands for site ${siteId}`);
    }

    /** Called when materials are delivered — re-create builder demands for vacant slots. */
    onMaterialsDelivered(siteId: number): void {
        const site = this.siteManager.getSite(siteId);
        if (!site || !site.terrain.complete) {
            return;
        }
        if (!this.siteManager.hasAvailableMaterials(siteId)) {
            return;
        }

        // eslint-disable-next-line no-restricted-syntax -- site may have no demands yet; [] is the correct initial value
        const existing = this.demands.get(siteId) ?? [];
        const activeBuilders = existing.filter(d => d.role === 'builder').length;
        const count = site.building.slots.required - activeBuilders;
        if (count <= 0) {
            return;
        }

        for (let i = 0; i < count; i++) {
            existing.push(makeDemand(site, 'builder'));
        }
        this.demands.set(siteId, existing);
        log.debug(`Added ${count} builder demands for site ${siteId} after delivery`);
    }

    getDemands(siteId: number): readonly ConstructionWorkerDemand[] | undefined {
        return this.demands.get(siteId);
    }

    /** The demand a worker is committed to, if any. */
    getDemandForWorker(unitId: number): Readonly<ConstructionWorkerDemand> | undefined {
        return this.demandByWorker.get(unitId);
    }

    get demandCount(): number {
        let count = 0;
        for (const demands of this.demands.values()) {
            count += demands.length;
        }
        return count;
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
            this.onSiteRemoved(buildingId);
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
    // Internal — demand creation
    // ================================================================

    /** Diggers while terrain still needs leveling, builders once it is complete. */
    private createDemandsFromSiteState(site: ConstructionSite): void {
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

    // ================================================================
    // Internal — job completion
    // ================================================================

    /** Called when a worker's choreo job completes — push next assignment. */
    private onWorkerJobCompleted(demand: ConstructionWorkerDemand): void {
        if (demand.role === 'digger') {
            this.pushNextDiggerJob(demand);
        } else {
            this.pushNextBuilderJob(demand);
        }
    }

    /** Called when a worker's choreo job fails — release and re-demand. */
    private onWorkerJobFailed(demand: ConstructionWorkerDemand, unitId: number): void {
        // Reset to unfulfilled (tile + worker released) so drain picks it up again
        this.releaseDemand(demand);
        log.debug(`Worker ${unitId} failed at site ${demand.siteId}, demand reset`);
    }

    // ================================================================
    // Internal — demand fulfillment
    // ================================================================

    private drainDemands(): void {
        for (const [siteId, siteDemands] of this.demands) {
            // Discard if site no longer exists
            if (!this.siteManager.getSite(siteId)) {
                this.onSiteRemoved(siteId);
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
            this.releaseDemand(demand);
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
            this.releaseDemand(demand);
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
            this.retireDemand(demand);
            return;
        }

        const tile = this.reserveTile(demand);
        if (!tile) {
            // No more tiles — worker done with this site
            log.debug(`Digger ${demand.workerId} finished all tiles at site ${demand.siteId}`);
            this.retireDemand(demand);
            return;
        }

        const workerId = demand.workerId!;
        const job = buildDigTileJob(tile.x, tile.y, demand.siteId, tile.tileIndex);
        if (!this.assignJob(workerId, job)) {
            this.releaseDemand(demand);
            log.debug(`Failed to assign next dig job to worker ${workerId}`);
        }
    }

    private pushNextBuilderJob(demand: ConstructionWorkerDemand): void {
        // Site may have been completed and removed by the BUILD_STEP that just finished
        if (!this.siteManager.getSite(demand.siteId) || !this.siteManager.hasAvailableMaterials(demand.siteId)) {
            log.debug(`Builder ${demand.workerId} released — site ${demand.siteId} done or no materials`);
            this.retireDemand(demand);
            return;
        }

        const workerId = demand.workerId!;
        const pos = this.siteManager.getRandomBuilderWorkPos(demand.siteId);
        const job = buildBuildStepJob(pos.x, pos.y, demand.siteId);
        if (!this.assignJob(workerId, job)) {
            this.releaseDemand(demand);
            log.debug(`Failed to assign next build job to worker ${workerId}`);
        }
    }

    // ================================================================
    // Internal — assignment bookkeeping (single source of truth)
    // ================================================================

    /** Tiles currently held by this site's digger demands. */
    private reservedTilesFor(siteId: number): Set<number> {
        const reserved = new Set<number>();
        for (const d of this.demands.get(siteId)!) {
            if (d.reservedTileIndex !== null) {
                reserved.add(d.reservedTileIndex);
            }
        }
        return reserved;
    }

    /** Pick an unleveled tile not held by another digger and record it on the demand. */
    private reserveTile(demand: ConstructionWorkerDemand): IndexedTile | null {
        const tile = this.siteManager.pickUnleveledTile(demand.siteId, this.reservedTilesFor(demand.siteId));
        if (tile) {
            demand.reservedTileIndex = tile.tileIndex;
        }
        return tile;
    }

    /** Commit `unitId` to `demand`. Emits workerAssigned and marks the site phase as started. */
    private bindWorker(demand: ConstructionWorkerDemand, unitId: number): void {
        const current = this.demandByWorker.get(unitId);
        if (current) {
            throw new Error(
                `ConstructionSiteDemand.bindWorker: unit ${unitId} already committed to site ${current.siteId} ` +
                    `as ${current.role} (requested site ${demand.siteId} as ${demand.role})`
            );
        }
        demand.workerId = unitId;
        this.demandByWorker.set(unitId, demand);
        this.eventBus.emit('construction:workerAssigned', { buildingId: demand.siteId, unitId, role: demand.role });
        if (demand.role === 'digger') {
            this.siteManager.markDiggingStarted(demand.siteId);
        } else {
            this.siteManager.markBuildingStarted(demand.siteId);
        }
    }

    /** Release the demand's tile reservation and committed worker; the demand stays (unbound). */
    private releaseDemand(demand: ConstructionWorkerDemand): void {
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
    private retireDemand(demand: ConstructionWorkerDemand): void {
        this.releaseDemand(demand);
        const siteDemands = this.demands.get(demand.siteId)!;
        const idx = siteDemands.indexOf(demand);
        if (idx === -1) {
            throw new Error(
                `ConstructionSiteDemand.retireDemand: ${demand.role} demand not found on site ${demand.siteId}`
            );
        }
        siteDemands.splice(idx, 1);
        if (siteDemands.length === 0) {
            this.demands.delete(demand.siteId);
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

function makeDemand(site: ConstructionSite, role: ConstructionWorkerRole): ConstructionWorkerDemand {
    return { siteId: site.buildingId, role, workerId: null, player: site.player, reservedTileIndex: null };
}
