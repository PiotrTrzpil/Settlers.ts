/**
 * BuildingDemandSystem — orchestrates "building needs a worker".
 *
 * Owns a Map<buildingId, BuildingDemand>. On each drain, iterates pending (uncommitted) demands
 * and tries to fulfill them with an owned `WorkplaceDispatch` job (ref = building id):
 *   1. Idle specialist → walks to the door and enters
 *   2. Idle carrier → recruit segment (tool pile / in place) + walk to the door and enter
 *   3. No candidate → retry next drain
 *
 * The demand stays committed to its unit until the job ends: completion fulfills it; failure,
 * preemption and unit removal re-open it (direct handler calls — see workplace-dispatch-kind.ts).
 * Building removal cancels the unit's job. Listens to building:completed, building:workerLost,
 * building:removed and unit:recruited (a recruit gets its home assignment at the transform).
 */

import type { TickSystem } from '../../core/tick-system';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { BuildingDemand } from './types';
import type { BuildingType } from '../../buildings/building-type';
import { getBuildingMaxOccupants } from '../../buildings/types';
import type { UnitType } from '../../core/unit-types';
import type { Race } from '../../core/race';
import { JobKind } from '../../systems/choreo';
import type { DispatchRecruitmentOpts } from '../recruit';
import type { JobService } from '../settler-tasks';
import { getBuildingWorkerInfo } from '../../data/game-data-access';
import { createLogger } from '@/utilities/logger';
import { IntervalDrain } from '../../systems/interval-drain';
import {
    workplaceDispatchSpec,
    type WorkplaceDispatchOwner,
    type WorkplaceDispatchParams,
} from './workplace-dispatch-kind';

const log = createLogger('BuildingDemand');

const TICK_INTERVAL = 1.0; // seconds between demand scans

// ─── Config ──────────────────────────────────────────────────

export interface BuildingDemandSystemConfig {
    gameState: GameState;
    eventBus: EventBus;
    jobs: JobService;
    findIdleSpecialist: (unitType: UnitType, player: number, nearX: number, nearY: number) => number | null;
    assignWorkerToBuilding: (settlerId: number, buildingId: number) => void;
    /** Recruitment dispatch — find a carrier + source, reserve it, assign the spec built by `opts.buildSpec`. */
    dispatchRecruitment: (unitType: UnitType, player: number, opts: DispatchRecruitmentOpts) => number | null;
    /** Current assigned worker count for a building (from WorkerAssignments.getOccupantCount). */
    getOccupantCount: (buildingId: number) => number;
}

// ─── System ──────────────────────────────────────────────────

export class BuildingDemandSystem implements TickSystem, WorkplaceDispatchOwner {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly jobs: JobService;
    private readonly findIdleSpecialist: BuildingDemandSystemConfig['findIdleSpecialist'];
    private readonly assignWorkerToBuilding: BuildingDemandSystemConfig['assignWorkerToBuilding'];
    private readonly dispatchRecruitment: BuildingDemandSystemConfig['dispatchRecruitment'];
    private readonly getOccupantCount: BuildingDemandSystemConfig['getOccupantCount'];
    private readonly subscriptions = new EventSubscriptionManager();

    private readonly demands = new Map<number, BuildingDemand>();
    private readonly drain = new IntervalDrain(TICK_INTERVAL);

    constructor(config: BuildingDemandSystemConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.jobs = config.jobs;
        this.findIdleSpecialist = config.findIdleSpecialist;
        this.assignWorkerToBuilding = config.assignWorkerToBuilding;
        this.dispatchRecruitment = config.dispatchRecruitment;
        this.getOccupantCount = config.getOccupantCount;
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
            ({ buildingId, buildingType, race, spawnWorker }) => {
                if (spawnWorker) {
                    return;
                }
                this.addDemandFromBuilding(buildingId, buildingType, race);
            }
        );

        this.subscriptions.subscribe(this.eventBus, 'building:workerLost', ({ buildingId, buildingType, race }) => {
            this.addDemandFromBuilding(buildingId, buildingType, race);
        });

        this.subscriptions.subscribe(this.eventBus, 'building:removed', ({ buildingId }) => {
            this.removeBuilding(buildingId);
        });

        // A recruiting carrier becomes the building's worker at its transform (the job then walks it in).
        this.subscriptions.subscribe(this.eventBus, 'unit:recruited', ({ unitId }) => {
            this.handleUnitTransformed(unitId);
        });
    }

    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
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
    // WorkplaceDispatch outcomes (called by the kind handler)
    // ================================================================

    dispatchCompleted(buildingId: number, unitId: number): void {
        this.committedDemandOrThrow(buildingId, unitId);
        this.demands.delete(buildingId);
        log.debug(`Demand fulfilled: unit ${unitId} entered building ${buildingId}`);
    }

    dispatchEnded(buildingId: number, unitId: number): void {
        this.committedDemandOrThrow(buildingId, unitId).committedUnitId = null;
        log.debug(`Dispatch of unit ${unitId} ended early, will retry building ${buildingId}`);
    }

    // ================================================================
    // Demand creation
    // ================================================================

    addDemandFromBuilding(buildingId: number, buildingType: BuildingType, race: Race): void {
        if (this.demands.has(buildingId)) {
            return;
        } // already pending

        // Skip if building already has its maximum number of workers assigned
        if (this.isStaffed(buildingId, buildingType)) {
            return;
        }

        const demand = this.createDemand(buildingId, buildingType, race);
        if (demand) {
            this.demands.set(buildingId, demand);
            log.debug(`Demand added: building ${buildingId} needs unit type ${demand.unitType}`);
        }
    }

    /**
     * Restore: re-create the committed demand of every restored WorkplaceDispatch job (from its
     * commitment + params; the job itself resumes later, in onRestoreResume). Run before the
     * completed buildings' demands are replayed, so those see the demand and do not dispatch twice.
     */
    restoreCommittedDemands(): void {
        for (const unitId of this.jobs.commitments.unitsOwnedBy(JobKind.WorkplaceDispatch)) {
            const { buildingId } = this.jobs.paramsOf(unitId)! as WorkplaceDispatchParams;
            if (this.demands.has(buildingId)) {
                throw new Error(`Building ${buildingId} has two restored WorkplaceDispatch jobs (unit ${unitId})`);
            }
            // Building removal cancels the job, so a saved job's building exists.
            const building = this.gameState.getEntityOrThrow(buildingId, 'building of a restored workplace dispatch');
            const demand = this.createDemand(buildingId, building.subType as BuildingType, building.race);
            if (!demand) {
                throw new Error(`Building ${buildingId} of restored dispatch (unit ${unitId}) needs no worker`);
            }
            demand.committedUnitId = unitId;
            this.demands.set(buildingId, demand);
        }
    }

    /** The demand of a building type that has workers; null for buildings without one. */
    private createDemand(buildingId: number, buildingType: BuildingType, race: Race): BuildingDemand | null {
        const entity = this.gameState.getEntityOrThrow(buildingId, 'building requesting worker demand');
        const workerInfo = getBuildingWorkerInfo(race, buildingType);
        if (!workerInfo) {
            return null;
        }
        return {
            buildingId,
            unitType: workerInfo.unitType,
            // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
            toolMaterial: workerInfo.tool ?? null,
            player: entity.player,
            race,
            committedUnitId: null,
        };
    }

    private isStaffed(buildingId: number, buildingType: BuildingType): boolean {
        return this.getOccupantCount(buildingId) >= getBuildingMaxOccupants(buildingType);
    }

    // ================================================================
    // Demand fulfillment
    // ================================================================

    private drainDemands(): void {
        for (const [buildingId, demand] of this.demands) {
            // Skip already committed demands
            if (demand.committedUnitId !== null) {
                continue;
            }

            // Discard if building no longer exists
            const building = this.gameState.getEntity(buildingId);
            if (!building) {
                this.demands.delete(buildingId);
                continue;
            }

            // A dispatch that ended early may have left its unit with the home assignment (specialists are
            // assigned at dispatch, recruits at the transform) — that unit fills the building.
            if (this.isStaffed(buildingId, building.subType as BuildingType)) {
                this.demands.delete(buildingId);
                continue;
            }

            this.tryFulfill(demand);
        }
    }

    private tryFulfill(demand: BuildingDemand): void {
        const building = this.gameState.getEntityOrThrow(demand.buildingId, 'BuildingDemand.tryFulfill');

        // 1. Try idle specialist
        const specialistId = this.findIdleSpecialist(demand.unitType, demand.player, building.x, building.y);

        if (specialistId !== null) {
            this.dispatchSpecialist(specialistId, demand);
            return;
        }

        // 2. Try carrier recruitment — RecruitSystem picks the carrier + source and assigns our spec
        const carrierId = this.dispatchRecruitment(demand.unitType, demand.player, {
            target: { x: building.x, y: building.y },
            buildSpec: (_carrierId, segment) => workplaceDispatchSpec(demand.buildingId, segment),
        });
        if (carrierId === null) {
            return;
        } // retry next tick

        demand.committedUnitId = carrierId;
        log.debug(`Carrier ${carrierId} recruiting for building ${demand.buildingId}`);
    }

    private dispatchSpecialist(unitId: number, demand: BuildingDemand): void {
        if (!this.jobs.assign(unitId, workplaceDispatchSpec(demand.buildingId, null))) {
            return;
        }

        this.assignWorkerToBuilding(unitId, demand.buildingId);
        demand.committedUnitId = unitId;

        log.debug(`Specialist ${unitId} dispatched to building ${demand.buildingId}`);
    }

    // ================================================================
    // Lifecycle
    // ================================================================

    /** Building gone: cancel its dispatched unit's job (owner cancel — no callback) and drop the demand. */
    private removeBuilding(buildingId: number): void {
        for (const unitId of this.jobs.commitments.unitsOwnedBy(JobKind.WorkplaceDispatch, buildingId)) {
            this.jobs.cancel(unitId, JobKind.WorkplaceDispatch);
        }
        this.demands.delete(buildingId);
    }

    private handleUnitTransformed(unitId: number): void {
        // Nullable by design: unit:recruited fires for every transform (recruit queue, construction, barracks).
        const commitment = this.jobs.commitments.get(unitId);
        if (commitment?.owner !== JobKind.WorkplaceDispatch) {
            return;
        }
        const buildingId = commitment.ref;
        this.committedDemandOrThrow(buildingId, unitId);
        this.assignWorkerToBuilding(unitId, buildingId);
        log.debug(`Recruited unit ${unitId} assigned to building ${buildingId}`);
    }

    private committedDemandOrThrow(buildingId: number, unitId: number): BuildingDemand {
        const demand = this.demands.get(buildingId);
        if (!demand || demand.committedUnitId !== unitId) {
            const found = demand ? `committed to ${demand.committedUnitId}` : 'missing';
            throw new Error(`WorkplaceDispatch of unit ${unitId}: demand of building ${buildingId} is ${found}`);
        }
        return demand;
    }
}
