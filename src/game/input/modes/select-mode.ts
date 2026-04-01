import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData, type DragData } from '../input-actions';
import { CursorType, type ModeRenderState, type SelectionBox } from '../render-state';
import { UnitType } from '../../entity';

const DOUBLE_CLICK_MS = 300;
const DOUBLE_CLICK_MOVE_PX = 10;
/** Viewport padding added on each side when searching for same-type units (px). */
const DOUBLE_CLICK_SCREEN_PAD = 200;

interface SelectModeData {
    lastClickTime: number;
    lastClickX: number;
    lastClickY: number;
    lastClickEntityId: number | null;
}

/**
 * Select mode - default mode for selecting entities and issuing commands.
 *
 * Left click:           Select entity at tile (replaces selection)
 * Double-left click:    Select all units of the same type visible on screen
 * Shift+left click:     Add/remove entity from selection (toggle)
 * Left drag:            Box select all units in rectangle
 * Right click:          Move selected units to target (with formation)
 * Delete/Backspace:     Remove selected entity
 * Escape:               Deselect all
 * U:                    Spawn carrier at hovered tile
 * I:                    Spawn swordsman at hovered tile
 */
export class SelectMode extends BaseInputMode {
    readonly name = 'select';
    readonly displayName = 'Select';

    override onAction(action: InputAction, context: InputContext): InputResult {
        // Only handles actions relevant to select mode; others fall through to UNHANDLED
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- partial: unknown actions fall through to UNHANDLED
        switch (action) {
            case InputAction.DeselectAll:
                context.executeCommand({ type: 'select', entityId: null });
                return HANDLED;

            case InputAction.Delete: {
                const data = context.getModeData<{ selectedEntityId: number | null }>();
                if (data?.selectedEntityId != null) {
                    context.executeCommand({ type: 'remove_entity', entityId: data.selectedEntityId });
                }
                return HANDLED;
            }

            case InputAction.SpawnCarrier: {
                const tile = context.currentTile;
                const race = context.localPlayerRace;
                if (tile && race !== null) {
                    context.executeCommand({
                        type: 'spawn_unit',
                        unitType: UnitType.Carrier,
                        x: tile.x,
                        y: tile.y,
                        player: 0,
                        race,
                    });
                }
                return HANDLED;
            }

            case InputAction.SpawnSwordsman: {
                const tile = context.currentTile;
                const race = context.localPlayerRace;
                if (tile && race !== null) {
                    context.executeCommand({
                        type: 'spawn_unit',
                        unitType: UnitType.Swordsman1,
                        x: tile.x,
                        y: tile.y,
                        player: 0,
                        race,
                    });
                }
                return HANDLED;
            }

            default:
                return UNHANDLED;
        }
    }

    override onPointerDown(data: PointerData, context: InputContext): InputResult {
        if (data.button === MouseButton.Left) {
            // Start potential drag selection
            context.state.startDrag(data.screenX, data.screenY, data.button, data.tileX, data.tileY);
            return HANDLED;
        }
        return UNHANDLED;
    }

    override onPointerUp(data: PointerData, context: InputContext): InputResult {
        const dragData = context.state.endDrag();

        if (data.button === MouseButton.Left) {
            if (dragData?.isDragging) {
                // Drag selection completed - handled by onDragEnd
                return HANDLED;
            }

            const prev = context.getModeData<SelectModeData>();
            const now = performance.now();
            const pickedId = context.pickEntityAtScreen?.(data.screenX, data.screenY) ?? null;

            const isDoubleClick =
                prev !== undefined &&
                pickedId !== null &&
                pickedId === prev.lastClickEntityId &&
                now - prev.lastClickTime < DOUBLE_CLICK_MS &&
                Math.abs(data.screenX - prev.lastClickX) < DOUBLE_CLICK_MOVE_PX &&
                Math.abs(data.screenY - prev.lastClickY) < DOUBLE_CLICK_MOVE_PX;

            if (isDoubleClick) {
                this.handleDoubleClickSelect(pickedId, data, context);
            } else {
                this.handleClickSelect(pickedId, data, context);
                context.setModeData<SelectModeData>({
                    lastClickTime: now,
                    lastClickX: data.screenX,
                    lastClickY: data.screenY,
                    lastClickEntityId: pickedId,
                });
            }
            return HANDLED;
        }

        if (data.button === MouseButton.Right) {
            if (data.tileX !== undefined && data.tileY !== undefined) {
                this.handleRightClick(data, context);
            }
            return HANDLED;
        }

        return UNHANDLED;
    }

    /** Handle single-click entity selection with sprite-bounds picking. */
    private handleClickSelect(pickedId: number | null, data: PointerData, context: InputContext): void {
        if (pickedId !== null) {
            if (data.shiftKey) {
                context.executeCommand({ type: 'toggle_selection', entityId: pickedId });
            } else {
                context.executeCommand({ type: 'select', entityId: pickedId });
            }
        } else if (data.tileX !== undefined && data.tileY !== undefined) {
            context.executeCommand({
                type: 'select_at_tile',
                x: data.tileX,
                y: data.tileY,
                addToSelection: data.shiftKey,
            });
        } else {
            context.executeCommand({ type: 'select', entityId: null });
        }
    }

    /**
     * Handle right-click: garrison selected military units into a clicked building,
     * or move selected units to target tile.
     *
     * Three outcomes:
     * - success → done (units en-route, selection cleared)
     * - not_garrison_building → fall back to move_selected_units
     * - garrison_building_blocked → show hint near cursor; do NOT move (tile is inside building)
     */
    private handleRightClick(data: PointerData, context: InputContext): void {
        const tileX = data.tileX!;
        const tileY = data.tileY!;
        // Try to garrison selected military units into the building at this tile.
        // Uses tile coords (not sprite pick) so clicking anywhere on the building works.
        const garrisonResult = context.executeCommand({ type: 'garrison_selected_units', tileX, tileY });
        if (!garrisonResult.success) {
            if (garrisonResult.error === 'not_garrison_building') {
                context.executeCommand({ type: 'move_selected_units', targetX: tileX, targetY: tileY });
            } else {
                // Garrison building rejected the units — show feedback, but do NOT move (tile is inside building).
                context.showHint?.(garrisonResult.error, data.screenX, data.screenY);
            }
        }
    }

    /** Handle double-click: select all units of the same type visible on screen. */
    private handleDoubleClickSelect(seedEntityId: number, _data: PointerData, context: InputContext): void {
        // Use a large screen rect with padding — the picker clips to rendered entities anyway.
        /* eslint-disable no-restricted-syntax -- pickEntitiesInScreenRect is nullable-by-design (null in tests/non-interactive contexts per InputContext interface); [] is correct when unavailable */
        const candidateIds =
            context.pickEntitiesInScreenRect?.(
                -DOUBLE_CLICK_SCREEN_PAD,
                -DOUBLE_CLICK_SCREEN_PAD,
                window.innerWidth + DOUBLE_CLICK_SCREEN_PAD,
                window.innerHeight + DOUBLE_CLICK_SCREEN_PAD
            ) ?? [];
        /* eslint-enable no-restricted-syntax */
        context.executeCommand({ type: 'select_same_unit_type', seedEntityId, candidateIds });
    }

    override onDrag(_data: DragData, _context: InputContext): InputResult {
        // Visual feedback for drag selection - the selection box is drawn via getRenderState
        return HANDLED;
    }

    override onDragEnd(data: DragData, context: InputContext): InputResult {
        if (data.button === MouseButton.Left && data.isDragging) {
            // Box selection — try sprite-bounds picker first, fall back to tile-based
            const pickedIds = context.pickEntitiesInScreenRect?.(
                data.startX,
                data.startY,
                data.currentX,
                data.currentY
            );
            if (pickedIds && pickedIds.length > 0) {
                context.executeCommand({ type: 'select_multiple', entityIds: pickedIds });
            } else if (
                data.startTileX !== undefined &&
                data.startTileY !== undefined &&
                data.currentTileX !== undefined &&
                data.currentTileY !== undefined
            ) {
                context.executeCommand({
                    type: 'select_area',
                    x1: data.startTileX,
                    y1: data.startTileY,
                    x2: data.currentTileX,
                    y2: data.currentTileY,
                });
            }
            return HANDLED;
        }
        return UNHANDLED;
    }

    override getRenderState(context: InputContext): ModeRenderState {
        const dragState = context.state.getDragState();
        const currentTile = context.currentTile;

        // Check if we're actively dragging a selection box
        if (dragState?.isDragging && dragState.button === MouseButton.Left) {
            const selectionBox: SelectionBox = {
                type: 'selection_box',
                // eslint-disable-next-line no-restricted-syntax -- nullable-by-design: tile coords absent when drag starts off-map; 0 is a safe visual fallback for the selection box outline
                startTileX: dragState.startTileX ?? 0,
                // eslint-disable-next-line no-restricted-syntax -- nullable-by-design: tile coords absent when drag starts off-map; 0 is a safe visual fallback for the selection box outline
                startTileY: dragState.startTileY ?? 0,
                // eslint-disable-next-line no-restricted-syntax -- nullable-by-design: tile coords absent when drag ends off-map; 0 is a safe visual fallback for the selection box outline
                endTileX: dragState.currentTileX ?? 0,
                // eslint-disable-next-line no-restricted-syntax -- nullable-by-design: tile coords absent when drag ends off-map; 0 is a safe visual fallback for the selection box outline
                endTileY: dragState.currentTileY ?? 0,
                startScreenX: dragState.startX,
                startScreenY: dragState.startY,
                endScreenX: dragState.currentX,
                endScreenY: dragState.currentY,
            };

            return {
                cursor: CursorType.Crosshair,
                preview: selectionBox,
                hoverTile: currentTile,
            };
        }

        // Default state - show pointer and hover tile
        return {
            cursor: CursorType.Default,
            hoverTile: currentTile,
        };
    }
}
