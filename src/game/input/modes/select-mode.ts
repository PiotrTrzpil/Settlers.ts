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
 * U:                 Spawn carrier at hovered tile
 * I:                 Spawn swordsman at hovered tile
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
                    unitType: 0, // Carrier
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
                    unitType: 2, // Swordsman
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
            this.handleClickSelect(data, context);
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

    /** Handle single-click entity selection with sprite-bounds picking. */
    private handleClickSelect(data: PointerData, context: InputContext): void {
        // Try sprite-bounds pick first, fall back to tile pick
        const pickedId = context.pickEntityAtScreen?.(data.screenX, data.screenY) ?? null;
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
