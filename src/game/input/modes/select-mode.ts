import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData, type DragData } from '../input-actions';
import { CursorType, type ModeRenderState, type SelectionBox } from '../render-state';

/**
 * Select mode - default mode for selecting entities and issuing commands.
 *
 * Left click:        Select entity at tile (replaces selection)
 * Shift+left click:  Add/remove entity from selection (toggle)
 * Left drag:         Box select all units in rectangle
 * Right click:       Move selected units to target (with formation)
 * Delete/Backspace:  Remove selected entity
 * Escape:            Deselect all
 * U:                 Spawn bearer at hovered tile
 * I:                 Spawn swordsman at hovered tile
 */
export class SelectMode extends BaseInputMode {
    readonly name = 'select';
    readonly displayName = 'Select';

    onAction(action: InputAction, context: InputContext): InputResult {
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

        case InputAction.SpawnBearer: {
            const tile = context.currentTile;
            if (tile) {
                context.executeCommand({
                    type: 'spawn_unit',
                    unitType: 0, // Bearer
                    x: tile.x,
                    y: tile.y,
                    player: 0,
                });
            }
            return HANDLED;
        }

        case InputAction.SpawnSwordsman: {
            const tile = context.currentTile;
            if (tile) {
                context.executeCommand({
                    type: 'spawn_unit',
                    unitType: 2, // Swordsman
                    x: tile.x,
                    y: tile.y,
                    player: 0,
                });
            }
            return HANDLED;
        }

        default:
            return UNHANDLED;
        }
    }

    onPointerDown(data: PointerData, context: InputContext): InputResult {
        if (data.button === MouseButton.Left) {
            // Start potential drag selection
            context.state.startDrag(
                data.screenX,
                data.screenY,
                data.button,
                data.tileX,
                data.tileY
            );
            return HANDLED;
        }
        return UNHANDLED;
    }

    onPointerUp(data: PointerData, context: InputContext): InputResult {
        const dragData = context.state.endDrag();

        if (data.button === MouseButton.Left) {
            if (dragData?.isDragging) {
                // Drag selection completed - handled by onDragEnd
                return HANDLED;
            }

            // Single click - select entity at tile
            if (data.tileX !== undefined && data.tileY !== undefined) {
                context.executeCommand({
                    type: 'select_at_tile',
                    x: data.tileX,
                    y: data.tileY,
                    addToSelection: data.shiftKey,
                });
            }
            return HANDLED;
        }

        if (data.button === MouseButton.Right) {
            // Right click - move selected units to target with formation
            if (data.tileX !== undefined && data.tileY !== undefined) {
                context.executeCommand({
                    type: 'move_selected_units',
                    targetX: data.tileX,
                    targetY: data.tileY,
                });
            }
            return HANDLED;
        }

        return UNHANDLED;
    }

    onDrag(_data: DragData, _context: InputContext): InputResult {
        // Visual feedback for drag selection - the selection box is drawn via getRenderState
        return HANDLED;
    }

    onDragEnd(data: DragData, context: InputContext): InputResult {
        if (data.button === MouseButton.Left && data.isDragging) {
            // Box selection
            if (data.startTileX !== undefined && data.startTileY !== undefined &&
                data.currentTileX !== undefined && data.currentTileY !== undefined) {
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
                startTileX: dragState.startTileX ?? 0,
                startTileY: dragState.startTileY ?? 0,
                endTileX: dragState.currentTileX ?? 0,
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
