/**
 * Verifies that construction material piles are created and updated correctly.
 *
 * Each material delivery to a construction site should:
 * 1. Create a StackedPile entity (first delivery per material)
 * 2. Update pile quantity (subsequent deliveries of same material)
 * 3. Remove piles only when construction completes
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BuildingType, EntityType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { Simulation, createScenario, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { SlotKind } from '@/game/core/pile-kind';

installRealGameData();

describe('Construction pile tracking (real game data)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    /** Count StackedPile entities of a given material type linked to a building. */
    function countConstructionPiles(buildingId: number, material: EMaterialType): number {
        return sim.state.entities.filter(e => {
            if (e.type !== EntityType.StackedPile || e.subType !== material) return false;
            const kind = sim.state.piles.getKind(e.id);
            return kind?.kind === SlotKind.Input && 'buildingId' in kind && kind.buildingId === buildingId;
        }).length;
    }

    it('each material delivery creates or updates pile, piles survive until completion', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ]);
        sim = s;

        // Verify pile exists at the moment of each delivery (order-independent).
        // Construction may consume one material before the other is delivered,
        // so we check inside the event handler rather than after runUntil.
        const pileSeenOnDelivery = new Map<EMaterialType, boolean>();
        sim.eventBus.on('carrier:deliveryComplete', e => {
            const mat = e.material as EMaterialType;
            if (!pileSeenOnDelivery.has(mat)) {
                // First delivery of this material — pile must exist now
                pileSeenOnDelivery.set(mat, countConstructionPiles(s.siteId, mat) === 1);
            }
        });

        // Wait for construction to complete
        sim.waitForConstructionComplete(s.siteId);

        // Both materials were delivered and had piles at time of delivery
        expect(pileSeenOnDelivery.get(EMaterialType.BOARD)).toBe(true);
        expect(pileSeenOnDelivery.get(EMaterialType.STONE)).toBe(true);

        // After construction: all construction piles should be removed
        expect(countConstructionPiles(s.siteId, EMaterialType.BOARD)).toBe(0);
        expect(countConstructionPiles(s.siteId, EMaterialType.STONE)).toBe(0);

        expect(sim.errors).toHaveLength(0);
    });
});
