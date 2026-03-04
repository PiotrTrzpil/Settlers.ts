/**
 * Unit tests for BuildingPositionResolverImpl.
 *
 * Uses a mocked GameState with a manually created building entity,
 * a mocked InventoryVisualizer that returns canned stack positions,
 * and a mocked WorkAreaStore.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuildingPositionResolverImpl } from '@/game/features/settler-tasks/building-position-resolver';
import { EntityType, BuildingType } from '@/game/entity';
import { EMaterialType } from '@/game/economy/material-type';
import { Race } from '@/game/race';
import type { Entity } from '@/game/entity';

// ─────────────────────────────────────────────────────────────
// Minimal mocks
// ─────────────────────────────────────────────────────────────

function makeBuilding(
    id: number,
    x: number,
    y: number,
    buildingType: BuildingType = BuildingType.WoodcutterHut
): Entity {
    return {
        id,
        type: EntityType.Building,
        x,
        y,
        player: 0,
        subType: buildingType,
        race: Race.Roman,
        selectable: true,
    };
}

function makeUnit(id: number, x: number, y: number): Entity {
    return {
        id,
        type: EntityType.Unit,
        x,
        y,
        player: 0,
        subType: 0,
        race: Race.Roman,
    };
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('BuildingPositionResolverImpl', () => {
    const BUILDING_ID = 42;
    const BUILDING_X = 10;
    const BUILDING_Y = 20;

    let building: Entity;
    let mockGameState: ReturnType<typeof makeMockGameState>;
    let mockWorkAreaStore: ReturnType<typeof makeMockWorkAreaStore>;
    let resolver: BuildingPositionResolverImpl;

    function makeMockGameState(entityMap: Map<number, Entity>) {
        return {
            getEntityOrThrow: vi.fn((id: number, context?: string) => {
                const entity = entityMap.get(id);
                if (!entity) throw new Error(`Entity ${id}${context ? ` (${context})` : ''} not found`);
                return entity;
            }),
            getEntity: vi.fn((id: number) => entityMap.get(id)),
        };
    }

    function makeMockWorkAreaStore(centerX: number, centerY: number) {
        return {
            getAbsoluteCenter: vi.fn(() => ({ x: centerX, y: centerY })),
        };
    }

    beforeEach(() => {
        building = makeBuilding(BUILDING_ID, BUILDING_X, BUILDING_Y);
        const entityMap = new Map<number, Entity>([[BUILDING_ID, building]]);

        mockGameState = makeMockGameState(entityMap);
        // Work area center is at building anchor + (0, 4) by default
        mockWorkAreaStore = makeMockWorkAreaStore(BUILDING_X, BUILDING_Y + 4);

        resolver = new BuildingPositionResolverImpl({
            gameState: mockGameState as never,
            getPileSlotRegistry: () => null,
            getPileRegistry: () => null,
            workAreaStore: mockWorkAreaStore as never,
        });
    });

    // ─── resolvePosition: useWork = false ───────────────────────────

    describe('resolvePosition — useWork: false', () => {
        it('returns building anchor when offset is (0, 0)', () => {
            const pos = resolver.resolvePosition(BUILDING_ID, 0, 0, false);
            expect(pos).toEqual({ x: BUILDING_X, y: BUILDING_Y });
        });

        it('applies positive tile offset from building anchor', () => {
            const pos = resolver.resolvePosition(BUILDING_ID, 3, 2, false);
            expect(pos).toEqual({ x: BUILDING_X + 3, y: BUILDING_Y + 2 });
        });

        it('applies negative tile offset from building anchor', () => {
            const pos = resolver.resolvePosition(BUILDING_ID, -2, -1, false);
            expect(pos).toEqual({ x: BUILDING_X - 2, y: BUILDING_Y - 1 });
        });

        it('does NOT call workAreaStore.getAbsoluteCenter', () => {
            resolver.resolvePosition(BUILDING_ID, 1, 1, false);
            expect(mockWorkAreaStore.getAbsoluteCenter).not.toHaveBeenCalled();
        });
    });

    // ─── resolvePosition: useWork = true ────────────────────────────

    describe('resolvePosition — useWork: true', () => {
        it('returns work center when offset is (0, 0)', () => {
            const pos = resolver.resolvePosition(BUILDING_ID, 0, 0, true);
            // Work center mock returns (building.x + 0, building.y + 4)
            expect(pos).toEqual({ x: BUILDING_X, y: BUILDING_Y + 4 });
        });

        it('applies tile offset from work area center', () => {
            const pos = resolver.resolvePosition(BUILDING_ID, 1, -1, true);
            expect(pos).toEqual({ x: BUILDING_X + 1, y: BUILDING_Y + 4 - 1 });
        });

        it('calls workAreaStore.getAbsoluteCenter with correct args', () => {
            resolver.resolvePosition(BUILDING_ID, 0, 0, true);
            expect(mockWorkAreaStore.getAbsoluteCenter).toHaveBeenCalledWith(
                BUILDING_ID,
                BUILDING_X,
                BUILDING_Y,
                BuildingType.WoodcutterHut,
                Race.Roman
            );
        });
    });

    // ─── resolvePosition: error cases ───────────────────────────────

    describe('resolvePosition — error handling', () => {
        it('throws when building entity does not exist', () => {
            expect(() => resolver.resolvePosition(999, 0, 0, false)).toThrow('Entity 999');
        });

        it('throws when entity exists but is not a building', () => {
            const unitEntity = makeUnit(77, 5, 5);
            const entityMap = new Map<number, Entity>([[77, unitEntity]]);
            const localState = {
                getEntityOrThrow: vi.fn((id: number) => {
                    const e = entityMap.get(id);
                    if (!e) throw new Error(`Entity ${id} not found`);
                    return e;
                }),
                getEntity: vi.fn((id: number) => entityMap.get(id)),
            };

            const localResolver = new BuildingPositionResolverImpl({
                gameState: localState as never,
                getPileSlotRegistry: () => null,
                getPileRegistry: () => null,
                workAreaStore: mockWorkAreaStore as never,
            });

            expect(() => localResolver.resolvePosition(77, 0, 0, false)).toThrow('not a building');
        });
    });

    // ─── getSourcePilePosition (via BuildingPileRegistry) ───────

    describe('getSourcePilePosition', () => {
        it('returns null for unknown material string', () => {
            const pos = resolver.getSourcePilePosition(BUILDING_ID, 'GOOD_UNKNOWN_MATERIAL');
            expect(pos).toBeNull();
        });

        it('throws when registry is not available', () => {
            expect(() => resolver.getSourcePilePosition(BUILDING_ID, 'LOG')).toThrow(
                'BuildingPileRegistry not available'
            );
        });

        it('returns pile position from registry', () => {
            const pilePos = { x: 13, y: 22 };
            const mockRegistry = {
                getPilePositionForSlot: vi.fn().mockReturnValue(pilePos),
            };
            const localResolver = new BuildingPositionResolverImpl({
                gameState: mockGameState as never,
                getPileSlotRegistry: () => null,
                getPileRegistry: () => mockRegistry as never,
                workAreaStore: mockWorkAreaStore as never,
            });
            const pos = localResolver.getSourcePilePosition(BUILDING_ID, 'LOG');
            expect(pos).toEqual(pilePos);
            expect(mockRegistry.getPilePositionForSlot).toHaveBeenCalledWith(
                BuildingType.WoodcutterHut,
                Race.Roman,
                'input',
                EMaterialType.LOG,
                BUILDING_X,
                BUILDING_Y
            );
        });

        it('returns null when registry has no pile entry for non-storage building (caller falls back to door)', () => {
            const mockRegistry = {
                getPilePositionForSlot: vi.fn().mockReturnValue(null),
                hasStoragePiles: vi.fn().mockReturnValue(false),
            };
            const localResolver = new BuildingPositionResolverImpl({
                gameState: mockGameState as never,
                getPileSlotRegistry: () => null,
                getPileRegistry: () => mockRegistry as never,
                workAreaStore: mockWorkAreaStore as never,
            });
            expect(localResolver.getSourcePilePosition(BUILDING_ID, 'LOG')).toBeNull();
        });
    });

    // ─── getDestinationPilePosition (via BuildingPileRegistry) ────

    describe('getDestinationPilePosition', () => {
        it('returns null for unknown material string', () => {
            const pos = resolver.getDestinationPilePosition(BUILDING_ID, 'COMPLETELY_BOGUS');
            expect(pos).toBeNull();
        });

        it('returns pile position from registry', () => {
            const pilePos = { x: 12, y: 22 };
            const mockRegistry = {
                getPilePositionForSlot: vi.fn().mockReturnValue(pilePos),
            };
            const localResolver = new BuildingPositionResolverImpl({
                gameState: mockGameState as never,
                getPileSlotRegistry: () => null,
                getPileRegistry: () => mockRegistry as never,
                workAreaStore: mockWorkAreaStore as never,
            });
            const pos = localResolver.getDestinationPilePosition(BUILDING_ID, 'LOG');
            expect(pos).toEqual(pilePos);
            expect(mockRegistry.getPilePositionForSlot).toHaveBeenCalledWith(
                BuildingType.WoodcutterHut,
                Race.Roman,
                'output',
                EMaterialType.LOG,
                BUILDING_X,
                BUILDING_Y
            );
        });
    });
});
