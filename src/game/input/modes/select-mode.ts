import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData, type DragData } from '../input-actions';
import { EntityType } from '../../entity';

/**
 * Formation offsets for unit movement commands.
 * Units spread out in a formation pattern when given move orders.
 */
const FORMATION_OFFSETS: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0], [0, 1], [-1, 0], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [0, 2], [-2, 0], [0, -2],
    [2, 1], [1, 2], [-1, 2], [-2, 1],
    [-2, -1], [-1, -2], [1, -2], [2, -1],
    [2, 2], [-2, 2], [2, -2], [-2, -2],
];

/**
 * Select mode - default mode for selecting entities and issuing commands.
 */
export class SelectMode extends BaseInputMode {
    readonly name = 'select';
    readonly displayName = 'Select';

    onAction(action: InputAction, context: InputContext): InputResult {
        switch (action) {
            case InputAction.DeselectAll:
                context.executeCommand({ type: 'select', entityId: null });
                return HANDLED;

            case InputAction.Delete:
                // Delete selected entity if any
                const data = context.getModeData<{ selectedEntityId: number | null }>();
                if (data?.selectedEntityId != null) {
                    context.executeCommand({ type: 'remove_entity', entityId: data.selectedEntityId });
                }
                return HANDLED;

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
                this.handleSelect(data.tileX, data.tileY, data.shiftKey, context);
            }
            return HANDLED;
        }

        if (data.button === MouseButton.Right) {
            // Right click - issue move command to selected units
            if (data.tileX !== undefined && data.tileY !== undefined) {
                this.handleMoveCommand(data.tileX, data.tileY, context);
            }
            return HANDLED;
        }

        return UNHANDLED;
    }

    onDrag(data: DragData, context: InputContext): InputResult {
        // Visual feedback for drag selection would go here
        // The actual selection happens on drag end
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

    private handleSelect(tileX: number, tileY: number, addToSelection: boolean, context: InputContext): void {
        // Get entity at tile (this would need to be exposed via context)
        // For now, we just send the select command and let the game handle it
        context.executeCommand({
            type: 'select_at_tile',
            x: tileX,
            y: tileY,
            addToSelection,
        });
    }

    private handleMoveCommand(tileX: number, tileY: number, context: InputContext): void {
        // Get selected units and issue move commands with formation
        const modeData = context.getModeData<{
            selectedUnits: number[];
        }>();

        const units = modeData?.selectedUnits ?? [];

        for (let i = 0; i < units.length; i++) {
            const offset = FORMATION_OFFSETS[Math.min(i, FORMATION_OFFSETS.length - 1)];
            context.executeCommand({
                type: 'move_unit',
                entityId: units[i],
                targetX: tileX + offset[0],
                targetY: tileY + offset[1],
            });
        }
    }
}
