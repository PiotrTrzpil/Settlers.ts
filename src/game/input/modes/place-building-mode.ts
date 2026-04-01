import { BasePlacementMode, type PlacementModeData, type PlacementModeEnterData } from './place-mode-base';
import type { InputContext } from '../input-mode';
import { BuildingType } from '../../entity';
import type { Race } from '../../core/race';
import type { PlacementEntityType } from '../render-state';
import type { TerrainData } from '../../terrain';
import type { ValidPositionGrid } from '../../systems/placement/valid-position-grid';

/** Everything PlaceBuildingMode needs from the game. */
export interface BuildingPlacementContext {
    readonly terrain: TerrainData;
    readonly groundOccupancy: Map<string, number>;
    readonly currentPlayer: number;
    readonly playerRace: Race;
    readonly placeBuildingsCompleted: boolean;
    readonly placeBuildingsWithWorker: boolean;
}

/**
 * Building-specific mode data.
 * Extends base placement data with building type.
 */
export interface PlaceBuildingModeData extends PlacementModeData<BuildingType> {
    // Building type is stored in subType
    // Kept for backward compatibility in external code
    buildingType: BuildingType;
    /** Race for the placed building */
    race: Race;
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
    protected override readonly resetAfterPlace = true;

    private grid: ValidPositionGrid | null = null;

    setGrid(grid: ValidPositionGrid | null): void {
        this.grid = grid;
    }

    constructor(
        validateFn: (x: number, y: number, buildingType: BuildingType) => boolean,
        private readonly getCommandContext?: () => Pick<
            BuildingPlacementContext,
            'placeBuildingsCompleted' | 'placeBuildingsWithWorker'
        >
    ) {
        super(validateFn);
    }

    protected override isPositionValid(x: number, y: number, _buildingType: BuildingType): boolean {
        // eslint-disable-next-line no-restricted-syntax -- nullable-by-design: grid is null until setGrid() is called; false (invalid) is correct before grid is ready
        return this.grid?.isValid(x, y) ?? false;
    }

    protected getCommandType(): string {
        return 'place_building';
    }

    protected getSubTypeName(subType: BuildingType): string {
        return subType;
    }

    /**
     * Calculate anchor position by centering the building footprint on cursor.
     * Uses XML hotspot to offset from cursor to the building's anchor point.
     */
    protected resolveAnchorPosition(
        tileX: number,
        tileY: number,
        _buildingType: BuildingType
    ): { x: number; y: number } {
        return { x: tileX, y: tileY };
    }

    protected createPlacementCommand(
        x: number,
        y: number,
        data: PlacementModeData<BuildingType>
    ): Record<string, unknown> {
        const settings = this.getCommandContext?.();
        return {
            type: this.getCommandType(),
            buildingType: data.subType,
            x,
            y,
            player: this.currentPlayer,
            race: data.race!,
            trusted: this.grid !== null,
            ...(settings?.placeBuildingsCompleted && { completed: true }),
            ...(settings?.placeBuildingsWithWorker && { spawnWorker: true }),
        };
    }

    /**
     * Initialize mode data from validated enter data.
     * Note: onEnter ensures buildingType is always defined before calling this.
     */
    protected override initializeModeData(enterData: PlaceBuildingEnterData): PlaceBuildingModeData {
        // buildingType is guaranteed by onEnter validation
        const buildingType = enterData.buildingType;

        return {
            subType: buildingType,
            buildingType,
            race: enterData.race!,
            previewX: 0,
            previewY: 0,
            previewValid: false,
            extra: {},
        };
    }

    /** Notify the grid that a building was placed so it can update. */
    notifyPlacement(x: number, y: number, buildingType: BuildingType, race: Race): void {
        this.grid?.patchAfterPlacement(x, y, buildingType, race);
    }

    /**
     * Handle enter with backward-compatible data format.
     */
    override onEnter(context: InputContext, enterData?: PlacementModeEnterData<BuildingType>): void {
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
}
