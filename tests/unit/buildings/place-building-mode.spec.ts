/**
 * PlaceBuildingMode Unit Tests
 *
 * Behavioral tests for building placement mode state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaceBuildingMode, type PlaceBuildingModeData } from '@/game/input/modes/place-building-mode';
import { BuildingType } from '@/game/entity';
import { HANDLED, type InputContext } from '@/game/input/input-mode';
import { MouseButton, type PointerData, InputAction } from '@/game/input/input-actions';
import { CursorType } from '@/game/input/render-state';
import { commandFailed } from '@/game/commands';
import { createTestInputContext } from '../helpers/test-game';

function createPointerData(overrides: Partial<PointerData> = {}): PointerData {
    return {
        screenX: 100,
        screenY: 100,
        button: MouseButton.Left,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        originalEvent: {} as PointerEvent,
        ...overrides,
    };
}

describe('PlaceBuildingMode', () => {
    let mode: PlaceBuildingMode;
    let mockContext: InputContext;
    let executedCommands: Record<string, unknown>[];
    let getSwitchedMode: () => string | null;
    let getModeData: () => unknown;

    beforeEach(() => {
        mode = new PlaceBuildingMode(() => true);
        const helper = createTestInputContext();
        mockContext = helper.ctx;
        executedCommands = helper.commands;
        getSwitchedMode = helper.getSwitchedMode;
        getModeData = helper.getModeData;
    });

    /** Typed accessor for current mode data. */
    function modeData(): PlaceBuildingModeData {
        return getModeData() as PlaceBuildingModeData;
    }

    it('should initialize with building type on enter and switch to select on invalid entry', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.WoodcutterHut, player: 1 });
        expect(modeData().buildingType).toBe(BuildingType.WoodcutterHut);

        mode.onEnter(mockContext, undefined);
        expect(getSwitchedMode()).toBe('select');
    });

    it('should cancel on ESC and right-click, clearing mode data', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.WoodcutterHut });

        expect(mode.onAction(InputAction.CancelPlacement, mockContext)).toBe(HANDLED);
        expect(getSwitchedMode()).toBe('select');
    });

    it('should cancel on right-click', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.WoodcutterHut });
        mode.onPointerUp(createPointerData({ button: MouseButton.Right }), mockContext);
        expect(getSwitchedMode()).toBe('select');
    });

    it('should place building on valid left-click', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.Sawmill, player: 0 });
        modeData().previewValid = true;
        modeData().previewX = 15;
        modeData().previewY = 20;
        mode.onPointerDown(createPointerData({ tileX: 15, tileY: 20 }), mockContext);

        expect(executedCommands).toHaveLength(1);
        expect(executedCommands[0]).toMatchObject({
            type: 'place_building',
            buildingType: BuildingType.Sawmill,
            x: 15,
            y: 20,
            player: 0,
        });
        expect(getSwitchedMode()).toBe('select');
    });

    it('should not place when preview is invalid', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.Sawmill, player: 0 });
        modeData().previewValid = false;
        mode.onPointerDown(createPointerData(), mockContext);

        expect(executedCommands).toHaveLength(0);
        expect(getSwitchedMode()).toBeNull();
    });

    it('should stay in mode when command fails', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.Sawmill, player: 0 });
        modeData().previewValid = true;
        mockContext.executeCommand = () => commandFailed('test failure');
        mode.onPointerDown(createPointerData(), mockContext);

        expect(getSwitchedMode()).toBeNull();
    });

    it('should use cursor position as anchor and validate with constructor function', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.WoodcutterHut });
        mode.onPointerMove(createPointerData({ tileX: 25, tileY: 30 }), mockContext);

        expect(modeData().previewX).toBe(25);
        expect(modeData().previewY).toBe(30);

        // Validator rejects
        const validator = vi.fn().mockReturnValue(false);
        const validatedMode = new PlaceBuildingMode(validator);
        validatedMode.onEnter(mockContext, { buildingType: BuildingType.WoodcutterHut });
        validatedMode.onPointerMove(createPointerData({ tileX: 10, tileY: 10 }), mockContext);
        expect(modeData().previewValid).toBe(false);
    });

    it('should reflect validity in cursor and status text', () => {
        mode.onEnter(mockContext, { buildingType: BuildingType.GrainFarm });

        modeData().previewValid = true;
        modeData().previewX = 5;
        modeData().previewY = 15;
        let state = mode.getRenderState(mockContext);
        expect(state.cursor).toBe(CursorType.Crosshair);
        expect(state.preview).toMatchObject({ type: 'placement', entityType: 'building', valid: true });

        modeData().previewValid = false;
        state = mode.getRenderState(mockContext);
        expect(state.cursor).toBe(CursorType.NotAllowed);
        expect(state.statusText).toBe('Cannot place here');
    });
});
