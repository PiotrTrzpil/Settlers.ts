import { BasePlacementMode, type PlacementModeData, type PlacementModeEnterData } from './place-mode-base';
import type { InputContext } from '../input-mode';
import { UnitType } from '../../entity';
import type { PlacementEntityType } from '../render-state';

/**
 * Unit-specific mode data.
 * Extends base placement data with unit type.
 */
export interface PlaceUnitModeData extends PlacementModeData<UnitType> {
    /** The unit type being placed (alias for subType) */
    unitType: UnitType;
}

/**
 * Enter data for unit placement mode.
 */
export interface PlaceUnitEnterData extends PlacementModeEnterData<UnitType> {
    /** The unit type to place (alias for subType) */
    unitType?: UnitType;
}

/**
 * Unit placement mode - for placing units (settlers) on the map.
 *
 * Key behaviors:
 * - Units are placed directly at cursor position
 * - Validates terrain passability and tile occupancy
 * - Similar to resource placement but for units
 */
export class PlaceUnitMode extends BasePlacementMode<UnitType> {
    readonly name = 'place_unit';
    readonly displayName = 'Place Unit';
    readonly entityType: PlacementEntityType = 'unit';

    protected getCommandType(): string {
        return 'spawn_unit';
    }

    protected getSubTypeName(subType: UnitType): string {
        return UnitType[subType] ?? `Unit#${subType}`;
    }

    /**
     * Units are placed directly at cursor position (no offset).
     */
    protected resolveAnchorPosition(
        tileX: number,
        tileY: number,
        _unitType: UnitType
    ): { x: number; y: number } {
        return { x: tileX, y: tileY };
    }

    protected createPlacementCommand(
        x: number,
        y: number,
        data: PlacementModeData<UnitType>
    ): Record<string, unknown> {
        return {
            type: this.getCommandType(),
            unitType: data.subType,
            x,
            y,
            player: 0, // TODO: Get from current player context
        };
    }

    /**
     * Initialize mode data, handling multiple enter data formats.
     */
    protected override initializeModeData(
        enterData: PlaceUnitEnterData
    ): PlaceUnitModeData {
        // Support unitType and subType for flexibility
        const unitType = (enterData.unitType ?? enterData.subType)!;

        return {
            subType: unitType,
            unitType,
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
        enterData?: PlacementModeEnterData<UnitType>
    ): void {
        const legacyData = enterData as PlaceUnitEnterData | undefined;
        const unitType = legacyData?.unitType ?? enterData?.subType;

        if (unitType === undefined) {
            context.switchMode('select');
            return;
        }

        const normalizedData: PlaceUnitEnterData = {
            ...enterData,
            subType: unitType,
            unitType,
        };

        super.onEnter(context, normalizedData);
    }

    /**
     * Custom status text showing unit type.
     */
    protected override getStatusText(data: PlacementModeData<UnitType>): string {
        const typeName = this.getSubTypeName(data.subType);
        return `Place Unit: ${typeName}`;
    }
}
