/**
 * Reproduction: territory pre-population covers entire map.
 *
 * createSimulation() calls establishTerritory(0) with Castle radius=65 on a
 * 128×128 map, covering every tile. Tests that need unclaimed territory must
 * use skipTerritory: true — the pioneer-territory and territory-consequences
 * tests were missing this option.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { UnitType } from '@/game/entity';

installRealGameData();

describe('Territory pre-population', { timeout: 10_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('default simulation covers map center — pioneer area is pre-claimed', () => {
        // Without skipTerritory, player 0 owns a large area around map center
        sim = createSimulation();
        const tm = sim.services.territoryManager;
        expect(tm.getOwner({ x: 64, y: 64 })).toBe(0);
        // (70,74) where pioneer tests spawn — already owned by player 0
        expect(tm.getOwner({ x: 70, y: 74 })).toBe(0);
    });

    it('skipTerritory leaves map unclaimed — pioneer tests require it', () => {
        sim = createSimulation({ skipTerritory: true });
        const tm = sim.services.territoryManager;

        expect(tm.getOwner({ x: 64, y: 64 })).toBe(-1);

        // Spawn pioneer without a move command — should not claim territory
        sim.spawnUnit({ x: 70, y: 74 }, UnitType.Pioneer);
        sim.runTicks(3000);

        let claimed = 0;
        for (let dy = -10; dy <= 10; dy++) {
            for (let dx = -10; dx <= 10; dx++) {
                if (tm.getOwner({ x: 70 + dx, y: 74 + dy }) === 0) {
                    claimed++;
                }
            }
        }
        expect(claimed).toBe(0);
    });
});
