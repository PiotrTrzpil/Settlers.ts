/**
 * Unit tests for BuildingPileRegistry.
 *
 * Tests cover:
 *  - Anchor-relative offset storage (pile xOffset/yOffset used directly as dx/dy)
 *  - Storage entries (type=4) being skipped
 *  - Input/output filtering
 *  - getPilePosition world-coordinate computation
 *  - getPilePositionForSlot slot-type filtering
 *  - Unknown good strings being skipped
 */

import { describe, it, expect } from 'vitest';
import { BuildingPileRegistry } from '@/game/features/inventory/building-pile-registry';
import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/race';
import { EMaterialType } from '@/game/economy/material-type';
import { PileSlotType } from '@/resources/game-data';
import type { GameData, BuildingInfo, BuildingPileInfo, RaceBuildingData } from '@/resources/game-data';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Create a minimal BuildingInfo with the fields BuildingPileRegistry uses. */
function makeBuildingInfo(id: string, hotSpotX: number, hotSpotY: number, piles: BuildingPileInfo[]): BuildingInfo {
    return {
        id,
        hotSpotX,
        hotSpotY,
        stone: 0,
        boards: 0,
        gold: 0,
        lines: 0,
        buildingPosLines: [],
        digPosLines: [],
        repealingPosLines: [],
        blockPosLines: [],
        waterPosLines: [],
        boundingRect: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        builderNumber: 0,
        flag: { xOffset: 0, yOffset: 0 },
        door: { xOffset: 0, yOffset: 0 },
        workingPos: { xOffset: 0, yOffset: 0 },
        miniFlag: { xOffset: 0, yOffset: 0 },
        pileNumber: piles.length,
        kind: '',
        inhabitant: '',
        tool: '',
        productionDelay: 0,
        influenceRadius: 0,
        explorerRadius: 0,
        workingAreaRadius: 0,
        calcProd: false,
        settlerNumber: 0,
        hitpoints: 0,
        armor: 0,
        patchSettlerSlot: 0,
        waterFreePosLines: [],
        waterBlockPosLines: [],
        patches: [],
        settlers: [],
        animLists: [],
        piles,
        builderInfos: [],
        dummyValue: 0,
        gridChangedForExport: 0,
        gridVersion: 0,
        helperFile: '',
        helperX: 0,
        helperY: 0,
    };
}

/** Create a minimal BuildingPileInfo. */
function makePile(good: string, type: PileSlotType, xOffset: number, yOffset: number): BuildingPileInfo {
    return { xPixelOffset: 0, yPixelOffset: 0, xOffset, yOffset, good, type, patch: 0, appearance: 0 };
}

function makeGameData(
    raceId: 'RACE_ROMAN' | 'RACE_VIKING',
    buildingEntries: Array<{ xmlId: string; info: BuildingInfo }>
): GameData {
    const buildingMap = new Map<string, BuildingInfo>();
    for (const { xmlId, info } of buildingEntries) buildingMap.set(xmlId, info);
    const raceBuildingData: RaceBuildingData = { buildings: buildingMap };
    return {
        buildings: new Map([[raceId, raceBuildingData]]),
        jobs: new Map(),
        objects: new Map(),
        buildingTriggers: new Map(),
        settlers: new Map(),
    };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('BuildingPileRegistry', () => {
    describe('anchor-relative offsets', () => {
        it('uses pile xOffset/yOffset directly as dx/dy', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(1);
            expect(slots[0]).toMatchObject({ dx: 4, dy: 2, material: EMaterialType.LOG, slotType: 'output' });
        });

        it('stores multiple slots with correct input/output distinction', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);

            expect(slots).toHaveLength(2);
            expect(slots.find(s => s.material === EMaterialType.LOG)).toMatchObject({
                dx: 4,
                dy: 1,
                slotType: 'input',
            });
            expect(slots.find(s => s.material === EMaterialType.BOARD)).toMatchObject({
                dx: 5,
                dy: 6,
                slotType: 'output',
            });
        });
    });

    describe('filtering', () => {
        it('skips Storage entries and unknown good strings', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_COAL', PileSlotType.Storage, 3, 3),
                makePile('GOOD_UNKNOWN_THING', PileSlotType.Output, 1, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);

            expect(slots).toHaveLength(2);
            expect(slots.map(s => s.material)).toEqual([EMaterialType.LOG, EMaterialType.BOARD]);
        });

        it('getInputSlots returns only input-typed slots', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            expect(registry.getInputSlots(BuildingType.Sawmill, Race.Roman)).toHaveLength(1);
            expect(registry.getOutputSlots(BuildingType.Sawmill, Race.Roman)).toHaveLength(1);
        });
    });

    describe('getPilePosition', () => {
        it('returns world coordinate by adding dx/dy to building position', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const pos = registry.getPilePosition(BuildingType.WoodcutterHut, Race.Roman, EMaterialType.LOG, 10, 20);

            expect(pos).toEqual({ x: 14, y: 22 });
        });

        it('returns null when material is not registered', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            expect(
                registry.getPilePosition(BuildingType.WoodcutterHut, Race.Roman, EMaterialType.BOARD, 10, 20)
            ).toBeNull();
        });
    });

    describe('getPilePositionForSlot', () => {
        it('returns position filtered by slot type', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);
            const registry = new BuildingPileRegistry(gameData);

            expect(
                registry.getPilePositionForSlot(BuildingType.Sawmill, Race.Roman, 'input', EMaterialType.LOG, 5, 10)
            ).toEqual({ x: 9, y: 11 });
            expect(
                registry.getPilePositionForSlot(BuildingType.Sawmill, Race.Roman, 'output', EMaterialType.BOARD, 5, 10)
            ).toEqual({ x: 10, y: 16 });
        });

        it('returns null when slot type does not match', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [makePile('GOOD_LOG', PileSlotType.Input, 4, 1)]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);
            const registry = new BuildingPileRegistry(gameData);

            expect(
                registry.getPilePositionForSlot(BuildingType.Sawmill, Race.Roman, 'output', EMaterialType.LOG, 5, 10)
            ).toBeNull();
        });
    });
});
