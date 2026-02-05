import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData } from '../input-actions';
import { BuildingType, getBuildingSize } from '../../entity';

/**
 * Data specific to building placement mode.
 */
export interface PlaceBuildingModeData {
    /** The building type being placed */
    buildingType: BuildingType;
    /** Current preview position (anchor/top-left) */
    previewX: number;
    previewY: number;
    /** Whether current preview position is valid */
    previewValid: boolean;
    /** Validation function */
    validatePlacement?: (x: number, y: number, buildingType: BuildingType) => boolean;
}

/**
 * Building placement mode - for placing new buildings on the map.
 */
export class PlaceBuildingMode extends BaseInputMode {
    readonly name = 'place_building';
    readonly displayName = 'Place Building';

    private currentPlayer = 0;

    onEnter(context: InputContext, data?: { buildingType: BuildingType; player?: number }): void {
        if (!data?.buildingType) {
            // No building type specified, switch back to select
            context.switchMode('select');
            return;
        }

        this.currentPlayer = data.player ?? 0;

        context.setModeData<PlaceBuildingModeData>({
            buildingType: data.buildingType,
            previewX: 0,
            previewY: 0,
            previewValid: false,
        });
    }

    onExit(context: InputContext): void {
        // Clear preview
        context.setModeData<PlaceBuildingModeData | undefined>(undefined);
    }

    onAction(action: InputAction, context: InputContext): InputResult {
        switch (action) {
            case InputAction.CancelPlacement:
            case InputAction.DeselectAll:
                context.switchMode('select');
                return HANDLED;

            case InputAction.RotateBuilding:
                // Future: implement building rotation
                return HANDLED;

            default:
                return UNHANDLED;
        }
    }

    onPointerUp(data: PointerData, context: InputContext): InputResult {
        const modeData = context.getModeData<PlaceBuildingModeData>();
        if (!modeData) return UNHANDLED;

        if (data.button === MouseButton.Left) {
            // Try to place building
            if (modeData.previewValid) {
                const success = context.executeCommand({
                    type: 'place_building',
                    buildingType: modeData.buildingType,
                    x: modeData.previewX,
                    y: modeData.previewY,
                    player: this.currentPlayer,
                });

                // Optionally stay in placement mode for rapid building
                // or switch back to select mode after placement
                // For now, stay in placement mode
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
        const modeData = context.getModeData<PlaceBuildingModeData>();
        if (!modeData || data.tileX === undefined || data.tileY === undefined) {
            return UNHANDLED;
        }

        // Calculate building anchor position (top-left, centered on cursor)
        const size = getBuildingSize(modeData.buildingType);
        const anchorX = Math.round(data.tileX - (size.width - 1) / 2);
        const anchorY = Math.round(data.tileY - (size.height - 1) / 2);

        // Update preview position
        modeData.previewX = anchorX;
        modeData.previewY = anchorY;

        // Validate placement if validator is available
        if (modeData.validatePlacement) {
            modeData.previewValid = modeData.validatePlacement(anchorX, anchorY, modeData.buildingType);
        } else {
            // Default to valid if no validator
            modeData.previewValid = true;
        }

        context.setModeData(modeData);
        return HANDLED;
    }

    /**
     * Set the placement validator function.
     */
    setValidator(
        context: InputContext,
        validator: (x: number, y: number, buildingType: BuildingType) => boolean
    ): void {
        const modeData = context.getModeData<PlaceBuildingModeData>();
        if (modeData) {
            modeData.validatePlacement = validator;
            context.setModeData(modeData);
        }
    }
}
