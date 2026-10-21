/**
 * Pile position parity — inventory slots carry the pile tile decided at slot creation.
 *
 * Expected tiles are computed independently in the test from the same inputs the
 * game uses (buildingInfo.xml pile registry, door-adjacent construction layout),
 * so every slot kind is checked against its source of truth:
 *   - production input/output slots → XML pile offset for (type, race, side, material)
 *   - storage slots                 → XML storage pile offsets, in XML order
 *   - construction slots            → assignConstructionPilePositions, one tile per pile (≤8 items)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createSimulation, cleanupSimulation, type Simulation } from '../../helpers/test-simulation';
import { installRealGameData } from '../../helpers/test-game-data';
import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';
import { SlotKind } from '@/game/core/pile-kind';
import { EMaterialType } from '@/game/economy/material-type';
import type { Tile } from '@/game/core/coordinates';
import { assignConstructionPilePositions, type BuildingPileRegistry } from '@/game/features/inventory';
import type { BuildingConstructionExports } from '@/game/features/building-construction';

installRealGameData();

const PRODUCTION_TYPES = [
    BuildingType.WoodcutterHut,
    BuildingType.Sawmill,
    BuildingType.Mill,
    BuildingType.Bakery,
    BuildingType.IronSmelter,
    BuildingType.WeaponSmith,
    BuildingType.Slaughterhouse,
];
const CONSTRUCTION_TYPES = [
    BuildingType.WoodcutterHut,
    BuildingType.Sawmill,
    BuildingType.StorageArea,
    BuildingType.Castle,
];
const RACES = [Race.Roman, Race.Viking, Race.Mayan];

function pileRegistry(sim: Simulation): BuildingPileRegistry {
    return sim.services.getFeature<BuildingConstructionExports>('building-construction').pileRegistry;
}

function slotsOf(sim: Simulation, buildingId: number, kind: SlotKind) {
    return sim.services.inventoryManager.getSlots(buildingId).filter(s => s.kind === kind);
}

describe('Pile positions are fixed at slot creation', { timeout: 30_000 }, () => {
    let sim: Simulation;

    afterEach(() => {
        sim?.destroy();
        cleanupSimulation();
    });

    for (const race of RACES) {
        it(`production slots use XML pile offsets (${race})`, () => {
            sim = createSimulation();
            const registry = pileRegistry(sim);
            for (const type of PRODUCTION_TYPES) {
                const id = sim.placeBuilding(type, 0, true, race, false);
                const b = sim.state.getEntityOrThrow(id, 'test building');
                expect(sim.services.inventoryManager.getSlots(id).length, `${type} slots`).toBeGreaterThan(0);
                for (const side of [SlotKind.Input, SlotKind.Output] as const) {
                    for (const slot of slotsOf(sim, id, side)) {
                        const expected = registry.getPilePositionForSlot(type, race, side, slot.materialType, b.x, b.y);
                        expect(slot.position, `${type} ${side} ${slot.materialType}`).toEqual(expected);
                        expect(sim.services.inventoryManager.getPilePosition(id, slot.materialType, side)).toEqual(
                            expected
                        );
                    }
                }
            }
        });

        it(`construction slots use the door-adjacent layout, one tile per pile (${race})`, () => {
            sim = createSimulation();
            for (const type of CONSTRUCTION_TYPES) {
                const id = sim.placeBuilding(type, 0, false, race, false);
                const b = sim.state.getEntityOrThrow(id, 'test site');
                const layout = assignConstructionPilePositions(type, race, b.x, b.y);
                expect(layout.size, `${type} construction materials`).toBeGreaterThan(0);
                const byMaterial = new Map<EMaterialType, Tile[]>();
                for (const slot of slotsOf(sim, id, SlotKind.Input)) {
                    if (!byMaterial.has(slot.materialType)) {
                        byMaterial.set(slot.materialType, []);
                    }
                    byMaterial.get(slot.materialType)!.push(slot.position);
                }
                expect(byMaterial, `${type} construction piles`).toEqual(layout);
                for (const [material, tiles] of layout) {
                    expect(sim.services.inventoryManager.getPilePosition(id, material, SlotKind.Input)).toEqual(
                        tiles[0]
                    );
                }
            }
        });
    }

    it('storage slots take the XML storage pile offsets in order', () => {
        sim = createSimulation();
        const id = sim.placeBuilding(BuildingType.StorageArea, 0, true, Race.Roman, false);
        const b = sim.state.getEntityOrThrow(id, 'storage');
        const expected = pileRegistry(sim).getStoragePileWorldPositions(BuildingType.StorageArea, Race.Roman, b.x, b.y);
        expect(expected.length).toBeGreaterThan(0);
        expect(slotsOf(sim, id, SlotKind.Storage).map(s => s.position)).toEqual(expected);
    });

    it('storage pile lookup finds the slot holding the material, absent when nothing is stored', () => {
        sim = createSimulation();
        const id = sim.placeBuilding(BuildingType.StorageArea, 0, true, Race.Roman, false);
        const im = sim.services.inventoryManager;
        expect(im.findPileSlot(id, EMaterialType.BOARD, SlotKind.Output)).toBeUndefined();

        sim.injectOutput(id, EMaterialType.LOG, 3);
        sim.injectOutput(id, EMaterialType.BOARD, 2);
        const boardSlot = slotsOf(sim, id, SlotKind.Storage).find(s => s.materialType === EMaterialType.BOARD)!;
        expect(im.getPilePosition(id, EMaterialType.BOARD, SlotKind.Output)).toEqual(boardSlot.position);
        expect(im.getPilePosition(id, EMaterialType.BOARD, SlotKind.Input)).toEqual(boardSlot.position);
        expect(() => im.getPilePosition(id, EMaterialType.STONE, SlotKind.Output)).toThrow(/no output pile/);
    });
});
