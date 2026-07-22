/**
 * UnitJobService — assign / interrupt / move-task operations for units.
 *
 * Extracted from SettlerTaskSystem so logistics and demand systems depend on a
 * focused assignment surface (TaskDispatcher) without the full task facade.
 */

import { EntityType, UnitType, BuildingType, tileKey, type Entity, Tile, getEntityIfType } from '../../entity';
import type { GameState } from '../../game-state';
import { createLogger } from '@/utilities/logger';
import { getBuildingDoorPos } from '../../data/game-data-access';
import { SettlerState, type JobState, type SettlerConfig } from './types';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { WorkerTaskExecutor } from './worker-task-executor';
import type { UnitRuntime } from './unit-state-machine';
import type { BuildingWorkerTracker } from './building-worker-tracker';
import type { IndexedMap } from '@/game/utils/indexed-map';

const log = createLogger('UnitJobService');

export interface UnitJobServiceConfig {
    gameState: GameState;
    runtimes: IndexedMap<number, UnitRuntime>;
    settlerConfigs: Map<UnitType, SettlerConfig>;
    workerExecutor: WorkerTaskExecutor;
    workerTracker: BuildingWorkerTracker;
    handlerRegistry: WorkHandlerRegistry;
    getOrCreateRuntime: (entityId: number) => UnitRuntime;
}

/**
 * Owns assignJob / assignMoveTask / interrupt-for-reassign.
 * SettlerTaskSystem constructs this and implements TaskDispatcher by delegation.
 * Does not touch animation — walk visuals follow movement state in UnitStateMachine.
 */
export class UnitJobService {
    private readonly gameState: GameState;
    private readonly runtimes: IndexedMap<number, UnitRuntime>;
    private readonly settlerConfigs: Map<UnitType, SettlerConfig>;
    private readonly workerExecutor: WorkerTaskExecutor;
    private readonly workerTracker: BuildingWorkerTracker;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly getOrCreateRuntime: (entityId: number) => UnitRuntime;

    constructor(config: UnitJobServiceConfig) {
        this.gameState = config.gameState;
        this.runtimes = config.runtimes;
        this.settlerConfigs = config.settlerConfigs;
        this.workerExecutor = config.workerExecutor;
        this.workerTracker = config.workerTracker;
        this.handlerRegistry = config.handlerRegistry;
        this.getOrCreateRuntime = config.getOrCreateRuntime;
    }

    /**
     * Assign a choreography job to a unit.
     * @param numericJobId When set (e.g. transport record id), reused as entity.jobId.
     */
    assignJob(entityId: number, job: JobState, moveTo?: Tile, numericJobId?: number): boolean {
        const entity = this.gameState.getEntityOrThrow(entityId, 'unit for job assignment');
        const runtime = this.getOrCreateRuntime(entityId);

        if (runtime.job) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config) {
                this.interruptJobForCleanup(entity, config, runtime);
            }
            runtime.job = null;
        }

        if (moveTo) {
            const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo);
            if (!moveSuccess) {
                return false;
            }
        }

        runtime.state = SettlerState.WORKING;
        runtime.job = job;
        runtime.moveTask = null;

        const jobNumericId = numericJobId ?? this.gameState.allocateJobId();
        entity.jobId = jobNumericId;

        log.debug(`Unit ${entityId} assigned job ${job.jobId} (numeric id ${jobNumericId})`);
        return true;
    }

    assignMoveTask(entityId: number, target: Tile): boolean {
        const entity = getEntityIfType(this.gameState, entityId, EntityType.Unit);
        if (!entity) {
            return false;
        }

        let moveTo: Tile = target;
        if (this.gameState.buildingOccupancy.has(tileKey(moveTo))) {
            const building = this.gameState.getGroundEntityAt(moveTo);
            if (building && building.type === EntityType.Building) {
                moveTo = getBuildingDoorPos(building, building.race, building.subType as BuildingType);
            }
        }

        const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo);
        if (!moveSuccess) {
            return false;
        }

        const runtime = this.getOrCreateRuntime(entityId);
        const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
        if (runtime.job) {
            if (unitConfig) {
                this.interruptJobForCleanup(entity, unitConfig, runtime);
            }
            runtime.job = null;
        }

        if (unitConfig) {
            const posHandler = this.handlerRegistry.getPositionHandler(unitConfig.plantSearch ?? unitConfig.search);
            posHandler?.onSettlerRemoved?.(entityId, target.x, target.y);
        }

        this.workerTracker.release(entityId, runtime);

        runtime.moveTask = { type: 'move', targetX: target.x, targetY: target.y };
        runtime.state = SettlerState.WORKING;

        log.debug(`Unit ${entityId} assigned move task to (${target.x}, ${target.y})`);
        return true;
    }

    cancelMoveTask(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (runtime?.moveTask) {
            runtime.moveTask = null;
        }
    }

    /** Complete or interrupt the current job so a new assignment can take over. */
    interruptJobForCleanup(entity: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        if (runtime.job!.nodeIndex >= runtime.job!.nodes.length) {
            this.workerExecutor.completeJob(entity, runtime);
        } else {
            this.workerExecutor.interruptJob(entity, config, runtime);
        }
    }
}
