/**
 * Reproduce: multiple units end up on the same tile during construction delivery.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BuildingType, EntityType, UnitType, tileKey } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { Simulation, createScenario, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';

const hasRealData = installRealGameData();

/** Check every visible unit — return violations where 2+ units share a tile. */
function findTileViolations(sim: Simulation, tick: number): string[] {
    const tileToUnit = new Map<string, { id: number; type: string }>();
    const violations: string[] = [];
    for (const e of sim.state.entities) {
        if (e.type !== EntityType.Unit) continue;
        if (e.hidden) continue;
        const key = tileKey(e.x, e.y);
        const eType = UnitType[e.subType] ?? `?${e.subType}`;
        const existing = tileToUnit.get(key);
        if (existing) {
            const occupant = sim.state.tileOccupancy.get(key);
            const occupantEntity = occupant !== undefined ? sim.state.getEntity(occupant) : undefined;
            const occupantDesc = occupantEntity
                ? `${EntityType[occupantEntity.type]}#${occupant}`
                : `none`;
            violations.push(
                `tick ${tick}: ${existing.type}#${existing.id} and ${eType}#${e.id} at (${e.x},${e.y}) occupancy=${occupantDesc}`
            );
        }
        tileToUnit.set(key, { id: e.id, type: eType });
    }
    return violations;
}

describe.skipIf(!hasRealData)('Worker entering building with door occupant', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('woodcutter entering building pushes idle unit off the door', () => {
        sim = new Simulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        const wcId = sim.placeBuilding(BuildingType.WoodcutterHut);

        // Plant trees so the woodcutter has work
        sim.plantTreesNear(wcId, 5);

        // Get the door position of the woodcutter hut
        const wcEntity = sim.state.getEntityOrThrow(wcId, 'test');
        const door = getBuildingDoorPos(wcEntity.x, wcEntity.y, wcEntity.race, BuildingType.WoodcutterHut);

        // Run until the woodcutter leaves the building (starts walking to a tree)
        let woodcutterLeft = false;
        sim.runUntil(
            () => {
                // Check if any woodcutter is visible and away from the door
                for (const e of sim.state.entities) {
                    if (e.type !== EntityType.Unit || e.subType !== UnitType.Woodcutter) continue;
                    if (e.hidden) continue;
                    if (e.x !== door.x || e.y !== door.y) {
                        woodcutterLeft = true;
                        return true;
                    }
                }
                return false;
            },
            { maxTicks: 3000, label: 'woodcutter leaves building' }
        );

        if (!woodcutterLeft) return; // skip if woodcutter never left

        // Now place an idle carrier on the door tile — the woodcutter will walk through on return
        sim.state.addUnit(UnitType.Carrier, door.x, door.y, 0);

        const violations: string[] = [];
        let tick = 0;

        // Run and watch for tile sharing violations when woodcutter returns
        sim.runUntil(
            () => {
                tick++;
                violations.push(...findTileViolations(sim, tick));
                return tick >= 5000;
            },
            { maxTicks: 5001, label: 'observation period' }
        );

        if (violations.length > 0) {
            const unique = [...new Set(violations)];
            console.log(`\n${unique.length} unique violations (${violations.length} total):`);
            for (const v of unique.slice(0, 30)) console.log(`  ${v}`);
        }
        expect(violations).toHaveLength(0);
    });
});

describe.skipIf(!hasRealData)('Tile sharing violations', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('construction with 6 carriers: no two visible units share a tile', () => {
        const s = createScenario.constructionSite(BuildingType.Sawmill, [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ]);
        sim = s;

        // Spawn extra carriers for heavy contention
        sim.spawnUnitNear(s.storageId, UnitType.Carrier, 4);

        const violations: string[] = [];
        let tick = 0;

        sim.runUntil(
            () => {
                tick++;
                violations.push(...findTileViolations(sim, tick));
                return !sim.services.constructionSiteManager.hasSite(s.siteId);
            },
            { maxTicks: 50_000, label: 'construction complete' }
        );

        if (violations.length > 0) {
            const unique = [...new Set(violations)];
            console.log(`\n${unique.length} unique violations (${violations.length} total):`);
            for (const v of unique.slice(0, 30)) console.log(`  ${v}`);
        }
        expect(violations).toHaveLength(0);
    });

    it('2 construction sites competing: no tile sharing', () => {
        sim = new Simulation();
        const residenceId = sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.spawnUnitNear(residenceId, UnitType.Digger, 2);
        sim.spawnUnitNear(residenceId, UnitType.Builder, 2);
        const storageId = sim.placeBuilding(BuildingType.StorageArea);
        sim.injectOutput(storageId, EMaterialType.BOARD, 8);
        sim.injectOutput(storageId, EMaterialType.STONE, 8);

        // Two construction sites competing for same carriers
        const site1 = sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);
        const site2 = sim.placeBuilding(BuildingType.ForesterHut, 0, false);

        // Extra carriers
        sim.spawnUnitNear(storageId, UnitType.Carrier, 4);

        const violations: string[] = [];
        let tick = 0;

        sim.runUntil(
            () => {
                tick++;
                violations.push(...findTileViolations(sim, tick));
                const s1done = !sim.services.constructionSiteManager.hasSite(site1);
                const s2done = !sim.services.constructionSiteManager.hasSite(site2);
                return s1done && s2done;
            },
            { maxTicks: 80_000, label: 'both constructions complete' }
        );

        if (violations.length > 0) {
            const unique = [...new Set(violations)];
            console.log(`\n${unique.length} unique violations (${violations.length} total):`);
            for (const v of unique.slice(0, 30)) console.log(`  ${v}`);
        }
        expect(violations).toHaveLength(0);
    });
});
