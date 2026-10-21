/**
 * MoveTaskRunner — move tasks: a unit walks to a tile under a move commitment.
 *
 * Owner 'player-move' (player commands) commits the unit for the walk only — the commitment
 * ends with the walk. Any other owner (siege) must already hold the unit; the walk keeps that
 * hold's ref / reserved flag, and the commitment stays as a hold after the walk.
 */

import { EntityType, UnitType, BuildingType, getEntityIfType, tileKey, type Entity, type Tile } from '../../../entity';
import { createLogger } from '@/utilities/logger';
import { getBuildingDoorPos } from '../../../data/game-data-access';
import type { GameState } from '../../../game-state';
import type {
    CommitmentOwner,
    UnitCommitment,
    UnitCommitmentQuery,
    UnitCommitmentWriter,
} from '../../../systems/unit-commitment';
import { SettlerState, type SettlerConfig } from '../types';
import type { WorkHandlerRegistry } from '../work-handler-registry';
import type { IdleAnimationController } from '../idle-animation-controller';
import type { UnitRuntime, UnitRuntimeStore } from '../unit-runtime';
import type { WorkerAssignments } from '../worker-assignments';
import type { JobOutcomes } from './job-outcomes';

const log = createLogger('MoveTaskRunner');

export interface MoveTaskRunnerConfig {
    gameState: GameState;
    runtimes: UnitRuntimeStore;
    assignments: WorkerAssignments;
    settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    handlerRegistry: WorkHandlerRegistry;
    animController: IdleAnimationController;
    outcomes: JobOutcomes;
    commitments: UnitCommitmentQuery;
    commitmentWriter: UnitCommitmentWriter;
}

export class MoveTaskRunner {
    private readonly gameState: GameState;
    private readonly runtimes: UnitRuntimeStore;
    private readonly assignments: WorkerAssignments;
    private readonly settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly outcomes: JobOutcomes;
    private readonly commitments: UnitCommitmentQuery;
    private readonly writer: UnitCommitmentWriter;

    constructor(cfg: MoveTaskRunnerConfig) {
        this.gameState = cfg.gameState;
        this.runtimes = cfg.runtimes;
        this.assignments = cfg.assignments;
        this.settlerConfigs = cfg.settlerConfigs;
        this.handlerRegistry = cfg.handlerRegistry;
        this.animController = cfg.animController;
        this.outcomes = cfg.outcomes;
        this.commitments = cfg.commitments;
        this.writer = cfg.commitmentWriter;
    }

    /**
     * Walk to `target` (a building tile redirects to its door): ends the current job (owner gets
     * 'preempted'), releases the home assignment and commits the unit to `owner`.
     * Returns false when the unit is not a unit or the target is unreachable (nothing changes then).
     */
    assign(entityId: number, target: Tile, owner: CommitmentOwner): boolean {
        const entity = getEntityIfType(this.gameState, entityId, EntityType.Unit);
        if (!entity) {
            return false;
        }

        const commitment = this.moveCommitment(entityId, owner);
        const moveSuccess = this.gameState.movement.moveUnit(entityId, this.resolveWalkTarget(target));
        if (!moveSuccess) {
            return false;
        }

        const runtime = this.runtimes.getOrCreate(entityId);
        this.outcomes.takeOver(entity, runtime, owner);

        const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
        if (unitConfig) {
            const posHandler = this.handlerRegistry.getPositionHandler(unitConfig.plantSearch ?? unitConfig.search);
            posHandler?.onSettlerRemoved?.(entityId, target.x, target.y);
        }

        this.assignments.release(entityId, runtime);

        runtime.moveTask = { type: 'move', targetX: target.x, targetY: target.y };
        runtime.state = SettlerState.WORKING;
        this.writer.set(entityId, commitment);

        log.debug(`Unit ${entityId} assigned move task to (${target.x}, ${target.y}) for '${owner}'`);
        return true;
    }

    /**
     * Restore a saved move task (no takeover — the unit was restored idle). Returns false when the
     * target is unreachable now; the caller decides what the unit's commitment becomes.
     */
    restore(entityId: number, target: Tile): boolean {
        const runtime = this.runtimes.getOrCreate(entityId);
        if (!this.gameState.movement.moveUnit(entityId, target)) {
            return false;
        }
        runtime.moveTask = { type: 'move', targetX: target.x, targetY: target.y };
        runtime.state = SettlerState.WORKING;
        return true;
    }

    /** Advance a move task; ends it when the unit stops moving. */
    tick(unit: Entity, runtime: UnitRuntime): void {
        const controller = this.gameState.movement.getController(unit.id);
        if (!controller) {
            // No movement controller — cancel task
            this.end(unit.id, runtime);
            runtime.state = SettlerState.IDLE;
            this.animController.setIdleAnimation(unit);
            return;
        }

        if (controller.state === 'idle') {
            this.end(unit.id, runtime);
            runtime.state = SettlerState.IDLE;
            this.animController.setIdleAnimation(unit);
            runtime.idleState.idleTime = 0;
            log.debug(`Unit ${unit.id} completed move task`);
        }
    }

    /**
     * Drop the unit's move task. A 'player-move' commitment ends with it; the commitment of any
     * other move owner (siege) stays, as a hold.
     */
    end(entityId: number, runtime: UnitRuntime): void {
        runtime.moveTask = null;
        const commitment = this.commitments.get(entityId);
        if (commitment && commitment.owner === 'player-move') {
            this.writer.clear(entityId);
        }
    }

    private resolveWalkTarget(target: Tile): Tile {
        if (this.gameState.buildingOccupancy.has(tileKey(target))) {
            const building = this.gameState.getGroundEntityAt(target);
            if (building && building.type === EntityType.Building) {
                return getBuildingDoorPos(building, building.race, building.subType as BuildingType);
            }
        }
        return target;
    }

    /** The commitment a move task of `owner` runs under (see class doc). */
    private moveCommitment(entityId: number, owner: CommitmentOwner): UnitCommitment {
        if (owner === 'player-move') {
            return { owner, ref: -1, reserved: false, hasJob: false };
        }
        const held = this.commitments.get(entityId);
        if (!held || held.owner !== owner) {
            throw new Error(
                // eslint-disable-next-line no-restricted-syntax -- nullable field with display default
                `assignMoveTask: unit ${entityId} must be held by '${owner}' first (held by '${held?.owner ?? 'none'}')`
            );
        }
        return { owner, ref: held.ref, reserved: held.reserved, hasJob: false };
    }
}
