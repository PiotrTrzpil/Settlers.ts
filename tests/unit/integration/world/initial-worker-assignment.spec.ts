/**
 * Integration tests for post-map-load worker assignment.
 *
 * Uses the real map-load pipeline (populateMapBuildings + populateMapSettlers +
 * assignInitialBuildingWorkers) via Simulation.populateMapData to verify that
 * workers placed inside their matching building's footprint are automatically
 * assigned and hidden.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { EntityType, UnitType } from '@/game/entity';
import { BuildingType, getBuildingFootprint } from '@/game/buildings';
import { Race } from '@/game/core/race';
import { S4BuildingType, S4SettlerType } from '@/resources/map/s4-types';
import { SettlerBuildingStatus } from '@/game/features/settler-location/types';

installRealGameData();

afterEach(() => cleanupSimulation());

describe('initial building worker assignment (map load)', () => {
    it('assigns a woodcutter inside its hut via map data', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        // Load building first, then settler on a footprint tile (mirrors real map load order)
        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 0 }]
        );

        // Find the created entities
        const building = sim.state.entities.find(
            e => e.type === EntityType.Building && e.subType === BuildingType.WoodcutterHut
        )!;
        const unit = sim.state.entities.find(e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter)!;
        expect(building).toBeDefined();
        expect(unit).toBeDefined();

        // Worker should be assigned to the building
        expect(sim.services.settlerTaskSystem.getAssignedBuilding(unit.id)).toBe(building.id);

        // Worker should be hidden (inside building)
        expect(unit.hidden).toBe(true);

        // Location manager should show Inside status
        const location = sim.services.locationManager.getLocation(unit.id);
        expect(location).not.toBeNull();
        expect(location!.buildingId).toBe(building.id);
        expect(location!.status).toBe(SettlerBuildingStatus.Inside);

        sim.destroy();
    });

    it('assigns a stonecutter inside its hut via map data', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.STONECUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.STONECUTTER, player: 0 }]
        );

        const building = sim.state.entities.find(
            e => e.type === EntityType.Building && e.subType === BuildingType.StonecutterHut
        )!;
        const unit = sim.state.entities.find(e => e.type === EntityType.Unit && e.subType === UnitType.Stonecutter)!;

        expect(sim.services.settlerTaskSystem.getAssignedBuilding(unit.id)).toBe(building.id);
        expect(unit.hidden).toBe(true);

        sim.destroy();
    });

    it('does NOT assign a carrier placed inside a woodcutter hut', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.CARRIER, player: 0 }]
        );

        const unit = sim.state.entities.find(e => e.type === EntityType.Unit && e.subType === UnitType.Carrier)!;

        // Carrier has no workplace — should not be assigned
        expect(sim.services.settlerTaskSystem.getAssignedBuilding(unit.id)).toBeNull();
        expect(unit.hidden).not.toBe(true);

        sim.destroy();
    });

    it('does NOT assign a woodcutter to a mismatched building (sawmill)', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.SAWMILL, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 0 }]
        );

        const unit = sim.state.entities.find(e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter)!;

        // Woodcutter works in WoodcutterHut, not Sawmill
        expect(sim.services.settlerTaskSystem.getAssignedBuilding(unit.id)).toBeNull();

        sim.destroy();
    });

    it('does NOT assign enemy player units to buildings', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            // Woodcutter belongs to player 1, building to player 0
            [{ x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 1 }]
        );

        const unit = sim.state.entities.find(e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter)!;

        expect(sim.services.settlerTaskSystem.getAssignedBuilding(unit.id)).toBeNull();

        sim.destroy();
    });

    it('respects building occupancy limits (max 1 worker)', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        // Get footprint to find a second tile for the second worker
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

        // Only one should be assigned (default max occupants is 1)
        const assigned = units.filter(u => sim.services.settlerTaskSystem.getAssignedBuilding(u.id) !== null);
        expect(assigned.length).toBe(1);

        sim.destroy();
    });

    it('map building does not auto-spawn a worker (no duplicate)', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 0 }]
        );

        // Should have exactly 1 woodcutter (from map data), not 2 (no auto-spawn)
        const woodcutters = sim.state.entities.filter(
            e => e.type === EntityType.Unit && e.subType === UnitType.Woodcutter
        );
        expect(woodcutters.length).toBe(1);

        sim.destroy();
    });

    it('assigned worker can tick without errors', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 0 }]
        );

        // Tick a few frames — verify no errors
        sim.runTicks(30);
        expect(sim.errors.length).toBe(0);

        sim.destroy();
    });

    it('worker completes a full work cycle without pathfinding failures', () => {
        const sim = createSimulation();
        const cx = sim.mapWidth >> 1;
        const cy = sim.mapHeight >> 1;

        sim.populateMapData(
            [{ x: cx, y: cy, buildingType: S4BuildingType.WOODCUTTERHUT, player: 0 }],
            [{ x: cx, y: cy, settlerType: S4SettlerType.WOODCUTTER, player: 0 }]
        );

        const building = sim.state.entities.find(
            e => e.type === EntityType.Building && e.subType === BuildingType.WoodcutterHut
        )!;

        // Place trees nearby so the woodcutter has work to do
        sim.plantTreesNear(building.id, 5);

        // Collect pathfinding failures with full diagnostics
        const pathFailures: {
            unitId: number;
            from: string;
            to: string;
            startPassable: boolean;
            goalPassable: boolean;
            startInBuilding: boolean;
            goalInBuilding: boolean;
            nodesSearched: number;
            exhausted: boolean;
            neighborInfo: string;
        }[] = [];
        sim.eventBus.on('movement:pathFailed', evt => {
            pathFailures.push({
                unitId: evt.unitId,
                from: `${evt.fromX},${evt.fromY}`,
                to: `${evt.toX},${evt.toY}`,
                startPassable: evt.startPassable,
                goalPassable: evt.goalPassable,
                startInBuilding: evt.startInBuilding,
                goalInBuilding: evt.goalInBuilding,
                nodesSearched: evt.nodesSearched,
                exhausted: evt.exhausted,
                neighborInfo: evt.neighborInfo,
            });
        });

        // Run enough ticks for a full work cycle: exit building → walk to tree → cut → return home
        sim.runTicks(600);

        expect(sim.errors.length).toBe(0);
        expect(pathFailures).toEqual([]);
    });
});
