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
import { SlotKind } from '@/game/features/inventory/pile-kind';

const hasRealData = installRealGameData();

describe.skipIf(!hasRealData)('Construction pile tracking (real game data)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    /** Count construction-phase StackedPile entities of a given material type for a building. */
    function countConstructionPiles(buildingId: number, material: EMaterialType): number {
        return sim.state.entities.filter(e => {
            if (e.type !== EntityType.StackedPile || e.subType !== material) return false;
            const kind = sim.state.piles.getKind(e.id);
            return kind?.kind === SlotKind.Construction && 'buildingId' in kind && kind.buildingId === buildingId;
        }).length;
    }

    /** Get total quantity of construction piles of a given material for a building. */
    function getConstructionPileQuantity(buildingId: number, material: EMaterialType): number {
        let total = 0;
        for (const e of sim.state.entities) {
            if (e.type !== EntityType.StackedPile || e.subType !== material) continue;
            const kind = sim.state.piles.getKind(e.id);
            if (kind?.kind === SlotKind.Construction && 'buildingId' in kind && kind.buildingId === buildingId) {
                total += sim.state.piles.getQuantity(e.id);
            }
        }
        return total;
    }

    it('each material delivery creates or updates pile, piles survive until completion', () => {
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ]);
        sim = s;

        // Track deliveries
        const deliveries: Array<{ material: number; toBuilding: number }> = [];
        sim.eventBus.on('carrier:deliveryComplete', e => {
            deliveries.push({ material: e.material, toBuilding: e.toBuilding });
        });

        // Track pile warnings (position resolution failures)
        const pileWarnings: string[] = [];
        const origWarn = console.warn;
        console.warn = (...args: unknown[]) => {
            const msg = args.join(' ');
            if (msg.includes('pile position') || msg.includes('staging tile')) {
                pileWarnings.push(msg);
            }
            origWarn.apply(console, args);
        };

        // Run until first BOARD delivery
        sim.runUntil(() => deliveries.some(d => d.material === EMaterialType.BOARD), {
            maxTicks: 50_000,
            label: 'first BOARD delivery',
        });

        // After first BOARD delivery: construction pile should exist
        expect(countConstructionPiles(s.siteId, EMaterialType.BOARD)).toBe(1);
        expect(getConstructionPileQuantity(s.siteId, EMaterialType.BOARD)).toBe(1);

        // Continue until first STONE delivery
        sim.runUntil(() => deliveries.some(d => d.material === EMaterialType.STONE), {
            maxTicks: 50_000,
            label: 'first STONE delivery',
        });

        // After first STONE delivery: STONE pile should exist (may have more than 1 if concurrent)
        expect(countConstructionPiles(s.siteId, EMaterialType.STONE)).toBe(1);
        expect(getConstructionPileQuantity(s.siteId, EMaterialType.STONE)).toBeGreaterThanOrEqual(1);

        // BOARD pile should still exist
        expect(countConstructionPiles(s.siteId, EMaterialType.BOARD)).toBe(1);

        // Run until second BOARD delivery
        const boardDeliveryCount = () => deliveries.filter(d => d.material === EMaterialType.BOARD).length;
        sim.runUntil(() => boardDeliveryCount() >= 2, {
            maxTicks: 50_000,
            label: 'second BOARD delivery',
        });

        // After second BOARD delivery: pile quantity should match inventory input
        const boardInput = sim.services.inventoryManager.getInputAmount(s.siteId, EMaterialType.BOARD);
        expect(boardInput).toBe(2);
        expect(getConstructionPileQuantity(s.siteId, EMaterialType.BOARD)).toBe(2);

        // Wait for construction to complete
        sim.waitForConstructionComplete(s.siteId);

        // After construction: all construction piles should be removed
        expect(countConstructionPiles(s.siteId, EMaterialType.BOARD)).toBe(0);
        expect(countConstructionPiles(s.siteId, EMaterialType.STONE)).toBe(0);

        // Restore console.warn
        console.warn = origWarn;

        // No pile position warnings
        if (pileWarnings.length > 0) {
            console.log('Pile warnings:', pileWarnings);
        }
        expect(pileWarnings).toHaveLength(0);

        expect(sim.errors).toHaveLength(0);
    });
});
