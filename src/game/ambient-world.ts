/**
 * Answers AmbientSounds' questions about the world: terrain, trees and noisy buildings
 * near the camera. Kept out of the audio module so audio stays free of game-state imports.
 */

import { EntityType } from './entity';
import { BuildingType } from './buildings/building-type';
import { MapObjectCategory, type MapObjectType } from './types/map-object-types';
import { OBJECT_TYPE_CATEGORY } from './systems/map-objects';
import type { GameState } from './game-state';
import type { TerrainData } from './terrain';
import type { AmbientPoint, AmbientSoundsDeps } from './audio/ambient-sounds';

const NOISY_BUILDINGS: Partial<Record<BuildingType, AmbientPoint['source']>> = {
    [BuildingType.AnimalRanch]: 'pigs',
    [BuildingType.DonkeyRanch]: 'donkeys',
    [BuildingType.BeekeeperHut]: 'bees',
};

export interface AmbientWorldContext {
    state: GameState;
    terrain: TerrainData;
    /** True while a building is still a construction site */
    isUnderConstruction(buildingId: number): boolean;
}

export function createAmbientWorld(ctx: AmbientWorldContext): Omit<AmbientSoundsDeps, 'play'> {
    const { state, terrain } = ctx;
    return {
        groundTypeAt: (x, y) =>
            terrain.isInBounds({ x, y }) ? terrain.groundType[terrain.mapSize.toIndex({ x, y })]! : null,

        hasTreeNear: (x, y, radius) => {
            for (const e of state.spatialIndex.nearby({ x, y }, radius)) {
                if (
                    e.type === EntityType.MapObject &&
                    OBJECT_TYPE_CATEGORY[e.subType as MapObjectType] === MapObjectCategory.Trees
                ) {
                    return true;
                }
            }
            return false;
        },

        noisyBuildingsNear: listener => {
            const points: AmbientPoint[] = [];
            for (const b of state.entityIndex
                .query(EntityType.Building)
                .inRadius(listener, listener.radius)
                .toArray()) {
                const source = NOISY_BUILDINGS[b.subType as BuildingType];
                if (source && !ctx.isUnderConstruction(b.id)) {
                    points.push({ x: b.x, y: b.y, source });
                }
            }
            return points;
        },
    };
}
