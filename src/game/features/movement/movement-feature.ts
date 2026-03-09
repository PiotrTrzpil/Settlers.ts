import type { FeatureDefinition, FeatureContext } from '../feature';
import { MovementSystem } from '../../systems/movement';
import { EntityType, UnitType, getUnitTypeSpeed } from '../../entity';
import { isAngelUnitType } from '../../core/unit-types';
import type { TerrainData } from '../../terrain';

export interface MovementExports {
    movement: MovementSystem;
}

export const MovementFeature: FeatureDefinition = {
    id: 'movement',

    create(ctx: FeatureContext) {
        const { gameState } = ctx;

        const movement = new MovementSystem({
            eventBus: ctx.eventBus,
            updatePosition: (id, x, y) => {
                gameState.updateEntityPosition(id, x, y);
                return true;
            },
            getEntity: gameState.getEntity.bind(gameState),
            tileOccupancy: gameState.tileOccupancy,
            buildingOccupancy: gameState.buildingOccupancy,
            buildingFootprint: gameState.buildingFootprint,
        });
        gameState.initMovement(movement);

        // Create movement controllers for units on spawn (skip ephemeral angels)
        ctx.on('entity:created', ({ entityId, type, subType, x, y }) => {
            if (type === EntityType.Unit && !isAngelUnitType(subType as UnitType)) {
                const speed = getUnitTypeSpeed(subType as UnitType);
                movement.createController(entityId, x, y, speed);
            }
        });

        // Remove movement controllers on entity removal
        ctx.cleanupRegistry.onEntityRemoved(entityId => {
            movement.removeController(entityId);
        });

        const exports: MovementExports = { movement };

        return {
            systems: [movement],
            systemGroup: 'Units',
            exports,
            onTerrainReady(terrain: TerrainData) {
                movement.setTerrainData(terrain.groundType, terrain.groundHeight, terrain.width, terrain.height);
            },
        };
    },
};
