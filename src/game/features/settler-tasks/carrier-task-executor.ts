/**
 * Carrier job executor (high-level, self-contained).
 *
 * Handles job execution, completion, and interruption for carrier units
 * running externally-assigned CarrierJobState (transport jobs).
 *
 * The transport phase sequence is implemented inline — no YAML job definitions needed.
 * Phases: GO_TO_SOURCE → PICKUP → GO_TO_DEST → DROPOFF → GO_HOME
 */

import { type Entity, setCarrying, clearCarrying, BuildingType } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import { CarrierStatus } from '../carriers';
import { TaskResult, SettlerState, CarrierPhase, type CarrierJobState, type JobState } from './types';
import type { ChoreoContext } from './choreo-types';
import type { IdleAnimationController } from './idle-animation-controller';
import { hexDistance } from '../../systems/hex-directions';
import { getBuildingDoorPos } from '../../game-data-access';

const log = new LogHandler('CarrierTaskExecutor');

/** Fatigue added per delivery cycle */
const FATIGUE_PER_DELIVERY = 5;

/** Carrier phase sequence (indexed by taskIndex). */
const CARRIER_PHASES: readonly CarrierPhase[] = [
    CarrierPhase.GO_TO_SOURCE,
    CarrierPhase.PICKUP,
    CarrierPhase.GO_TO_DEST,
    CarrierPhase.DROPOFF,
    CarrierPhase.GO_HOME,
];

/** Per-unit state needed by the carrier executor (subset of UnitRuntime). */
export interface CarrierRuntimeState {
    state: SettlerState;
    job: JobState | null;
}

export class CarrierTaskExecutor {
    constructor(
        private readonly animController: IdleAnimationController,
        private readonly choreoContext: ChoreoContext
    ) {}

    /**
     * Handle a carrier in WORKING state: advance the current transport phase.
     */
    handleWorking(settler: Entity, runtime: CarrierRuntimeState, _dt: number): void {
        // Job MUST exist when state is WORKING — crash if invariant violated
        const job = runtime.job! as CarrierJobState;
        const phase = CARRIER_PHASES[job.taskIndex] as CarrierPhase | undefined; // undefined when past last phase

        if (!phase) {
            this.completeJob(settler, runtime);
            return;
        }

        // Apply animation on first tick of each phase
        if (job.progress === 0) {
            this.applyPhaseAnimation(settler, phase);
        }

        const result = this.executePhase(settler, job, phase);

        switch (result) {
        case TaskResult.DONE:
            job.taskIndex++;
            job.progress = 0;
            break;

        case TaskResult.FAILED:
            this.interruptJob(settler, runtime);
            break;

        case TaskResult.CONTINUE:
            // Keep going next tick
            break;
        }
    }

    /**
     * Complete a carrier job and return to idle state.
     */
    completeJob(settler: Entity, runtime: CarrierRuntimeState): void {
        log.debug(`Carrier ${settler.id} completed job ${runtime.job!.jobId}`);
        runtime.state = SettlerState.IDLE;
        runtime.job = null;
        this.animController.setIdleAnimation(settler);
    }

    /**
     * Interrupt a carrier job (source gone, destination full, etc.).
     * Carrier reservations are handled by LogisticsDispatcher via InventoryReservationManager.
     * LogisticsDispatcher listens for carrier:removed and carrier:pickupFailed events to release reservations.
     */
    interruptJob(settler: Entity, runtime: CarrierRuntimeState): void {
        const job = runtime.job!;

        // Clear carrying state if unit was carrying material
        if (settler.carrying) {
            clearCarrying(settler);
        }

        log.debug(`Carrier ${settler.id} interrupted job ${job.jobId}`);
        runtime.state = SettlerState.INTERRUPTED;
        this.animController.setIdleAnimation(settler);
    }

    // ─────────────────────────────────────────────────────────────
    // Phase dispatch
    // ─────────────────────────────────────────────────────────────

    private executePhase(settler: Entity, job: CarrierJobState, phase: CarrierPhase): TaskResult {
        switch (phase) {
        case CarrierPhase.GO_TO_SOURCE:
            return this.goToSource(settler, job);
        case CarrierPhase.PICKUP:
            return this.pickup(settler, job);
        case CarrierPhase.GO_TO_DEST:
            return this.goToDest(settler, job);
        case CarrierPhase.DROPOFF:
            return this.dropoff(settler, job);
        case CarrierPhase.GO_HOME:
            return this.goHome(settler, job);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Animation
    // ─────────────────────────────────────────────────────────────

    private applyPhaseAnimation(settler: Entity, phase: CarrierPhase): void {
        switch (phase) {
        case CarrierPhase.GO_TO_SOURCE:
        case CarrierPhase.GO_TO_DEST:
        case CarrierPhase.GO_HOME:
            // startWalkAnimation internally calls resolveTaskAnimation('walk', unit),
            // which checks entity.carrying and returns carry animation when carrying.
            this.animController.startWalkAnimation(settler, 0);
            break;
        case CarrierPhase.PICKUP:
        case CarrierPhase.DROPOFF:
            // Instant phases — no animation change needed
            break;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Movement
    // ─────────────────────────────────────────────────────────────

    private moveToPosition(settler: Entity, targetX: number, targetY: number): TaskResult {
        const { gameState } = this.choreoContext;
        const controller = gameState.movement.getController(settler.id);
        if (!controller) return TaskResult.FAILED;

        const dist = hexDistance(settler.x, settler.y, targetX, targetY);

        if (dist <= 1 && controller.state === 'idle') {
            return TaskResult.DONE;
        }

        if (controller.state === 'idle') {
            const moved = gameState.movement.moveUnit(settler.id, targetX, targetY);
            if (!moved) return TaskResult.FAILED;
        }

        return TaskResult.CONTINUE;
    }

    private goToSource(settler: Entity, job: CarrierJobState): TaskResult {
        const { sourceBuildingId, material } = job.data;
        const building = this.choreoContext.gameState.getEntityOrThrow(sourceBuildingId, 'source building');
        // Navigate to the output stack position if it exists, otherwise fall back to building door
        const stackPos = this.choreoContext.inventoryVisualizer.getStackPosition(sourceBuildingId, material, 'output');
        const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
        return this.moveToPosition(settler, stackPos?.x ?? door.x, stackPos?.y ?? door.y);
    }

    private goToDest(settler: Entity, job: CarrierJobState): TaskResult {
        const { destBuildingId, material } = job.data;
        // Navigate to the input stack position if it exists, otherwise fall back to building door
        const stackPos = this.choreoContext.inventoryVisualizer.getStackPosition(destBuildingId, material, 'input');
        const building = this.choreoContext.gameState.getEntityOrThrow(destBuildingId, 'destination building');
        const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
        return this.moveToPosition(settler, stackPos?.x ?? door.x, stackPos?.y ?? door.y);
    }

    private goHome(settler: Entity, job: CarrierJobState): TaskResult {
        const homeId = job.data.homeId;
        const building = this.choreoContext.gameState.getEntityOrThrow(homeId, 'carrier home building');
        const door = getBuildingDoorPos(building.x, building.y, building.race, building.subType as BuildingType);
        return this.moveToPosition(settler, door.x, door.y);
    }

    // ─────────────────────────────────────────────────────────────
    // Pickup / Dropoff — delegated to TransportJob
    // ─────────────────────────────────────────────────────────────

    /**
     * Pick up material from source building.
     * TransportJob handles the reservation → withdrawal atomically.
     */
    private pickup(settler: Entity, job: CarrierJobState): TaskResult {
        const { transportJob, material, sourceBuildingId, amount: requestedAmount } = job.data;

        const withdrawn = transportJob.pickup();

        if (withdrawn === 0) {
            log.warn(`Carrier ${settler.id}: pickup failed at building ${sourceBuildingId}`);

            this.choreoContext.eventBus.emit('carrier:pickupFailed', {
                entityId: settler.id,
                material,
                fromBuilding: sourceBuildingId,
                requestedAmount,
            });

            return TaskResult.FAILED;
        }

        setCarrying(settler, material, withdrawn);
        job.data.carryingGood = material;
        job.data.amount = withdrawn;

        if (withdrawn < requestedAmount) {
            log.debug(`Carrier ${settler.id} picked up ${withdrawn}/${requestedAmount} of ${material} (partial)`);
        } else {
            log.debug(`Carrier ${settler.id} picked up ${withdrawn} of ${material} from building ${sourceBuildingId}`);
        }

        this.choreoContext.eventBus.emit('carrier:pickupComplete', {
            entityId: settler.id,
            material,
            amount: withdrawn,
            fromBuilding: sourceBuildingId,
        });

        return TaskResult.DONE;
    }

    /**
     * Deposit material to destination building.
     * TransportJob handles the deposit + request fulfillment.
     */
    private dropoff(settler: Entity, job: CarrierJobState): TaskResult {
        const { transportJob, destBuildingId, material } = job.data;

        if (!settler.carrying) {
            throw new Error(
                `Carrier ${settler.id}: dropoff called but settler is not carrying anything (job: material=${material})`
            );
        }
        const amount = settler.carrying.amount;
        const deposited = transportJob.complete(amount);

        const overflow = amount - deposited;
        if (overflow > 0) {
            log.warn(`Carrier ${settler.id}: ${overflow} of ${material} overflow at building ${destBuildingId}`);
        }

        clearCarrying(settler);
        job.data.carryingGood = null;

        log.debug(`Carrier ${settler.id} delivered ${deposited} of ${material} to building ${destBuildingId}`);

        this.choreoContext.carrierManager.addFatigue(settler.id, FATIGUE_PER_DELIVERY);
        this.choreoContext.carrierManager.setStatus(settler.id, CarrierStatus.Idle);

        this.choreoContext.eventBus.emit('carrier:deliveryComplete', {
            entityId: settler.id,
            material,
            amount: deposited,
            toBuilding: destBuildingId,
            overflow,
        });

        return TaskResult.DONE;
    }
}
