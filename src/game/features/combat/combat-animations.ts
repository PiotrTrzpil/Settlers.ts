/**
 * Combat visual state — manages animation playback and facing direction
 * for units in combat.
 */

import type { Entity } from '../../entity';
import { UnitType } from '../../entity';
import { getApproxDirection } from '../../systems/hex-directions';
import { xmlKey } from '../../animation/animation';
import { UNIT_XML_PREFIX } from '../../renderer/sprite-metadata';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { GameState } from '../../game-state';

export class CombatVisuals {
    constructor(
        private readonly visualService: EntityVisualService,
        private readonly gameState: GameState
    ) {}

    /** Play a looping combat animation (WALK/FIGHT/SHOOT) facing the target. */
    applyCombatAnimation(entity: Entity, target: Entity, action: 'WALK' | 'FIGHT' | 'SHOOT'): void {
        const direction = getApproxDirection(entity.x, entity.y, target.x, target.y);
        const prefix = UNIT_XML_PREFIX[entity.subType as UnitType]!;
        this.visualService.applyIntent(entity.id, {
            sequence: xmlKey(prefix, action),
            loop: true,
            stopped: false,
        });
        this.visualService.setDirection(entity.id, direction);
    }

    applyWalkAnimation(entity: Entity, target: Entity): void {
        this.applyCombatAnimation(entity, target, 'WALK');
    }

    applyShootAnimation(entity: Entity, target: Entity): void {
        this.applyCombatAnimation(entity, target, 'SHOOT');
    }

    applyFightAnimation(entity: Entity, target: Entity): void {
        this.applyCombatAnimation(entity, target, 'FIGHT');
    }

    /** Restore idle animation (stopped on frame 0 of walk). */
    applyIdleAnimation(entityId: number): void {
        const entity = this.gameState.getEntity(entityId);
        if (!entity) {
            return;
        }
        const prefix = UNIT_XML_PREFIX[entity.subType as UnitType]!;
        this.visualService.applyIntent(entityId, {
            sequence: xmlKey(prefix, 'WALK'),
            loop: false,
            stopped: true,
        });
    }

    /** Sync visual direction with the movement controller while actively walking. */
    syncDirectionWithController(entity: Entity): void {
        const controller = this.gameState.movement.getController(entity.id);
        if (controller && controller.state === 'moving') {
            const vs = this.visualService.getState(entity.id);
            if (vs?.animation && vs.animation.direction !== controller.direction) {
                this.visualService.setDirection(entity.id, controller.direction);
            }
        }
    }

    /** Keep facing the target (target may shift position). */
    updateFacingDirection(entity: Entity, target: Entity): void {
        const direction = getApproxDirection(entity.x, entity.y, target.x, target.y);
        const vs = this.visualService.getState(entity.id);
        if (vs?.animation && vs.animation.direction !== direction) {
            this.visualService.setDirection(entity.id, direction);
        }
    }
}
