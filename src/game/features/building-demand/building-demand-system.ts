/**
 * BuildingDemandSystem — orchestrates "building needs a worker".
 *
 * Owns a Map<buildingId, BuildingDemand>. On each tick, iterates
 * pending (uncommitted) demands and tries to fulfill them:
 *   1. Find idle specialist → WORKER_DISPATCH choreo job
 *   2. Find idle carrier → RECRUIT_TO_WORKPLACE or
 *      DIRECT_RECRUIT_TO_WORKPLACE choreo job
 *   3. No candidate → retry next tick
 *
 * Listens to building:completed, building:workerLost, building:removed
 * and settler:taskCompleted / settler:taskFailed for lifecycle management.
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { BuildingDemand } from './types';
import type { UnitType } from '../../core/unit-types';
import type { Race } from '../../core/race';
import type { ChoreoJobState } from '../../systems/choreo';
import type { DispatchRecruitmentOpts } from '../../systems/recruit/recruit-system';
import { choreo } from '../../systems/choreo/choreo-builder';
import { getBuildingWorkerInfo } from '../../data/game-data-access';
import { createLogger } from '@/utilities/logger';

const log = createLogger('BuildingDemand');

const TICK_INTERVAL = 1.0; // seconds between demand scans

// ─── Config ──────────────────────────────────────────────────

export interface BuildingDemandSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
    findIdleSpecialist: (
        unitType: UnitType,
        player: number,
        nearX: number,
        nearY: number,
    ) => number | null;
    assignJob: (
        unitId: number,
        job: ChoreoJobState,
        moveTo?: { x: number; y: number },
    ) => boolean;
    assignWorkerToBuilding: (
        settlerId: number,
        buildingId: number,
    ) => void;
    /** Full recruitment dispatch — find candidate, build choreo, assign job, register transform. */
    dispatchRecruitment: (
        unitType: UnitType,
        player: number,
        opts?: DispatchRecruitmentOpts,
    ) => number | null;
}

// ─── System ──────────────────────────────────────────────────

export class BuildingDemandSystem implements TickSystem {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly findIdleSpecialist: BuildingDemandSystemConfig['findIdleSpecialist'];
    private readonly assignJob: BuildingDemandSystemConfig['assignJob'];
    private readonly assignWorkerToBuilding: BuildingDemandSystemConfig['assignWorkerToBuilding'];
    private readonly dispatchRecruitment: BuildingDemandSystemConfig['dispatchRecruitment'];
    private readonly subscriptions = new EventSubscriptionManager();

    private readonly demands = new Map<number, BuildingDemand>();
    private timer = 0;

    constructor(config: BuildingDemandSystemConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.findIdleSpecialist = config.findIdleSpecialist;
        this.assignJob = config.assignJob;
        this.assignWorkerToBuilding = config.assignWorkerToBuilding;
        this.dispatchRecruitment = config.dispatchRecruitment;
    }

    // ================================================================
    // Public API
    // ================================================================

    getDemand(buildingId: number): BuildingDemand | undefined {
        return this.demands.get(buildingId);
    }

    hasDemand(buildingId: number): boolean {
        return this.demands.has(buildingId);
    }

    get demandCount(): number {
        return this.demands.size;
    }

    // ================================================================
    // Event registration
    // ================================================================

    registerEvents(): void {
        this.subscriptions.subscribe(
            this.eventBus,
            'building:completed',
            ({ entityId, buildingType, race, spawnWorker }) => {
                if (spawnWorker) return;
                this.addDemandFromBuilding(entityId, buildingType, race);
            }
        );

        this.subscriptions.subscribe(
            this.eventBus,
            'building:workerLost',
            ({ buildingId, buildingType, race }) => {
                this.addDemandFromBuilding(buildingId, buildingType, race);
            }
        );

        this.subscriptions.subscribe(
            this.eventBus,
            'building:removed',
            ({ entityId }) => {
                this.demands.delete(entityId);
            }
        );

        // When a carrier transforms into a specialist, assign the new worker to its building.
        // The carrier recruitment path (dispatchCarrier) doesn't call assignWorkerToBuilding
        // at dispatch time — the assignment happens here after the transformation completes.
        this.subscriptions.subscribe(
            this.eventBus,
            'unit:transformed',
            ({ entityId }) => {
                this.handleUnitTransformed(entityId);
            }
        );

        this.subscriptions.subscribe(
            this.eventBus,
            'settler:taskCompleted',
            ({ unitId, jobId }) => {
                this.handleJobFinished(unitId, jobId);
            }
        );

        this.subscriptions.subscribe(
            this.eventBus,
            'settler:taskFailed',
            ({ unitId, jobId }) => {
                this.handleJobFailed(unitId, jobId);
            }
        );
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    // ================================================================
    // TickSystem
    // ================================================================

    tick(dt: number): void {
        this.timer += dt;
        if (this.timer < TICK_INTERVAL) return;
        this.timer -= TICK_INTERVAL;
        this.drainDemands();
    }

    // ================================================================
    // Internal — demand creation
    // ================================================================

    private addDemandFromBuilding(
        buildingId: number,
        buildingType: number,
        race: Race,
    ): void {
        if (this.demands.has(buildingId)) return; // already pending

        const entity = this.gameState.getEntity(buildingId);
        if (!entity) return;

        const workerInfo = getBuildingWorkerInfo(race, buildingType);
        if (!workerInfo) return;

        const demand: BuildingDemand = {
            buildingId,
            unitType: workerInfo.unitType,
            toolMaterial: workerInfo.tool ?? null,
            player: entity.player,
            race,
            committedUnitId: null,
        };

        this.demands.set(buildingId, demand);
        log.debug(
            `Demand added: building ${buildingId} needs`
            + ` unit type ${demand.unitType}`
        );
    }

    // ================================================================
    // Internal — demand fulfillment
    // ================================================================

    private drainDemands(): void {
        for (const [buildingId, demand] of this.demands) {
            // Skip already committed demands
            if (demand.committedUnitId !== null) continue;

            // Discard if building no longer exists
            if (!this.gameState.getEntity(buildingId)) {
                this.demands.delete(buildingId);
                continue;
            }

            this.tryFulfill(demand);
        }
    }

    private tryFulfill(demand: BuildingDemand): void {
        const building = this.gameState.getEntityOrThrow(
            demand.buildingId, 'BuildingDemand.tryFulfill'
        );

        // 1. Try idle specialist
        const specialistId = this.findIdleSpecialist(
            demand.unitType,
            demand.player,
            building.x,
            building.y,
        );

        if (specialistId !== null) {
            this.dispatchSpecialist(specialistId, demand);
            return;
        }

        // 2. Try carrier recruitment — RecruitSystem handles everything
        const carrierId = this.dispatchRecruitment(
            demand.unitType, demand.player,
            { target: { x: building.x, y: building.y } },
        );
        if (carrierId === null) return; // retry next tick

        demand.committedUnitId = carrierId;
        log.debug(`Carrier ${carrierId} recruiting for building ${demand.buildingId}`);
    }

    private dispatchSpecialist(
        unitId: number,
        demand: BuildingDemand,
    ): void {
        const job = choreo('WORKER_DISPATCH')
            .goToDoorAndEnter(demand.buildingId)
            .build();

        const assigned = this.assignJob(unitId, job);
        if (!assigned) return;

        this.assignWorkerToBuilding(unitId, demand.buildingId);
        demand.committedUnitId = unitId;

        log.debug(
            `Specialist ${unitId} dispatched to`
            + ` building ${demand.buildingId}`
        );
    }

    // ================================================================
    // Internal — job lifecycle callbacks
    // ================================================================

    private handleUnitTransformed(entityId: number): void {
        for (const [buildingId, demand] of this.demands) {
            if (demand.committedUnitId === entityId) {
                this.assignWorkerToBuilding(entityId, buildingId);
                this.demands.delete(buildingId);
                log.debug(
                    `Recruited unit ${entityId} assigned`
                    + ` to building ${buildingId}`
                );
                return;
            }
        }
    }

    private handleJobFinished(unitId: number, jobId: string): void {
        if (!this.isDispatchJob(jobId)) return;

        // Find and remove the demand committed to this unit
        for (const [buildingId, demand] of this.demands) {
            if (demand.committedUnitId === unitId) {
                this.demands.delete(buildingId);
                log.debug(
                    `Demand fulfilled: unit ${unitId}`
                    + ` entered building ${buildingId}`
                );
                return;
            }
        }
    }

    private handleJobFailed(unitId: number, jobId: string): void {
        if (!this.isDispatchJob(jobId)) return;

        // Reset committed unit so demand can be retried
        for (const demand of this.demands.values()) {
            if (demand.committedUnitId === unitId) {
                demand.committedUnitId = null;
                log.debug(
                    `Dispatch failed: unit ${unitId}, will retry`
                    + ` building ${demand.buildingId}`
                );
                return;
            }
        }
    }

    private isDispatchJob(jobId: string): boolean {
        return jobId === 'WORKER_DISPATCH'
            || jobId === 'RECRUIT_TO_WORKPLACE'
            || jobId === 'DIRECT_RECRUIT_TO_WORKPLACE'
            || jobId === 'AUTO_RECRUIT';
    }
}
