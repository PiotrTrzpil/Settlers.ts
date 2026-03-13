/**
 * Integration tests for post-map-load unit relocation.
 *
 * Uses the real map-load pipeline (populateMapBuildings + populateMapSettlers +
 * relocateUnitsFromFootprints) via Simulation.populateMapData to verify that
 * units placed inside building footprints are moved to passable tiles so they
 * can pathfind normally.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EntityType, UnitType } from '@/game/entity';
import { BuildingType, getBuildingFootprint } from '@/game/buildings';
import { Race } from '@/game/core/race';
import { S4BuildingType, S4SettlerType } from '@/resources/map/s4-types';

installRealGameData();

afterEach(() => cleanupSimulation());

describe('initial unit relocation from footprints (map load)', () => {
    it('relocates a woodcutter from building anchor to outside the footprint', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 0 }]
        );

        const unit = sim.state.entities.find(e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter)!;

        // Unit should not be on any building footprint tile
        const groundEntity = sim.state.getGroundEntityAt(unit.x, unit.y);
        expect(groundEntity?.type).not.toBe(EntityType.Building);

        sim.destroy();
    });

    it('relocates a carrier from building footprint', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.CARRIER, player: 0 }]
        );

        const carrier = sim.state.entities.find(e => e.type === EntityType.Unit && e.subType === UnitType.Carrier)!;

        const groundEntity = sim.state.getGroundEntityAt(carrier.x, carrier.y);
        expect(groundEntity?.type).not.toBe(EntityType.Building);

        sim.destroy();
    });

    it('places multiple units on separate non-building tiles', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        const footprint = getBuildingFootprint(cx, cy, BuildingType.WoodcutterHut, Race.Roman);
        const tile2 = footprint.length > 1 ? footprint[1]! : footprint[0]!;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [
                { x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 0 },
                { x: tile2.x, y: tile2.y, settlerType: S4SettlerType.WOODCUTTER, player: 0 },
            ]
        );

        const units = sim.state.entities.filter(e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter);
        expect(units.length).toBe(2);

        // Units should be on different tiles
        const positions = units.map(u => `${u.x},${u.y}`);
        expect(new Set(positions).size).toBe(2);

        // Neither should be on a building footprint tile
        for (const unit of units) {
            const groundEntity = sim.state.getGroundEntityAt(unit.x, unit.y);
            expect(groundEntity?.type, `unit ${unit.id} at ${unit.x},${unit.y} is still on a building`).not.toBe(
                EntityType.Building
            );
        }

        sim.destroy();
    });

    it('relocated unit can pathfind after footprints are blocked', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.CARRIER, player: 0 }]
        );

        const pathFailures: unknown[] = [];
        sim.eventBus.on('movement:pathFailed', evt => pathFailures.push(evt));
        sim.runTicks(60);

        expect(sim.errors.length).toBe(0);
        expect(pathFailures).toEqual([]);

        sim.destroy();
    });
});
