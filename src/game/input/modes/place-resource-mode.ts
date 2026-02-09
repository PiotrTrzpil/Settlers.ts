import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData } from '../input-actions';
import { EMaterialType } from '../../economy/material-type';
import { CursorType, type ModeRenderState } from '../render-state';
import { LogHandler } from '../../../utilities/log-handler';

/**
 * Data specific to resource placement mode.
 */
export interface PlaceResourceModeData {
    /** The material type being placed */
    materialType: EMaterialType;
    /** Current preview position */
    previewX: number;
    previewY: number;
    /** Whether current preview position is valid */
    previewValid: boolean;
    /** Validation function */
    validatePlacement?: (x: number, y: number) => boolean;
    /** Quantity to place (1-8) */
    amount: number;
}

/**
 * Resource placement mode - for placing resources on the map.
 */
export class PlaceResourceMode extends BaseInputMode {
    private static readonly log = new LogHandler('PlaceResourceMode');
    readonly name = 'place_resource';
    readonly displayName = 'Place Resource';

    onEnter(context: InputContext, data?: { resourceType?: EMaterialType; materialType?: EMaterialType; amount?: number }): void {
        const materialType = data?.materialType ?? data?.resourceType; // Support both for migration
        if (materialType === undefined) {
            // No resource type specified, switch back to select
            context.switchMode('select');
            return;
        }

        context.setModeData<PlaceResourceModeData>({
            materialType,
            amount: data?.amount ?? 1,
            previewX: 0,
            previewY: 0,
            previewValid: false,
        });
    }

    onExit(context: InputContext): void {
        // Clear preview
        context.setModeData<PlaceResourceModeData | undefined>(undefined);
    }

    onAction(action: InputAction, context: InputContext): InputResult {
        switch (action) {
        case InputAction.CancelPlacement:
        case InputAction.DeselectAll:
            context.switchMode('select');
            return HANDLED;

        default:
            return UNHANDLED;
        }
    }

    onPointerUp(data: PointerData, context: InputContext): InputResult {
        const modeData = context.getModeData<PlaceResourceModeData>();
        if (!modeData) return UNHANDLED;

        if (data.button === MouseButton.Left) {
            // Try to place resource
            if (data.tileX !== undefined && data.tileY !== undefined) {
                const success = context.executeCommand({
                    type: 'place_resource',
                    materialType: modeData.materialType,
                    amount: modeData.amount,
                    x: data.tileX,
                    y: data.tileY,
                });

                if (success) {
                    PlaceResourceMode.log.info(`Placed material ${EMaterialType[modeData.materialType]} at ${data.tileX},${data.tileY}`);
                } else {
                    PlaceResourceMode.log.warn(`Failed to place material at ${data.tileX},${data.tileY} (Occupied?)`);
                }
            } else {
                PlaceResourceMode.log.warn('Click ignored: No tile under cursor');
            }
            return HANDLED;
        }

        if (data.button === MouseButton.Right) {
            // Right click cancels placement
            context.switchMode('select');
            return HANDLED;
        }

        return UNHANDLED;
    }

    onPointerMove(data: PointerData, context: InputContext): InputResult {
        const modeData = context.getModeData<PlaceResourceModeData>();
        if (!modeData || data.tileX === undefined || data.tileY === undefined) {
            return UNHANDLED;
        }

        // Update preview position
        modeData.previewX = data.tileX;
        modeData.previewY = data.tileY;

        if (modeData.validatePlacement) {
            modeData.previewValid = modeData.validatePlacement(data.tileX, data.tileY);
        } else {
            modeData.previewValid = true;
        }

        context.setModeData(modeData);
        return HANDLED;
    }

    override getRenderState(context: InputContext): ModeRenderState {
        const modeData = context.getModeData<PlaceResourceModeData>();

        if (!modeData) {
            return {
                cursor: CursorType.Crosshair,
            };
        }

        return {
            cursor: modeData.previewValid ? CursorType.Crosshair : CursorType.NotAllowed,
            preview: {
                type: 'resource',
                materialType: modeData.materialType,
                amount: modeData.amount, // Pass amount for variation rendering
                x: modeData.previewX,
                y: modeData.previewY,
                valid: modeData.previewValid,
            },
            hoverTile: {
                x: modeData.previewX,
                y: modeData.previewY,
            },
            statusText: `Place Resource ${EMaterialType[modeData.materialType]} (x${modeData.amount})`,
        };
    }
}
