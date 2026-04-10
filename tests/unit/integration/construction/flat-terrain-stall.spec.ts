/**
 * Reproduction: construction stalls on flat terrain.
 *
 * On flat test maps, populateUnleveledTiles() fires levelingComplete immediately.
 * The demand system's onLevelingComplete checks hasAvailableMaterials (input slots)
 * which are empty — carriers haven't delivered yet — and deletes all demands.
 * Pre-spawned workers never get assigned; construction never completes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EntityType, UnitType } from '@/game/entity';

installRealGameData();

describe('Construction on flat terrain', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('completes when terrain is already flat (no leveling needed)', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut);
        sim = s;

        // Flat terrain → leveling completes instantly during placement
        const site = sim.services.constructionSiteManager.getSite(s.siteId)!;
        expect(site.terrain.complete).toBe(true);

        // Construction must still complete — carriers deliver, builders build
        sim.waitForConstructionComplete(s.siteId, 80_000);

        expect(sim.services.constructionSiteManager.hasSite(s.siteId)).toBe(false);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
        expect(sim.errors).toHaveLength(0);
    });
});
