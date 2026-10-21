/**
 * UnitVisualSync — keeps a unit's sprite in step with its movement controller.
 *
 * Facing direction, the walk cycle while moving (any path start, whoever issued it),
 * freezing walk frames while blocked, and idle turning / idle pose for units without a
 * job. Job and dispatch code never touches walk animation — it only issues movement.
 */

import type { Entity } from '../../entity';
import { EntityType, getEntityIfType } from '../../entity';
import type { GameState } from '../../game-state';
import { EventSubscriptionManager, type EventBus } from '../../event-bus';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { IdleAnimationController } from './idle-animation-controller';
import type { UnitRuntime } from './unit-runtime';

export class UnitVisualSync {
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(
        private readonly gameState: GameState,
        private readonly visualService: EntityVisualService,
        private readonly animController: IdleAnimationController
    ) {}

    /** Walk animation follows movement — start it as soon as any path starts. */
    registerEvents(eventBus: EventBus): void {
        this.subscriptions.subscribe(eventBus, 'unit:movementStarted', ({ unitId }) => {
            const unit = getEntityIfType(this.gameState, unitId, EntityType.Unit);
            if (unit) {
                this.animController.ensureWalkAnimation(unit);
            }
        });
    }

    destroy(): void {
        this.subscriptions.unsubscribeAll();
    }

    /**
     * Sync visuals from the movement controller: facing direction, walk cycle while moving,
     * and freeze/unfreeze when blocked on an occupied tile.
     */
    syncWithMovement(unit: Entity, runtime: UnitRuntime): void {
        const controller = this.gameState.movement.getController(unit.id);
        if (!controller) {
            return;
        }

        const currentDirection = controller.direction;
        if (currentDirection !== runtime.lastDirection) {
            // Only set direction if entity has an active animation
            const vs = this.visualService.getState(unit.id);
            if (vs?.animation) {
                this.visualService.setDirection(unit.id, currentDirection);
            }
            runtime.lastDirection = currentDirection;
        }

        // Movement state drives walk animation for every unit (jobs, move tasks, pushes).
        if (controller.state === 'moving') {
            this.animController.ensureWalkAnimation(unit);
        }

        // Freeze walk frames while blocked; resume when the tile frees up.
        const vs = this.visualService.getState(unit.id);
        if (vs?.animation && controller.state === 'moving') {
            if (controller.isWaiting) {
                vs.animation.playing = false;
            } else if (!vs.animation.playing) {
                vs.animation.playing = true;
            }
        }
    }

    /** Idle behaviour of a unit without a job: walk cycle when pushed, otherwise idle pose + random turning. */
    updateIdle(unit: Entity, runtime: UnitRuntime, dt: number): void {
        const controller = this.gameState.movement.getController(unit.id);
        this.animController.updateIdleUnit(unit, runtime.idleState, dt, controller?.state);
    }
}
