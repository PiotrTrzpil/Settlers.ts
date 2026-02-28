/**
 * Unit tests for BuildingPileRegistry.
 *
 * Tests cover:
 *  - Hotspot-adjusted offset calculation
 *  - Storage entries (type=4) being skipped
 *  - Input/output filtering
 *  - getPilePosition world-coordinate computation
 *  - getPilePositionForSlot slot-type filtering
 *  - Missing building returning empty array
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
    return {
        xPixelOffset: 0,
        yPixelOffset: 0,
        xOffset,
        yOffset,
        good,
        type,
        patch: 0,
        appearance: 0,
    };
}

/**
 * Build a minimal GameData with a single race entry containing the given buildings.
 * Uses 'RACE_ROMAN' mapped to Race.Roman.
 */
function makeGameData(
    raceId: 'RACE_ROMAN' | 'RACE_VIKING' | 'RACE_MAYA' | 'RACE_DARK' | 'RACE_TROJAN',
    buildingEntries: Array<{ xmlId: string; info: BuildingInfo }>
): GameData {
    const buildingMap = new Map<string, BuildingInfo>();
    for (const { xmlId, info } of buildingEntries) {
        buildingMap.set(xmlId, info);
    }
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
    // ─── Hotspot adjustment ───────────────────────────────────

    describe('hotspot-adjusted offsets', () => {
        it('computes dx/dy by subtracting hotspot from pile offsets (WoodcutterHut example)', () => {
            // WoodcutterHut (Roman): hotSpot=(3,5), LOG pile at (4,2) → dx=+1, dy=-3
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(1);
            expect(slots[0]!.dx).toBe(1); // 4 - 3
            expect(slots[0]!.dy).toBe(-3); // 2 - 5
            expect(slots[0]!.material).toBe(EMaterialType.LOG);
            expect(slots[0]!.slotType).toBe('output');
        });

        it('computes dx/dy for Sawmill LOG input and BOARD output', () => {
            // Sawmill (Roman): hotSpot=(4,5)
            //   LOG input at (4,1) → dx=0, dy=-4
            //   BOARD output at (5,6) → dx=+1, dy=+1
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);

            expect(slots).toHaveLength(2);

            const logSlot = slots.find(s => s.material === EMaterialType.LOG);
            expect(logSlot).toBeDefined();
            expect(logSlot!.dx).toBe(0); // 4 - 4
            expect(logSlot!.dy).toBe(-4); // 1 - 5
            expect(logSlot!.slotType).toBe('input');

            const boardSlot = slots.find(s => s.material === EMaterialType.BOARD);
            expect(boardSlot).toBeDefined();
            expect(boardSlot!.dx).toBe(1); // 5 - 4
            expect(boardSlot!.dy).toBe(1); // 6 - 5
            expect(boardSlot!.slotType).toBe('output');
        });

        it('handles negative dx/dy when pile is above/left of hotspot', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 5, 5, [
                makePile('GOOD_COAL', PileSlotType.Input, 2, 1),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(1);
            expect(slots[0]!.dx).toBe(-3); // 2 - 5
            expect(slots[0]!.dy).toBe(-4); // 1 - 5
        });

        it('handles zero dx/dy when pile offset equals hotspot', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 3, [
                makePile('GOOD_GRAIN', PileSlotType.Input, 3, 3),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots[0]!.dx).toBe(0);
            expect(slots[0]!.dy).toBe(0);
        });
    });

    // ─── Storage entries skipped ──────────────────────────────

    describe('storage entry filtering', () => {
        it('skips entries with type=Storage (type=4)', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Storage, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(0);
        });

        it('keeps input and output entries but skips storage entries in a mixed pile list', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_COAL', PileSlotType.Storage, 3, 3),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);

            expect(slots).toHaveLength(2);
            expect(slots.every(s => s.material !== EMaterialType.COAL)).toBe(true);
        });
    });

    // ─── Input/Output filtering ───────────────────────────────

    describe('getInputSlots / getOutputSlots', () => {
        it('getInputSlots returns only input-typed slots', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const inputSlots = registry.getInputSlots(BuildingType.Sawmill, Race.Roman);

            expect(inputSlots).toHaveLength(1);
            expect(inputSlots[0]!.slotType).toBe('input');
            expect(inputSlots[0]!.material).toBe(EMaterialType.LOG);
        });

        it('getOutputSlots returns only output-typed slots', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const outputSlots = registry.getOutputSlots(BuildingType.Sawmill, Race.Roman);

            expect(outputSlots).toHaveLength(1);
            expect(outputSlots[0]!.slotType).toBe('output');
            expect(outputSlots[0]!.material).toBe(EMaterialType.BOARD);
        });

        it('getInputSlots returns empty array when there are no inputs', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const inputSlots = registry.getInputSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(inputSlots).toHaveLength(0);
        });

        it('getOutputSlots returns empty array when there are no outputs', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [makePile('GOOD_LOG', PileSlotType.Input, 4, 1)]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const outputSlots = registry.getOutputSlots(BuildingType.Sawmill, Race.Roman);

            expect(outputSlots).toHaveLength(0);
        });

        it('correctly maps PileSlotType.Input=1 to slotType "input"', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [makePile('GOOD_GRAIN', PileSlotType.Input, 4, 1)]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);

            expect(slots[0]!.slotType).toBe('input');
        });

        it('correctly maps PileSlotType.Output=0 to slotType "output"', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots[0]!.slotType).toBe('output');
        });
    });

    // ─── getPilePosition ──────────────────────────────────────

    describe('getPilePosition', () => {
        it('returns world coordinate by adding dx/dy to building position', () => {
            // WoodcutterHut at (10,20), hotSpot=(3,5), LOG pile at (4,2) → dx=+1, dy=-3
            // Expected position: (10+1, 20-3) = (11, 17)
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const pos = registry.getPilePosition(BuildingType.WoodcutterHut, Race.Roman, EMaterialType.LOG, 10, 20);

            expect(pos).not.toBeNull();
            expect(pos!.x).toBe(11);
            expect(pos!.y).toBe(17);
        });

        it('returns null when material is not registered for the building', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const pos = registry.getPilePosition(BuildingType.WoodcutterHut, Race.Roman, EMaterialType.BOARD, 10, 20);

            expect(pos).toBeNull();
        });

        it('returns null when building type has no pile data', () => {
            const gameData = makeGameData('RACE_ROMAN', []);

            const registry = new BuildingPileRegistry(gameData);
            const pos = registry.getPilePosition(BuildingType.WoodcutterHut, Race.Roman, EMaterialType.LOG, 5, 5);

            expect(pos).toBeNull();
        });

        it('returns first matching material slot regardless of slotType', () => {
            // If the same material appears as both input and output, getPilePosition returns the first match
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_BOARD', PileSlotType.Input, 3, 3),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const pos = registry.getPilePosition(BuildingType.Sawmill, Race.Roman, EMaterialType.BOARD, 0, 0);

            // Should return first match: dx = 3-4 = -1, dy = 3-5 = -2
            expect(pos).not.toBeNull();
            expect(pos!.x).toBe(-1);
            expect(pos!.y).toBe(-2);
        });
    });

    // ─── getPilePositionForSlot ───────────────────────────────

    describe('getPilePositionForSlot', () => {
        it('returns position for the specified material and slot type', () => {
            // Sawmill at (5,10), hotSpot=(4,5)
            //   LOG input at (4,1) → dx=0, dy=-4 → world (5+0, 10-4) = (5, 6)
            //   BOARD output at (5,6) → dx=+1, dy=+1 → world (5+1, 10+1) = (6, 11)
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);

            const logInputPos = registry.getPilePositionForSlot(
                BuildingType.Sawmill,
                Race.Roman,
                'input',
                EMaterialType.LOG,
                5,
                10
            );
            expect(logInputPos).not.toBeNull();
            expect(logInputPos!.x).toBe(5);
            expect(logInputPos!.y).toBe(6);

            const boardOutputPos = registry.getPilePositionForSlot(
                BuildingType.Sawmill,
                Race.Roman,
                'output',
                EMaterialType.BOARD,
                5,
                10
            );
            expect(boardOutputPos).not.toBeNull();
            expect(boardOutputPos!.x).toBe(6);
            expect(boardOutputPos!.y).toBe(11);
        });

        it('returns null when the slot type does not match', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [makePile('GOOD_LOG', PileSlotType.Input, 4, 1)]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);

            // LOG exists as input, not output — should return null
            const pos = registry.getPilePositionForSlot(
                BuildingType.Sawmill,
                Race.Roman,
                'output',
                EMaterialType.LOG,
                5,
                10
            );
            expect(pos).toBeNull();
        });

        it('returns null when the material does not match for the given slot type', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);

            const pos = registry.getPilePositionForSlot(
                BuildingType.Sawmill,
                Race.Roman,
                'output',
                EMaterialType.LOG,
                5,
                10
            );
            expect(pos).toBeNull();
        });
    });

    // ─── Missing building ─────────────────────────────────────

    describe('missing building', () => {
        it('returns empty array for a building type not in game data', () => {
            const gameData = makeGameData('RACE_ROMAN', []);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(0);
        });

        it('returns empty array for a building with no pile entries', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, []);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(0);
        });

        it('returns empty array when querying a different race than what was registered', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            // Only register RACE_ROMAN
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            // Query for Viking — no data
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Viking);

            expect(slots).toHaveLength(0);
        });

        it('returns empty array for a building XML ID not in the BuildingType map', () => {
            // 'BUILDING_UNKNOWN_XYZ' has no mapping in BUILDING_TYPE_TO_XML_ID
            const info = makeBuildingInfo('BUILDING_UNKNOWN_XYZ', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_UNKNOWN_XYZ', info }]);

            const registry = new BuildingPileRegistry(gameData);
            // No BuildingType maps to BUILDING_UNKNOWN_XYZ, so nothing is stored
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(0);
        });
    });

    // ─── Unknown good strings ─────────────────────────────────

    describe('unknown good strings', () => {
        it('skips pile entries with unrecognized good strings', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_UNKNOWN_THING', PileSlotType.Output, 4, 2),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(0);
        });

        it('skips GOOD_NO_GOOD entries', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_NO_GOOD', PileSlotType.Input, 4, 2),
                makePile('GOOD_LOG', PileSlotType.Output, 5, 3),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(1);
            expect(slots[0]!.material).toBe(EMaterialType.LOG);
        });

        it('skips empty good string entries', () => {
            const info = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [makePile('', PileSlotType.Input, 4, 2)]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_WOODCUTTERHUT', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);

            expect(slots).toHaveLength(0);
        });

        it('keeps valid pile entries alongside skipped unknown entries', () => {
            const info = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_UNKNOWN_MATERIAL', PileSlotType.Input, 2, 2),
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const gameData = makeGameData('RACE_ROMAN', [{ xmlId: 'BUILDING_SAWMILL', info }]);

            const registry = new BuildingPileRegistry(gameData);
            const slots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);

            expect(slots).toHaveLength(2);
            const materials = slots.map(s => s.material);
            expect(materials).toContain(EMaterialType.LOG);
            expect(materials).toContain(EMaterialType.BOARD);
        });
    });

    // ─── Multiple races ───────────────────────────────────────

    describe('multiple races', () => {
        it('stores pile data keyed per race independently', () => {
            const romanInfo = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);
            const vikingInfo = makeBuildingInfo('BUILDING_SAWMILL', 6, 8, [
                makePile('GOOD_LOG', PileSlotType.Input, 7, 5),
            ]);

            const romanBuildingMap = new Map<string, BuildingInfo>([['BUILDING_SAWMILL', romanInfo]]);
            const vikingBuildingMap = new Map<string, BuildingInfo>([['BUILDING_SAWMILL', vikingInfo]]);

            const gameData: GameData = {
                buildings: new Map([
                    ['RACE_ROMAN', { buildings: romanBuildingMap }],
                    ['RACE_VIKING', { buildings: vikingBuildingMap }],
                ]),
                jobs: new Map(),
                objects: new Map(),
                buildingTriggers: new Map(),
                settlers: new Map(),
            };

            const registry = new BuildingPileRegistry(gameData);

            const romanSlots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);
            // Roman: hotSpot=(4,5), LOG at (4,1) → dx=0, dy=-4; BOARD at (5,6) → dx=+1, dy=+1
            expect(romanSlots).toHaveLength(2);
            const romanLog = romanSlots.find(s => s.material === EMaterialType.LOG);
            expect(romanLog!.dx).toBe(0);
            expect(romanLog!.dy).toBe(-4);

            const vikingSlots = registry.getPileSlots(BuildingType.Sawmill, Race.Viking);
            // Viking: hotSpot=(6,8), LOG at (7,5) → dx=+1, dy=-3
            expect(vikingSlots).toHaveLength(1);
            expect(vikingSlots[0]!.dx).toBe(1); // 7 - 6
            expect(vikingSlots[0]!.dy).toBe(-3); // 5 - 8
        });
    });

    // ─── Basic construction / multiple buildings ──────────────

    describe('basic construction with multiple buildings', () => {
        it('registers pile data for all buildings in game data', () => {
            const woodcutterInfo = makeBuildingInfo('BUILDING_WOODCUTTERHUT', 3, 5, [
                makePile('GOOD_LOG', PileSlotType.Output, 4, 2),
            ]);
            const sawmillInfo = makeBuildingInfo('BUILDING_SAWMILL', 4, 5, [
                makePile('GOOD_LOG', PileSlotType.Input, 4, 1),
                makePile('GOOD_BOARD', PileSlotType.Output, 5, 6),
            ]);

            const gameData = makeGameData('RACE_ROMAN', [
                { xmlId: 'BUILDING_WOODCUTTERHUT', info: woodcutterInfo },
                { xmlId: 'BUILDING_SAWMILL', info: sawmillInfo },
            ]);

            const registry = new BuildingPileRegistry(gameData);

            const wcSlots = registry.getPileSlots(BuildingType.WoodcutterHut, Race.Roman);
            expect(wcSlots).toHaveLength(1);
            expect(wcSlots[0]!.material).toBe(EMaterialType.LOG);

            const sawSlots = registry.getPileSlots(BuildingType.Sawmill, Race.Roman);
            expect(sawSlots).toHaveLength(2);
        });
    });
});
