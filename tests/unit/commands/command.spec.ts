import { describe, it, expect, beforeEach } from 'vitest';
import {
    BuildingConstructionPhase,
    captureOriginalTerrain,
    applyTerrainLeveling,
    CONSTRUCTION_SITE_GROUND_TYPE,
} from '@/game/features/building-construction';
import { BuildingType, EntityType } from '@/game/entity';
import { Race } from '@/game/core/race';
import { TERRAIN, setTerrainAt, blockColumn } from '../helpers/test-map';
import { Simulation } from '../helpers/test-simulation';

// Note: Happy-path command tests (place_building, spawn_unit, select, deselect,
// area select, remove entity) are covered by flow integration tests in flows/.
// This file focuses on error/edge cases only.

describe('Command System – edge cases', () => {
    let sim: Simulation;

    beforeEach(() => {
        sim = new Simulation({ useStubData: true, mapWidth: 64, mapHeight: 64 });
    });

    describe('place_building', () => {
        it('should reject building on water', () => {
            setTerrainAt(sim.map, 10, 10, TERRAIN.WATER);
            const result = sim.execute({
                type: 'place_building',
                buildingType: 1,
                x: 10,
                y: 10,
                player: 0,
                race: 10,
            });

            expect(result.success).toBe(false);
            expect(sim.state.entities).toHaveLength(0);
        });
    });

    describe('move_unit', () => {
        it('should fail for non-existent unit', () => {
            const result = sim.execute({
                type: 'move_unit',
                entityId: 999,
                targetX: 10,
                targetY: 5,
            });
            expect(result.success).toBe(false);
        });

        it('should fail when no path exists', () => {
            sim.execute({
                type: 'spawn_unit',
                unitType: 0,
                x: 5,
                y: 5,
                player: 0,
                race: 10,
            });

            blockColumn(sim.map, 15);

            const result = sim.execute({
                type: 'move_unit',
                entityId: sim.state.entities[0]!.id,
                targetX: 20,
                targetY: 5,
            });
            expect(result.success).toBe(false);
        });
    });

    // select_area happy paths (including units-over-buildings priority)
    // are covered in unit-placement-selection-movement.spec.ts.

    describe('remove_entity', () => {
        it('should fail for non-existent entity', () => {
            const result = sim.execute({
                type: 'remove_entity',
                entityId: 999,
            });
            expect(result.success).toBe(false);
        });

        it('should restore terrain when removing a building with modified terrain', () => {
            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = sim.map.mapSize.toIndex(10 + dx, 10 + dy);
                    sim.map.groundHeight[idx] = 100 + dy * 5;
                }
            }

            const originalGroundType = new Uint8Array(sim.map.groundType);
            const originalGroundHeight = new Uint8Array(sim.map.groundHeight);

            const building = sim.state.addEntity(EntityType.Building, BuildingType.WoodcutterHut, 10, 10, 1, {
                race: Race.Roman,
            });
            const csm = sim.services.constructionSiteManager;
            csm.registerSite(building.id, BuildingType.WoodcutterHut, Race.Roman, 1, 10, 10);
            const site = csm.getSiteOrThrow(building.id, 'test terrain restore');
            const terrainParams = {
                buildingType: site.buildingType,
                race: site.race,
                tileX: site.tileX,
                tileY: site.tileY,
            };

            site.terrain.originalTerrain = captureOriginalTerrain(
                terrainParams,
                sim.map.groundType,
                sim.map.groundHeight,
                sim.map.mapSize
            );
            site.terrain.modified = true;
            site.phase = BuildingConstructionPhase.TerrainLeveling;
            applyTerrainLeveling(
                terrainParams,
                sim.map.groundType,
                sim.map.groundHeight,
                sim.map.mapSize,
                1.0,
                site.terrain.originalTerrain
            );

            expect(sim.map.groundType[sim.map.mapSize.toIndex(10, 10)]).toBe(CONSTRUCTION_SITE_GROUND_TYPE);

            sim.execute({
                type: 'remove_entity',
                entityId: building.id,
            });

            for (let dy = -1; dy <= 2; dy++) {
                for (let dx = -1; dx <= 2; dx++) {
                    const idx = sim.map.mapSize.toIndex(10 + dx, 10 + dy);
                    expect(sim.map.groundType[idx]).toBe(originalGroundType[idx]);
                    expect(sim.map.groundHeight[idx]).toBe(originalGroundHeight[idx]);
                }
            }
        });
    });
});
