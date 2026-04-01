/**
 * Combat visual state — manages animation playback and facing direction
 * for units in combat.
 *
 * Direction rule: all direction changes go through MovementController.setDirection()
 * first (source of truth), then to visualService for immediate visual update.
 * Combat units are skipped by the per-tick sync in UnitStateMachine, so this
 * class handles its own visual propagation.
 *
 * Stationary enforcement: engageFight() and engageShoot() halt the unit's
 * movement before playing the animation. There is no public API to play a
 * fight/shoot animation without halting first — this is structural, not
 * a convention.
 */

import type { Entity } from '../../entity';
import { UnitType } from '../../entity';
import { getDirectionToward, type EDirection } from '../../systems/hex-directions';
import { xmlKey } from '../../animation/animation';
import { UNIT_XML_PREFIX } from '../../renderer/sprite-metadata';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { GameState } from '../../game-state';

export class CombatVisuals {
    constructor(
        private readonly visualService: EntityVisualService,
        private readonly gameState: GameState
    ) {}

    /**
     * Halt movement, then play melee fight animation facing the target.
     * The unit is guaranteed stationary when the animation starts.
     */
    engageFight(entity: Entity, target: Entity): void {
        this.haltUnit(entity.id);
        this.applyCombatAnimation(entity, target, 'FIGHT');
    }

    /**
     * Halt movement, then play ranged shoot animation facing the target.
     * The unit is guaranteed stationary when the animation starts.
     */
    engageShoot(entity: Entity, target: Entity): void {
        this.haltUnit(entity.id);
        this.applyCombatAnimation(entity, target, 'SHOOT');
    }

    /** Play walk (pursuit) animation facing the target. Movement is expected. */
    applyWalkAnimation(entity: Entity, target: Entity): void {
        this.applyCombatAnimation(entity, target, 'WALK');
    }

    /** Restore idle animation (stopped on frame 0 of walk). */
    applyIdleAnimation(entityId: number): void {
        const entity = this.gameState.getEntityOrThrow(entityId, 'CombatVisuals.applyIdleAnimation');
        const prefix = UNIT_XML_PREFIX[entity.subType as UnitType]!;
        this.visualService.applyIntent(entityId, {
            sequence: xmlKey(prefix, 'WALK'),
            loop: false,
            stopped: true,
        });
    }

    /** Sync visual direction with the movement controller while actively walking. */
    syncDirectionWithController(entity: Entity): void {
        const controller = this.gameState.movement.getController(entity.id)!;
        if (controller.state !== 'moving') {
            return;
        }
        const vs = this.visualService.getState(entity.id)!;
        if (vs.animation!.direction !== controller.direction) {
            this.visualService.setDirection(entity.id, controller.direction);
        }
    }

    /** Keep facing the target (target may shift position). Only for stationary units. */
    updateFacingDirection(entity: Entity, target: Entity): void {
        const direction = getDirectionToward(entity.x, entity.y, target.x, target.y);
        const vs = this.visualService.getState(entity.id)!;
        if (vs.animation!.direction !== direction) {
            this.setDirection(entity.id, direction);
        }
    }

    // ── Private ──────────────────────────────────────────────────────────

    /** Halt the unit: clear path and snap to current tile. */
    private haltUnit(entityId: number): void {
        const controller = this.gameState.movement.getController(entityId)!;
        if (controller.state !== 'idle') {
            controller.clearPath();
        }
        if (controller.isInTransit) {
            controller.haltProgress();
        }
    }

    /** Play a combat animation facing the target. */
    private applyCombatAnimation(entity: Entity, target: Entity, action: 'WALK' | 'FIGHT' | 'SHOOT'): void {
        const direction = getDirectionToward(entity.x, entity.y, target.x, target.y);
        const prefix = UNIT_XML_PREFIX[entity.subType as UnitType]!;
        this.visualService.applyIntent(entity.id, {
            sequence: xmlKey(prefix, action),
            loop: true,
            stopped: false,
        });
        this.setDirection(entity.id, direction);
    }

    /**
     * Set direction on both controller (source of truth) and visual service.
     * Combat units are skipped by the per-tick sync, so we propagate directly.
     */
    private setDirection(entityId: number, direction: number): void {
        this.gameState.movement.getController(entityId)!.setDirection(direction as EDirection);
        this.visualService.setDirection(entityId, direction);
    }
}
