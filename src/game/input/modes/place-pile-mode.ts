import { BasePlacementMode, type PlacementModeData, type PlacementModeEnterData } from './place-mode-base';
import type { InputContext } from '../input-mode';
import { EMaterialType } from '../../economy';
import type { PlacementEntityType } from '../render-state';
import type { Tile } from '@/game/core/coordinates';

/**
 * Resource-specific mode data.
 * Extends base placement data with material type and amount.
 */
export interface PlacePileModeData extends PlacementModeData<EMaterialType> {
    /** The material type being placed (alias for subType) */
    materialType: EMaterialType;
    /** Quantity to place (1-8) */
    amount: number;
}

/**
 * Enter data for resource placement mode.
 */
export interface PlacePileEnterData extends PlacementModeEnterData<EMaterialType> {
    /** The material type to place (alias for subType) */
    materialType?: EMaterialType;
    /** Legacy alias for materialType */
    resourceType?: EMaterialType;
    /** Quantity to place (1-8) */
    amount: number;
}

/**
 * Resource placement mode - for placing resources on the map.
 *
 * Key behaviors:
 * - Resources are placed directly at cursor position (no centering)
 * - Supports variable amounts (1-8 stacked resources)
 * - Validates terrain passability and tile occupancy
 */
export class PlacePileMode extends BasePlacementMode<EMaterialType> {
    readonly name = 'place_pile';
    readonly displayName = 'Place Resource';
    readonly entityType: PlacementEntityType = 'pile';

    protected getCommandType(): string {
        return 'place_pile';
    }

    protected getSubTypeName(subType: EMaterialType): string {
        return subType;
    }

    /**
     * Resources are placed directly at cursor position (no offset).
     */
    protected resolveAnchorPosition(tileX: number, tileY: number, _materialType: EMaterialType): Tile {
        return { x: tileX, y: tileY };
    }

    protected createPlacementCommand(
        x: number,
        y: number,
        data: PlacementModeData<EMaterialType>
    ): Record<string, unknown> {
        const amount = data.extra['amount'] as number;
        return {
            type: this.getCommandType(),
            materialType: data.subType,
            amount,
            x,
            y,
        };
    }

    /**
     * Initialize mode data, handling multiple legacy enter data formats.
     * Note: This is only called after onEnter validates materialType exists.
     */
    protected override initializeModeData(enterData: PlacePileEnterData): PlacePileModeData {
        // Support materialType, resourceType, and subType for backward compatibility
        // Non-null assertion is safe because onEnter validates before calling this
        const materialType = (enterData.materialType ?? enterData.resourceType ?? enterData.subType)!;
        const amount = enterData.amount;

        return {
            subType: materialType,
            materialType,
            amount,
            previewX: 0,
            previewY: 0,
            previewValid: false,
            extra: { amount },
        };
    }

    /**
     * Handle enter with backward-compatible data format.
     */
    override onEnter(context: InputContext, enterData?: PlacementModeEnterData<EMaterialType>): void {
        // Support multiple legacy property names
        const legacyData = enterData as PlacePileEnterData | undefined;
        const materialType = legacyData?.materialType ?? legacyData?.resourceType ?? enterData?.subType;

        if (materialType === undefined) {
            context.switchMode('select');
            return;
        }

        const normalizedData: PlacePileEnterData = {
            ...enterData,
            subType: materialType,
            materialType,
            // eslint-disable-next-line no-restricted-syntax -- external input: enterData is cast from untyped switchMode data; 1 is correct fallback
            amount: legacyData?.amount ?? 1,
        };

        super.onEnter(context, normalizedData);
    }

    /**
     * Get extra preview data including amount for rendering.
     */
    protected override getPreviewExtra(data: PlacementModeData<EMaterialType>): Record<string, unknown> {
        return {
            ...data.extra,
            amount: (data as PlacePileModeData).amount,
        };
    }

    /**
     * Custom status text showing resource type and amount.
     */
    protected override getStatusText(data: PlacementModeData<EMaterialType>): string {
        const typeName = this.getSubTypeName(data.subType);
        const amount = (data as PlacePileModeData).amount;
        return `Place Resource ${typeName} (x${amount})`;
    }
}
