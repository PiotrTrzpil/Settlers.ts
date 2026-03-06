import type { FeatureDefinition, FeatureContext } from '../feature';
import { MovementSystem } from '../../systems/movement';
import { EntityType, UnitType, getUnitTypeSpeed } from '../../entity';
import { BuildingType } from '../../buildings/building-type';
import { setEntityDescriber } from '../../systems/pathfinding/astar';
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
            rng: gameState.rng,
            updatePosition: (id, x, y) => {
                gameState.updateEntityPosition(id, x, y);
                return true;
            },
            getEntity: gameState.getEntity.bind(gameState),
            tileOccupancy: gameState.tileOccupancy,
            buildingOccupancy: gameState.buildingOccupancy,
        });
        gameState.initMovement(movement);

        setEntityDescriber(id => {
            const e = gameState.getEntity(id);
            if (!e) return '?';
            if (e.type === EntityType.Unit) return UnitType[e.subType] ?? 'Unit#' + e.subType;
            if (e.type === EntityType.Building) return BuildingType[e.subType] ?? 'Building#' + e.subType;
            return EntityType[e.type] || 'Entity';
        });

        // Create movement controllers for units on spawn
        ctx.on('entity:created', ({ entityId, type, subType, x, y }) => {
            if (type === EntityType.Unit) {
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
