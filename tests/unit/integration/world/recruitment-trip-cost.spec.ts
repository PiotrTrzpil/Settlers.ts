/**
 * Reproduction: recruitment selects wrong carrier.
 *
 * BuildingDemandSystem passes { target } to dispatchRecruitment, which should
 * minimize carrier→tool + tool→target trip cost. Previously, buildings placed
 * outside territory caused the territory filter to reject ALL carriers, so
 * recruitment silently failed. Now placement outside territory is rejected.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/core/race';

installRealGameData();

describe('Recruitment trip cost optimization', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('selects carrier with lower total trip cost, not first found', () => {
        sim = createSimulation();

        // All coordinates within Castle territory (center 64,64, radius ~32 tiles)
        //   carrierA at (50,64): far from tool, close to building
        //   carrierB at (80,64): close to tool, far from building
        //   tool at (82,64), building at (40,64)
        //
        // Trip costs (carrier→tool² + tool→target²):
        //   carrierA: (50-82)²=1024 + (82-40)²=1764 = 2788
        //   carrierB: (80-82)²=4   + (82-40)²=1764 = 1768  ← should win
        const carrierA = sim.spawnUnit({ x: 50, y: 64 }, UnitType.Carrier);
        const carrierB = sim.spawnUnit({ x: 80, y: 64 }, UnitType.Carrier);
        sim.placeGoodsAt({ x: 82, y: 64 }, EMaterialType.AXE, 1);

        sim.placeBuildingAt(40, 64, BuildingType.WoodcutterHut, 0, true, Race.Roman, false);

        sim.runUntil(() => sim.countEntities(EntityType.Unit, UnitType.Woodcutter) === 1, {
            maxTicks: 30_000,
            label: 'Woodcutter recruited',
        });

        const entityA = sim.state.getEntity(carrierA);
        const entityB = sim.state.getEntity(carrierB);
        expect(entityA?.subType).toBe(UnitType.Carrier);
        expect(entityB?.subType).toBe(UnitType.Woodcutter);
        expect(sim.errors).toHaveLength(0);
    });

    it('rejects building placement outside territory', () => {
        sim = createSimulation();

        // (20,64) is outside Castle territory at (64,64)
        const result = sim.execute({
            type: 'place_building',
            buildingType: BuildingType.WoodcutterHut,
            x: 20,
            y: 64,
            player: 0,
            race: Race.Roman,
            completed: true,
            spawnWorker: false,
        });

        expect(result.success).toBe(false);
    });
});
