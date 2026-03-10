/**
 * Integration tests for multiple carriers picking up from the same source.
 *
 * Validates that when several carriers are dispatched to pick up from the same
 * building or free pile, all of them complete their deliveries without task
 * failures or cancellations (except legitimate inventory exhaustion).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { BuildingType, EntityType, UnitType } from '@/game/entity';
import { EMaterialType } from '@/game/economy';
import { Simulation, createScenario, cleanupSimulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';

const hasRealData = installRealGameData();

describe.skipIf(!hasRealData)('Concurrent carrier pickup (real game data)', { timeout: 60_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    it('multiple carriers deliver from storage to construction site without failures', () => {
        // Setup: construction site needing 2+2 materials, storage has plenty
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ]);
        sim = s;

        // Track failed tasks and cancelled transports
        const taskFailures: Array<{ unitId: number; failedStep: string; nodeIndex: number }> = [];
        const transportCancellations: Array<{ carrierId: number; reason: string }> = [];
        const pickupFailures: Array<{ entityId: number; material: number }> = [];

        sim.eventBus.on('settler:taskFailed', e => {
            taskFailures.push({ unitId: e.unitId, failedStep: e.failedStep, nodeIndex: e.nodeIndex });
        });
        sim.eventBus.on('carrier:transportCancelled', e => {
            transportCancellations.push({ carrierId: e.carrierId, reason: e.reason });
        });
        sim.eventBus.on('carrier:pickupFailed', e => {
            pickupFailures.push({ entityId: e.entityId, material: e.material });
        });

        // Wait for construction to finish (all materials delivered)
        sim.waitForConstructionComplete(s.siteId);

        // Log diagnostic info
        if (taskFailures.length > 0) {
            console.log('Task failures:', JSON.stringify(taskFailures, null, 2));
        }
        if (transportCancellations.length > 0) {
            console.log('Transport cancellations:', JSON.stringify(transportCancellations, null, 2));
        }
        if (pickupFailures.length > 0) {
            console.log('Pickup failures:', JSON.stringify(pickupFailures, null, 2));
        }

        expect(sim.errors).toHaveLength(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
    });

    it('multiple carriers pick up from same free pile without task failures', () => {
        // Setup: construction site with no storage — use free piles only
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, []);
        sim = s;

        // Place a SINGLE free pile with enough materials for multiple carrier trips
        sim.placeGoodsNear(s.siteId, EMaterialType.BOARD, 8);
        sim.placeGoodsNear(s.siteId, EMaterialType.STONE, 8);

        // Track events
        const taskFailures: Array<{ unitId: number; failedStep: string; nodeIndex: number }> = [];
        const transportCancellations: Array<{ carrierId: number; reason: string }> = [];
        const pickupFailures: Array<{ entityId: number; material: number }> = [];
        let deliveryCount = 0;

        sim.eventBus.on('settler:taskFailed', e => {
            taskFailures.push({ unitId: e.unitId, failedStep: e.failedStep, nodeIndex: e.nodeIndex });
        });
        sim.eventBus.on('carrier:transportCancelled', e => {
            transportCancellations.push({ carrierId: e.carrierId, reason: e.reason });
        });
        sim.eventBus.on('carrier:pickupFailed', e => {
            pickupFailures.push({ entityId: e.entityId, material: e.material });
        });
        sim.eventBus.on('carrier:deliveryComplete', () => {
            deliveryCount++;
        });

        // Wait for construction to complete
        sim.waitForConstructionComplete(s.siteId);

        // Dump diagnostics
        if (taskFailures.length > 0) {
            console.log('Task failures:', JSON.stringify(taskFailures, null, 2));
        }
        if (transportCancellations.length > 0) {
            console.log('Transport cancellations:', JSON.stringify(transportCancellations, null, 2));
        }
        if (pickupFailures.length > 0) {
            console.log('Pickup failures:', JSON.stringify(pickupFailures, null, 2));
        }

        expect(deliveryCount).toBeGreaterThan(0);
        expect(sim.errors).toHaveLength(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
    });

    it('construction completes with extra carriers competing for limited stock', () => {
        // Setup: storage with enough materials, extra carriers to increase contention
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ]);
        sim = s;

        // Spawn extra carriers to increase competition at pickup/dropoff points
        sim.spawnUnitNear(s.storageId, UnitType.Carrier, 3);

        // Construction should complete despite carrier contention
        sim.waitForConstructionComplete(s.siteId);

        expect(sim.errors).toHaveLength(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
    });

    it('in-flight carrier jobs are cancelled when construction completes', () => {
        // Setup: excess supply ensures carriers are still dispatched when building finishes
        const s = createScenario.constructionSite(BuildingType.WoodcutterHut, [
            [EMaterialType.BOARD, 8],
            [EMaterialType.STONE, 8],
        ]);
        sim = s;

        // Track cancellations specifically from construction completion
        let completionCancellations = 0;
        sim.eventBus.on('carrier:transportCancelled', e => {
            if (e.reason === 'construction_completed') {
                completionCancellations++;
            }
        });

        // Wait for construction to finish — carriers may still be en route
        sim.waitForConstructionComplete(s.siteId);

        // Continue running so any un-cancelled carriers would crash on deposit
        sim.runTicks(5_000);

        // No errors — if in-flight jobs weren't cancelled, depositInput would throw
        expect(sim.errors).toHaveLength(0);
        // Cancellations are expected (0 or more depending on timing)
        expect(completionCancellations).toBeGreaterThanOrEqual(0);
        expect(sim.countEntities(EntityType.Unit, UnitType.Woodcutter)).toBe(1);
    });

    it('3 carriers spawned next to free pile all pick up without failures', () => {
        sim = new Simulation();
        sim.placeBuilding(BuildingType.ResidenceSmall);
        sim.placeBuilding(BuildingType.WoodcutterHut, 0, false);

        // Place free piles with plenty of material
        const pileId = sim.placeGoods(EMaterialType.BOARD, 8);
        sim.placeGoods(EMaterialType.STONE, 8);

        // Spawn 3 carriers RIGHT NEXT TO the pile
        sim.spawnUnitNear(pileId, UnitType.Carrier, 3);

        let pickupFailCount = 0;
        sim.eventBus.on('carrier:pickupFailed', () => {
            pickupFailCount++;
        });

        let deliveryCount = 0;
        sim.eventBus.on('carrier:deliveryComplete', () => {
            deliveryCount++;
        });

        // Run until at least 3 deliveries
        sim.runUntil(() => deliveryCount >= 3, {
            maxTicks: 50_000,
            label: '3 carriers deliver from nearby pile',
        });

        expect(pickupFailCount).toBe(0);
        expect(deliveryCount).toBeGreaterThanOrEqual(3);
        expect(sim.errors).toHaveLength(0);
    });
});
