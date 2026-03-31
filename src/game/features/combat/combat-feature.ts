/**
 * Combat Feature — self-registering feature that tracks military units and runs combat.
 *
 * Registers military units on spawn, cleans up on removal, and provides the
 * CombatSystem as a tick system for the game loop.
 */

import type { FeatureDefinition } from '../feature';
import { EntityType, isUnitTypeMilitary, UnitType } from '../../entity';
import { xmlKey } from '../../animation/animation';
import { UNIT_XML_PREFIX } from '../../renderer/sprite-metadata';
import { CombatSystem } from './combat-system';
import { DeathAngelSystem } from './death-angel-system';
import { createLogger } from '@/utilities/logger';

const log = createLogger('CombatFeature');

export interface CombatExports {
    combatSystem: CombatSystem;
}

export const CombatFeature: FeatureDefinition = {
    id: 'combat',
    dependencies: [],

    create(ctx) {
        const combatSystem = new CombatSystem({
            gameState: ctx.gameState,
            eventBus: ctx.eventBus,
            visualService: ctx.visualService,
            executeCommand: ctx.executeCommand,
            isUnitReserved: id => ctx.unitReservation.isReserved(id),
        });

        // Auto-register military units when they spawn
        ctx.on('unit:spawned', ({ unitId, unitType, player }) => {
            if (isUnitTypeMilitary(unitType)) {
                combatSystem.register(unitId, player, unitType);
            }
        });

        // Also catch units created via entity:created (e.g., map loading)
        ctx.on('entity:created', ({ entityId, entityType: type, subType, player }) => {
            if (type === EntityType.Unit && isUnitTypeMilitary(subType as UnitType)) {
                combatSystem.register(entityId, player, subType as UnitType);
            }
        });

        // Clean up on removal
        ctx.cleanupRegistry.onEntityRemoved(combatSystem.unregister.bind(combatSystem));

        // ── Death Angel (visual effect on unit death) ──────────────────────
        const deathAngelSystem = new DeathAngelSystem({
            executeCommand: ctx.executeCommand,
        });

        ctx.on('combat:unitDefeated', ({ unitId }) => {
            const entity = ctx.gameState.getEntityOrThrow(unitId, 'defeated unit for death angel spawn');

            const angel = ctx.gameState.addUnit(UnitType.Angel, entity.x, entity.y, entity.player, {
                race: entity.race,
                selectable: false,
                occupancy: false,
            });

            const prefix = UNIT_XML_PREFIX[UnitType.Angel];
            if (!prefix) {
                throw new Error('No XML prefix for UnitType.Angel');
            }
            ctx.visualService.play(angel.id, xmlKey(prefix, 'WALK'), {
                loop: false,
                direction: 0,
                hideOnComplete: true,
            });

            deathAngelSystem.register(angel.id);
            log.debug(`Spawned death angel ${angel.id} at (${entity.x}, ${entity.y}) for unit ${unitId}`);
        });

        ctx.cleanupRegistry.onEntityRemoved(deathAngelSystem.unregister.bind(deathAngelSystem));

        return {
            systems: [combatSystem, deathAngelSystem],
            exports: { combatSystem } satisfies CombatExports,
            persistence: [],
        };
    },
};
