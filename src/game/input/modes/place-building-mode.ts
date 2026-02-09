import { BasePlacementMode, type PlacementModeData, type PlacementModeEnterData } from './place-mode-base';
import type { InputContext } from '../input-mode';
import { BuildingType, getBuildingSize } from '../../entity';
import type { PlacementEntityType } from '../render-state';

/**
 * Building-specific mode data.
 * Extends base placement data with building type.
 */
export interface PlaceBuildingModeData extends PlacementModeData<BuildingType> {
    // Building type is stored in subType
    // Kept for backward compatibility in external code
    buildingType: BuildingType;
}

/**
 * Enter data for building placement mode.
 */
export interface PlaceBuildingEnterData extends PlacementModeEnterData<BuildingType> {
    /** The building type to place (alias for subType) */
    buildingType: BuildingType;
}

/**
 * Building placement mode - for placing new buildings on the map.
 *
 * Key behaviors:
 * - Preview position is centered on cursor based on building footprint size
 * - Supports multi-tile building footprints
 * - Validates terrain, occupancy, and slope
 */
export class PlaceBuildingMode extends BasePlacementMode<BuildingType> {
    readonly name = 'place_building';
    readonly displayName = 'Place Building';
    readonly entityType: PlacementEntityType = 'building';

    protected getCommandType(): string {
        return 'place_building';
    }

    protected getSubTypeName(subType: BuildingType): string {
        return BuildingType[subType] ?? `Building#${subType}`;
    }

    /**
     * Calculate anchor position by centering the building footprint on cursor.
     */
    protected resolveAnchorPosition(
        tileX: number,
        tileY: number,
        buildingType: BuildingType
    ): { x: number; y: number } {
        const size = getBuildingSize(buildingType);
        return {
            x: Math.round(tileX - (size.width - 1) / 2),
            y: Math.round(tileY - (size.height - 1) / 2),
        };
    }

    protected createPlacementCommand(
        x: number,
        y: number,
        data: PlacementModeData<BuildingType>
    ): Record<string, unknown> {
        return {
            type: this.getCommandType(),
            buildingType: data.subType,
            x,
            y,
            player: this.currentPlayer,
        };
    }

    /**
     * Initialize mode data from validated enter data.
     * Note: onEnter ensures buildingType is always defined before calling this.
     */
    protected override initializeModeData(
        enterData: PlaceBuildingEnterData
    ): PlaceBuildingModeData {
        // buildingType is guaranteed by onEnter validation
        const buildingType = enterData.buildingType;

        return {
            subType: buildingType,
            buildingType,
            previewX: 0,
            previewY: 0,
            previewValid: false,
            extra: {},
        };
    }

    /**
     * Handle enter with backward-compatible data format.
     */
    override onEnter(
        context: InputContext,
        enterData?: PlacementModeEnterData<BuildingType>
    ): void {
        // Support both buildingType and subType for backward compatibility
        const legacyData = enterData as PlaceBuildingEnterData | undefined;
        const buildingType = legacyData?.buildingType ?? enterData?.subType;

        // Validate before calling super (consistent with PlaceResourceMode)
        if (buildingType === undefined) {
            context.switchMode('select');
            return;
        }

        const normalizedData: PlaceBuildingEnterData = {
            ...enterData,
            subType: buildingType,
            buildingType,
        };

        super.onEnter(context, normalizedData);
    }

    /**
     * Set the placement validator function.
     * Overloaded for backward compatibility with building-specific signature.
     */
    override setValidator(
        context: InputContext,
        validator: (x: number, y: number, buildingType: BuildingType) => boolean
    ): void {
        super.setValidator(context, validator);
    }
}
