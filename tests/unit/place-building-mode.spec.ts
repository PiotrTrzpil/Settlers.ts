/**
 * PlaceBuildingMode Unit Tests
 *
 * Focused tests for building placement mode behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaceBuildingMode, type PlaceBuildingModeData } from '@/game/input/modes/place-building-mode';
import { BuildingType, getBuildingSize } from '@/game/entity';
import { HANDLED, UNHANDLED, type InputContext } from '@/game/input/input-mode';
import { MouseButton, type PointerData, InputAction } from '@/game/input/input-actions';
import { CursorType } from '@/game/input/render-state';

/** Helper to create minimal PointerData for tests */
function createPointerData(overrides: Partial<PointerData> = {}): PointerData {
    return {
        screenX: 100,
        screenY: 100,
        button: MouseButton.Left,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        originalEvent: {} as PointerEvent, // Mock for unit tests
        ...overrides,
    };
}

describe('PlaceBuildingMode', () => {
    let mode: PlaceBuildingMode;
    let mockContext: InputContext;
    let modeData: PlaceBuildingModeData | undefined;
    let executedCommands: any[];
    let switchedToMode: string | null;

    beforeEach(() => {
        mode = new PlaceBuildingMode();
        modeData = undefined;
        executedCommands = [];
        switchedToMode = null;

        mockContext = {
            state: {
                pointer: { value: { x: 0, y: 0, tileX: 10, tileY: 10 } },
                keys: { value: new Set() },
                drag: { value: null },
            },
            getModeData: <T>() => modeData as T,
            setModeData: <T>(data: T) => { modeData = data as PlaceBuildingModeData | undefined },
            switchMode: (name: string) => { switchedToMode = name },
            executeCommand: (cmd: any) => {
                executedCommands.push(cmd);
                return true;
            },
        } as unknown as InputContext;
    });

    describe('mode entry and exit', () => {
        it('should initialize with building type and switch to select if missing', () => {
            // Valid entry
            mode.onEnter(mockContext, { buildingType: BuildingType.Lumberjack, player: 1 });
            expect(modeData?.buildingType).toBe(BuildingType.Lumberjack);

            // Invalid entry - switches to select
            switchedToMode = null;
            mode.onEnter(mockContext, undefined);
            expect(switchedToMode).toBe('select');
        });

        it('should clear mode data on exit', () => {
            mode.onEnter(mockContext, { buildingType: BuildingType.Farm });
            mode.onExit(mockContext);
            expect(modeData).toBeUndefined();
        });
    });

    describe('cancel actions', () => {
        beforeEach(() => {
            mode.onEnter(mockContext, { buildingType: BuildingType.Lumberjack });
        });

        it('should switch to select on ESC/cancel and right-click', () => {
            // ESC/cancel action
            expect(mode.onAction(InputAction.CancelPlacement, mockContext)).toBe(HANDLED);
            expect(switchedToMode).toBe('select');

            // Right-click
            switchedToMode = null;
            mode.onEnter(mockContext, { buildingType: BuildingType.Lumberjack });
            mode.onPointerUp(createPointerData({ button: MouseButton.Right }), mockContext);
            expect(switchedToMode).toBe('select');
        });
    });

    describe('building placement', () => {
        beforeEach(() => {
            mode.onEnter(mockContext, { buildingType: BuildingType.Sawmill, player: 0 });
        });

        it('should place building and exit mode on valid left-click', () => {
            modeData!.previewValid = true;
            modeData!.previewX = 15;
            modeData!.previewY = 20;

            mode.onPointerUp(createPointerData({ tileX: 15, tileY: 20 }), mockContext);

            expect(executedCommands).toHaveLength(1);
            expect(executedCommands[0]).toMatchObject({
                type: 'place_building',
                buildingType: BuildingType.Sawmill,
                x: 15,
                y: 20,
                player: 0,
            });
            expect(switchedToMode).toBe('select');
        });

        it('should NOT place or exit when preview is invalid or command fails', () => {
            // Invalid preview
            modeData!.previewValid = false;
            mode.onPointerUp(createPointerData(), mockContext);
            expect(executedCommands).toHaveLength(0);
            expect(switchedToMode).toBeNull();

            // Command failure
            modeData!.previewValid = true;
            mockContext.executeCommand = () => false;
            mode.onPointerUp(createPointerData(), mockContext);
            expect(switchedToMode).toBeNull();
        });
    });

    describe('preview positioning', () => {
        beforeEach(() => {
            mode.onEnter(mockContext, { buildingType: BuildingType.Lumberjack });
        });

        it('should center preview on cursor using building size', () => {
            mode.onPointerMove(createPointerData({ tileX: 25, tileY: 30 }), mockContext);

            const size = getBuildingSize(BuildingType.Lumberjack);
            const expectedX = Math.round(25 - (size.width - 1) / 2);
            const expectedY = Math.round(30 - (size.height - 1) / 2);

            expect(modeData!.previewX).toBe(expectedX);
            expect(modeData!.previewY).toBe(expectedY);
            expect(modeData!.previewValid).toBe(true); // Default without validator
        });

        it('should use validator function when provided', () => {
            const validator = vi.fn().mockReturnValue(false);
            modeData!.validatePlacement = validator;

            mode.onPointerMove(createPointerData({ tileX: 10, tileY: 10 }), mockContext);

            expect(validator).toHaveBeenCalled();
            expect(modeData!.previewValid).toBe(false);
        });

        it('should return UNHANDLED when tile coords or mode data missing', () => {
            expect(mode.onPointerMove(createPointerData({ tileX: undefined }), mockContext)).toBe(UNHANDLED);

            modeData = undefined;
            expect(mode.onPointerMove(createPointerData({ tileX: 10, tileY: 10 }), mockContext)).toBe(UNHANDLED);
        });
    });

    describe('render state', () => {
        it('should return appropriate cursor and preview based on validity', () => {
            mode.onEnter(mockContext, { buildingType: BuildingType.Farm });

            // Valid preview
            modeData!.previewValid = true;
            modeData!.previewX = 5;
            modeData!.previewY = 15;

            let state = mode.getRenderState(mockContext);
            expect(state.cursor).toBe(CursorType.Crosshair);
            expect(state.preview).toMatchObject({ type: 'building', valid: true });
            expect(state.statusText).toContain('Place');

            // Invalid preview
            modeData!.previewValid = false;
            state = mode.getRenderState(mockContext);
            expect(state.cursor).toBe(CursorType.NotAllowed);
            expect(state.statusText).toBe('Cannot place here');
        });

        it('should return default state when no mode data', () => {
            modeData = undefined;
            const state = mode.getRenderState(mockContext);
            expect(state.cursor).toBe(CursorType.Crosshair);
            expect(state.preview).toBeUndefined();
        });
    });

    describe('properties', () => {
        it('should have correct name and display name', () => {
            expect(mode.name).toBe('place_building');
            expect(mode.displayName).toBe('Place Building');
        });
    });
});
