/**
 * Death Angel Feature -- spawns a translucent angel entity when a unit dies in combat.
 *
 * Listens to `combat:unitDefeated`, reads the dying unit's position and race,
 * spawns an Angel entity with a one-shot idle animation, and registers it with
 * the DeathAngelSystem for timed removal after 3 seconds.
 */

import type { FeatureDefinition } from '../feature';
import { UnitType } from '../../entity';
import { xmlKey } from '../../animation/animation';
import { UNIT_XML_PREFIX } from '../../renderer/sprite-metadata';
import { DeathAngelSystem } from './death-angel-system';
import { createLogger } from '@/utilities/logger';

const log = createLogger('DeathAngelFeature');

export const DeathAngelFeature: FeatureDefinition = {
    id: 'death-angel',
    dependencies: [],

    create(ctx) {
        const system = new DeathAngelSystem({
            visualService: ctx.visualService,
            executeCommand: ctx.executeCommand,
        });

        ctx.on('combat:unitDefeated', ({ entityId }) => {
            const entity = ctx.gameState.getEntity(entityId);
            if (!entity) {
                // Entity already removed before event reached us -- nothing to do
                log.debug(`combat:unitDefeated for entity ${entityId} but entity already gone`);
                return;
            }

            // Spawn angel at the dying unit's position, inheriting player and race.
            // occupancy: false — angels are visual-only and must not block pathfinding.
            const angel = ctx.gameState.addUnit(UnitType.Angel, entity.x, entity.y, entity.player, {
                race: entity.race,
                selectable: false,
                occupancy: false,
            });

            // Start one-shot rising animation using the angel's idle XML sequence
            const prefix = UNIT_XML_PREFIX[UnitType.Angel];
            if (!prefix) throw new Error('No XML prefix for UnitType.Angel');
            ctx.visualService.play(angel.id, xmlKey(prefix, 'WALK'), { loop: false, direction: 0 });

            // Register for timed removal
            system.register(angel.id, UnitType.Angel);

            log.debug(`Spawned death angel ${angel.id} at (${entity.x}, ${entity.y}) for unit ${entityId}`);
        });

        // Clean up tracking when angel entity is removed
        ctx.cleanupRegistry.onEntityRemoved(system.unregister.bind(system));

        return {
            systems: [system],
        };
    },
};
