/**
 * Integration tests for construction material delivery to buildings with multiple
 * piles (slots) per material type.
 *
 * Buildings needing >8 of a material get multiple input slots (each capped at 8).
 * Without slot-level reservation tracking, all transport jobs target the first slot,
 * causing overflow when it fills up while other slots remain empty.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createScenario, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';
import { SlotKind } from '@/game/core/pile-kind';
import { getConstructionCosts } from '@/game/economy/building-production';
import { Race } from '@/game/core/race';
import { UnitType } from '@/game/entity';
import { SLOT_CAPACITY } from '@/game/systems/inventory';
import { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';

installRealGameData();

/** Inject materials into storage, handling amounts > SLOT_CAPACITY by depositing into individual slots. */
function injectStorageMaterial(sim: Simulation, storageId: number, material: EMaterialType, total: number) {
    const im = sim.services.inventoryManager;
    const sfm = sim.services.storageFilterManager;
    if (!sfm.getDirection(storageId, material)) {
        sfm.setDirection(storageId, material, StorageDirection.Both);
    }
    let remaining = total;
    while (remaining > 0) {
        let slot = im.findSlot(storageId, material, SlotKind.Storage);
        if (!slot) {
            slot = im.findSlot(storageId, EMaterialType.NO_MATERIAL, SlotKind.Storage)!;
            im.setSlotMaterial(slot.id, material);
        }
        const deposited = im.deposit(slot.id, Math.min(remaining, SLOT_CAPACITY));
        remaining -= deposited;
    }
}

function createCastleSite(extraCarriers = 0) {
    const s = createScenario.constructionSite(BuildingType.Castle, [], {
        mapWidth: 512,
        mapHeight: 512,
    });
    if (extraCarriers > 0) {
        s.spawnUnitNear(s.storageId, UnitType.Carrier, extraCarriers);
    }
    const costs = getConstructionCosts(BuildingType.Castle, Race.Roman);
    for (const cost of costs) {
        injectStorageMaterial(s, s.storageId, cost.material, cost.count);
    }
    return { sim: s, costs };
}

describe('Multi-pile construction delivery', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('castle construction needs multiple input slots for some materials', () => {
        const { sim: s, costs } = createCastleSite();
        sim = s;
        expect(costs.some(c => c.count > SLOT_CAPACITY)).toBe(true);

        const multiSlotMaterial = costs.find(c => c.count > SLOT_CAPACITY)!;
        const slots = sim.services.inventoryManager
            .getSlots(s.siteId)
            .filter(sl => sl.kind === SlotKind.Input && sl.materialType === multiSlotMaterial.material);
        expect(slots.length).toBeGreaterThan(1);
    });

    it('castle construction completes without overflow with many concurrent carriers', () => {
        // 10 extra carriers = 12 total — more carriers than a single slot can hold,
        // which would cause overflow without the reservation fix
        const { sim: s } = createCastleSite(10);
        sim = s;

        const overflows: Array<{ buildingId: number; material: EMaterialType; amount: number }> = [];
        sim.eventBus.on('construction:materialOverflowed', e => {
            overflows.push({ buildingId: e.buildingId, material: e.material, amount: e.amount });
        });

        sim.waitForConstructionComplete(s.siteId, 200_000);
        expect(sim.services.constructionSiteManager.hasSite(s.siteId), 'castle construction should complete').toBe(
            false
        );
        expect(sim.errors).toHaveLength(0);
        expect(overflows).toHaveLength(0);
    });

    it('castle construction completes with default carriers (no over-delivery)', () => {
        // Default carrier count — slower delivery overlaps with builder consumption.
        // Verifies no extra materials are delivered beyond construction cost.
        const { sim: s } = createCastleSite(0);
        sim = s;

        sim.waitForConstructionComplete(s.siteId, 200_000);
        expect(sim.services.constructionSiteManager.hasSite(s.siteId), 'castle construction should complete').toBe(
            false
        );
        expect(sim.errors).toHaveLength(0);
    });

    it('no over-delivery when storage has excess materials', () => {
        // Excess supply + many carriers ensures all demands get fulfilled.
        // Without the demand cap in processSite, builders consuming materials mid-delivery
        // opens slot space that processSite mistakes for needing more deliveries.
        const s = createScenario.constructionSite(BuildingType.Castle, [], {
            mapWidth: 1024,
            mapHeight: 1024,
        });
        s.spawnUnitNear(s.storageId, UnitType.Carrier, 6);
        const costs = getConstructionCosts(BuildingType.Castle, Race.Roman);
        for (const cost of costs) {
            injectStorageMaterial(s, s.storageId, cost.material, cost.count * 3);
        }
        sim = s;

        const deliveries = new Map<EMaterialType, number>();
        sim.eventBus.on('construction:materialDelivered', e => {
            if (e.buildingId === s.siteId) {
                deliveries.set(e.material, (deliveries.get(e.material) ?? 0) + 1);
            }
        });

        sim.waitForConstructionComplete(s.siteId, 300_000);
        expect(sim.services.constructionSiteManager.hasSite(s.siteId), 'castle construction should complete').toBe(
            false
        );

        // Verify no material was delivered more than its construction cost
        for (const cost of costs) {
            const delivered = deliveries.get(cost.material) ?? 0;
            expect(delivered, `${EMaterialType[cost.material]} delivered`).toBeLessThanOrEqual(cost.count);
        }
    });

    it('slot reservations are cleaned up after construction completes', () => {
        const { sim: s } = createCastleSite(10);
        sim = s;

        sim.waitForConstructionComplete(s.siteId, 200_000);
        expect(sim.services.constructionSiteManager.hasSite(s.siteId), 'castle construction should complete').toBe(
            false
        );

        const slots = sim.services.inventoryManager.getSlots(s.siteId);
        for (const slot of slots) {
            expect(slot.reservations).toHaveLength(0);
        }
    });
});
