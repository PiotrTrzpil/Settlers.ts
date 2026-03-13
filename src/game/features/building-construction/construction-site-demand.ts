/**
 * ConstructionSiteDemandSystem — site-driven demand orchestration for
 * construction workers (diggers and builders).
 *
 * Owns a Map<siteId, ConstructionWorkerDemand[]>. Creates demands when
 * sites register, fulfills them via tick-driven drain (~1s), and pushes
 * next work assignments when jobs complete. Global cap: 4 diggers and
 * 4 builders per player across all sites.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { ChoreoJobState } from '../../systems/choreo/types';
import { UnitType } from '../../core/unit-types';
import { EntityType } from '../../entity';
import type { DispatchRecruitmentOpts } from '../../systems/recruit/recruit-system';
import type { ConstructionSiteManager } from './construction-site-manager';
import { buildDigTileJob, buildBuildStepJob, buildRecruitDiggerJob, buildRecruitBuilderJob } from './construction-jobs';
import { createLogger } from '@/utilities/logger';

const log = createLogger('ConstructionSiteDemand');

const TICK_INTERVAL = 1.0;
const MAX_DIGGERS_PER_PLAYER = 4;
const MAX_BUILDERS_PER_PLAYER = 4;

// ─── Public types ────────────────────────────────────────────

/** Tracks one worker demand for a construction site. */
export interface ConstructionWorkerDemand {
    /** Construction site (building entity ID). */
    siteId: number;
    /** Role: digger or builder. */
    role: 'digger' | 'builder';
    /** Committed worker ID, or null if still searching for a candidate. */
    workerId: number | null;
    /** Player who owns the site. */
    player: number;
    /** Reserved tile index for diggers (released on interrupt). */
    reservedTileIndex: number | null;
}

// ─── Config ──────────────────────────────────────────────────

export interface ConstructionSiteDemandConfig {
    gameState: GameState;
    eventBus: EventBus;
    siteManager: ConstructionSiteManager;
    findIdleSpecialist: (unitType: UnitType, player: number, nearX: number, nearY: number) => number | null;
    assignJob: (unitId: number, job: ChoreoJobState, moveTo?: { x: number; y: number }) => boolean;
    /** Full recruitment dispatch — find candidate, build choreo, assign job, register transform. */
    dispatchRecruitment: (unitType: UnitType, player: number, opts?: DispatchRecruitmentOpts) => number | null;
}

// ─── Job ID constants ────────────────────────────────────────

const CONSTRUCTION_JOB_IDS = new Set(['DIG_TILE', 'BUILD_STEP', 'RECRUIT_DIGGER', 'RECRUIT_BUILDER']);

// ─── System ──────────────────────────────────────────────────

export class ConstructionSiteDemandSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly siteManager: ConstructionSiteManager;
    private readonly findIdleSpecialist: ConstructionSiteDemandConfig['findIdleSpecialist'];
    private readonly assignJob: ConstructionSiteDemandConfig['assignJob'];
    private readonly dispatchRecruitment: ConstructionSiteDemandConfig['dispatchRecruitment'];
    private readonly subscriptions = new EventSubscriptionManager();

    /** All demands keyed by siteId. */
    private readonly demands = new Map<number, ConstructionWorkerDemand[]>();
    private timer = 0;

    constructor(config: ConstructionSiteDemandConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.siteManager = config.siteManager;
        this.findIdleSpecialist = config.findIdleSpecialist;
        this.assignJob = config.assignJob;
        this.dispatchRecruitment = config.dispatchRecruitment;
    }

    // ================================================================
    // Public API
    // ================================================================

    /** Create demands for a newly registered site (digger phase). */
    onSiteRegistered(siteId: number): void {
        const site = this.siteManager.getSiteOrThrow(siteId, 'DemandSystem.onSiteRegistered');
        const count = site.terrain.slots.required;
        const player = site.player;

        const siteDemands: ConstructionWorkerDemand[] = [];
        for (let i = 0; i < count; i++) {
            siteDemands.push({
                siteId,
                role: 'digger',
                workerId: null,
                player,
                reservedTileIndex: null,
            });
        }

        if (siteDemands.length > 0) {
            this.demands.set(siteId, siteDemands);
            log.debug(`Created ${siteDemands.length} digger demands for site ${siteId}`);
        }
    }

    /** Cancel all demands for a removed site, release workers. */
    onSiteRemoved(siteId: number): void {
        const siteDemands = this.demands.get(siteId);
        if (!siteDemands) {
            return;
        }

        for (const demand of siteDemands) {
            this.releaseDemandResources(demand);
        }

        this.demands.delete(siteId);
        log.debug(`Removed all demands for site ${siteId}`);
    }

    /** Called when leveling completes — release digger demands, create builder demands. */
    onLevelingComplete(siteId: number): void {
        const site = this.siteManager.getSiteOrThrow(siteId, 'DemandSystem.onLevelingComplete');

        // Release all digger demands
        const existing = this.demands.get(siteId);
        if (existing) {
            for (const demand of existing) {
                if (demand.role === 'digger') {
                    this.releaseDemandResources(demand);
                }
            }
        }

        // Create builder demands if materials are available
        if (!this.siteManager.hasAvailableMaterials(siteId)) {
            this.demands.delete(siteId);
            return;
        }

        const count = site.building.slots.required;
        const player = site.player;

        const builderDemands: ConstructionWorkerDemand[] = [];
        for (let i = 0; i < count; i++) {
            builderDemands.push({
                siteId,
                role: 'builder',
                workerId: null,
                player,
                reservedTileIndex: null,
            });
        }

        if (builderDemands.length > 0) {
            this.demands.set(siteId, builderDemands);
            log.debug(`Created ${builderDemands.length} builder demands for site ${siteId}`);
        } else {
            this.demands.delete(siteId);
        }
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

        const existing = this.demands.get(siteId) ?? [];
        const activeBuilders = existing.filter(d => d.role === 'builder').length;
        const count = site.building.slots.required - activeBuilders;
        if (count <= 0) {
            return;
        }

        for (let i = 0; i < count; i++) {
            existing.push({
                siteId,
                role: 'builder',
                workerId: null,
                player: site.player,
                reservedTileIndex: null,
            });
        }

        if (existing.length > 0) {
            this.demands.set(siteId, existing);
            log.debug(`Added ${count} builder demands for site ${siteId} after delivery`);
        }
    }

    /** Called when a worker's choreo job completes — push next assignment. */
    onWorkerJobCompleted(workerId: number, siteId: number): void {
        const demand = this.findDemandForWorker(workerId, siteId);
        if (!demand) {
            return;
        }

        if (demand.role === 'digger') {
            this.pushNextDiggerJob(demand);
        } else {
            this.pushNextBuilderJob(demand);
        }
    }

    /** Called when a worker's choreo job fails — release and re-demand. */
    onWorkerJobFailed(workerId: number, siteId: number): void {
        const demand = this.findDemandForWorker(workerId, siteId);
        if (!demand) {
            return;
        }

        // Release tile reservation if any
        if (demand.reservedTileIndex !== null) {
            this.siteManager.releaseReservedTile(demand.siteId, demand.reservedTileIndex);
            demand.reservedTileIndex = null;
        }

        // Reset to unfulfilled so drain picks it up again
        demand.workerId = null;
        log.debug(`Worker ${workerId} failed at site ${siteId}, demand reset`);
    }

    getDemands(siteId: number): readonly ConstructionWorkerDemand[] | undefined {
        return this.demands.get(siteId);
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
        this.subscriptions.subscribe(this.eventBus, 'settler:taskCompleted', ({ unitId, jobId }) => {
            if (!CONSTRUCTION_JOB_IDS.has(jobId)) {
                return;
            }
            const siteId = this.findSiteForWorker(unitId);
            if (siteId !== null) {
                this.onWorkerJobCompleted(unitId, siteId);
            }
        });

        this.subscriptions.subscribe(this.eventBus, 'settler:taskFailed', ({ unitId, jobId }) => {
            if (!CONSTRUCTION_JOB_IDS.has(jobId)) {
                return;
            }
            const siteId = this.findSiteForWorker(unitId);
            if (siteId !== null) {
                this.onWorkerJobFailed(unitId, siteId);
            }
        });

        this.subscriptions.subscribe(this.eventBus, 'construction:levelingComplete', ({ buildingId }) => {
            this.onLevelingComplete(buildingId);
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
        this.timer += dt;
        if (this.timer < TICK_INTERVAL) {
            return;
        }
        this.timer -= TICK_INTERVAL;
        this.drainDemands();
    }

    // ================================================================
    // Internal — demand fulfillment
    // ================================================================

    private drainDemands(): void {
        for (const [siteId, siteDemands] of this.demands) {
            // Discard if site no longer exists
            if (!this.siteManager.getSite(siteId)) {
                this.demands.delete(siteId);
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
            this.releaseJobResources(demand);
            return;
        }

        demand.workerId = unitId;
        this.claimSlot(demand);
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
        let reservedTile: { tileIndex: number; x: number; y: number } | null = null;
        if (demand.role === 'digger') {
            reservedTile = this.siteManager.reserveUnleveledTile(demand.siteId);
            if (!reservedTile) {
                return;
            }
            demand.reservedTileIndex = reservedTile.tileIndex;
        } else {
            if (!this.siteManager.hasAvailableMaterials(demand.siteId)) {
                return;
            }
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
            this.releaseJobResources(demand);
            return;
        }

        demand.workerId = carrierId;
        this.claimSlot(demand);
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
        const tile = this.siteManager.reserveUnleveledTile(demand.siteId);
        if (!tile) {
            return null;
        }
        demand.reservedTileIndex = tile.tileIndex;
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
        // Clear previous tile reservation
        demand.reservedTileIndex = null;

        // Site may have been removed (building destroyed while digger was working)
        if (!this.siteManager.getSite(demand.siteId)) {
            this.releaseDemandResources(demand);
            this.removeDemand(demand);
            log.debug(`Digger ${demand.workerId} released — site ${demand.siteId} removed`);
            return;
        }

        const tile = this.siteManager.reserveUnleveledTile(demand.siteId);
        if (!tile) {
            // No more tiles — worker done with this site, release slot
            this.releaseDemandResources(demand);
            this.removeDemand(demand);
            log.debug(`Digger ${demand.workerId} finished all tiles at site ${demand.siteId}`);
            return;
        }

        demand.reservedTileIndex = tile.tileIndex;
        const job = buildDigTileJob(tile.x, tile.y, demand.siteId, tile.tileIndex);
        const assigned = this.assignJob(demand.workerId!, job);
        if (!assigned) {
            this.siteManager.releaseReservedTile(demand.siteId, tile.tileIndex);
            demand.reservedTileIndex = null;
            demand.workerId = null;
            log.debug(`Failed to assign next dig job to worker ${demand.workerId}`);
        }
    }

    private pushNextBuilderJob(demand: ConstructionWorkerDemand): void {
        // Site may have been completed and removed by the BUILD_STEP that just finished
        if (!this.siteManager.getSite(demand.siteId) || !this.siteManager.hasAvailableMaterials(demand.siteId)) {
            this.releaseDemandResources(demand);
            this.removeDemand(demand);
            log.debug(`Builder ${demand.workerId} released — site ${demand.siteId} done or no materials`);
            return;
        }

        const pos = this.siteManager.getRandomBuilderWorkPos(demand.siteId);
        const job = buildBuildStepJob(pos.x, pos.y, demand.siteId);
        const assigned = this.assignJob(demand.workerId!, job);
        if (!assigned) {
            demand.workerId = null;
            log.debug(`Failed to assign next build job to worker ${demand.workerId}`);
        }
    }

    // ================================================================
    // Internal — helpers
    // ================================================================

    /**
     * How many more workers of this role can be auto-recruited from carriers.
     * Counts all existing entities of the relevant type for the player —
     * not just demand-committed workers. This prevents over-recruitment when
     * workers finish their demands and become idle (demands removed but entities persist).
     */
    private remainingRecruitmentCap(role: 'digger' | 'builder', player: number): number {
        const max = role === 'digger' ? MAX_DIGGERS_PER_PLAYER : MAX_BUILDERS_PER_PLAYER;
        const unitType = role === 'digger' ? UnitType.Digger : UnitType.Builder;

        let existing = 0;
        for (const entity of this.gameState.entities) {
            if (entity.type === EntityType.Unit && entity.subType === unitType && entity.player === player) {
                existing++;
            }
        }

        return Math.max(0, max - existing);
    }

    private findDemandForWorker(workerId: number, siteId: number): ConstructionWorkerDemand | null {
        const siteDemands = this.demands.get(siteId);
        if (!siteDemands) {
            return null;
        }
        return siteDemands.find(d => d.workerId === workerId) ?? null;
    }

    private findSiteForWorker(workerId: number): number | null {
        for (const [siteId, siteDemands] of this.demands) {
            for (const d of siteDemands) {
                if (d.workerId === workerId) {
                    return siteId;
                }
            }
        }
        return null;
    }

    private removeDemand(demand: ConstructionWorkerDemand): void {
        const siteDemands = this.demands.get(demand.siteId);
        if (!siteDemands) {
            return;
        }

        const idx = siteDemands.indexOf(demand);
        if (idx !== -1) {
            siteDemands.splice(idx, 1);
        }
        if (siteDemands.length === 0) {
            this.demands.delete(demand.siteId);
        }
    }

    private claimSlot(demand: ConstructionWorkerDemand): void {
        if (demand.role === 'digger') {
            this.siteManager.claimDiggerSlot(demand.siteId, demand.workerId!);
        } else {
            this.siteManager.claimBuilderSlot(demand.siteId, demand.workerId!);
        }
    }

    private releaseDemandResources(demand: ConstructionWorkerDemand): void {
        // Site may have been removed (building completed/destroyed) — skip slot release
        if (!this.siteManager.getSite(demand.siteId)) {
            return;
        }

        if (demand.reservedTileIndex !== null) {
            this.siteManager.releaseReservedTile(demand.siteId, demand.reservedTileIndex);
            demand.reservedTileIndex = null;
        }
        if (demand.workerId !== null) {
            if (demand.role === 'digger') {
                this.siteManager.releaseDiggerSlot(demand.siteId, demand.workerId);
            } else {
                this.siteManager.releaseBuilderSlot(demand.siteId, demand.workerId);
            }
        }
    }

    private releaseJobResources(demand: ConstructionWorkerDemand): void {
        this.releaseDemandResources(demand);
    }
}
