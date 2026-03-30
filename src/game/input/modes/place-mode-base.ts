import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData } from '../input-actions';
import { CursorType, type ModeRenderState, type PlacementPreview, type PlacementEntityType } from '../render-state';
import type { Race } from '../../core/race';
import { LogHandler } from '../../../utilities/log-handler';

/**
 * Generic data for any placement mode.
 * The subType field holds the specific type (BuildingType, EMaterialType, etc).
 */
export interface PlacementModeData<TSubType = number> {
    /** The specific entity subtype being placed */
    subType: TSubType;
    /** Race for the entity being placed (Race enum value). Only for buildings/units. */
    race?: Race;
    /** Current preview anchor position X */
    previewX: number;
    /** Current preview anchor position Y */
    previewY: number;
    /** Whether current preview position is valid */
    previewValid: boolean;
    /** Additional data specific to the entity type */
    extra: Record<string, unknown>;
}

/**
 * Configuration for entering a placement mode.
 * Note: subType is optional to support legacy entry data formats where
 * type-specific properties (buildingType, materialType) are used instead.
 */
export interface PlacementModeEnterData<TSubType = number> {
    /** The specific entity subtype to place (can be omitted if type-specific property is provided) */
    subType?: TSubType;
    /** Player placing the entity (optional, defaults to current player) */
    player?: number;
    /** Race for the entity being placed (Race enum value). Only for buildings/units. */
    race?: Race;
    /** Additional configuration data */
    [key: string]: unknown;
}

/**
 * Abstract base class for all placement modes.
 * Handles common placement logic: preview position tracking, validation,
 * click-to-place, right-click-to-cancel, and render state generation.
 *
 * Subclasses implement entity-specific behavior through abstract methods.
 */
export abstract class BasePlacementMode<TSubType = number> extends BaseInputMode {
    protected static readonly baseLog = new LogHandler('BasePlacementMode');

    /** The entity type this mode places (for preview type discrimination) */
    abstract readonly entityType: PlacementEntityType;

    /** Current player placing entities */
    protected currentPlayer = 0;

    /** Whether to reset to select mode after a successful placement (buildings: true, units/resources: false) */
    protected readonly resetAfterPlace: boolean = false;

    /** Whether a drag-place is in progress (left button held) */
    private dragging = false;

    /** Last tile where placement was attempted during drag, to avoid redundant attempts */
    private lastPlacedTileX = -1;
    private lastPlacedTileY = -1;

    constructor(
        private readonly validatePlacement: (x: number, y: number, subType: TSubType) => boolean,
        private readonly onTileHover?: (x: number, y: number) => void
    ) {
        super();
    }

    /**
     * Get the command type string for executing placement.
     * @example 'place_building', 'place_pile'
     */
    protected abstract getCommandType(): string;

    /**
     * Get the subtype name for logging and display.
     * @param subType The subtype value
     * @returns Human-readable name
     */
    protected abstract getSubTypeName(subType: TSubType): string;

    /**
     * Calculate the anchor position for the preview.
     * Buildings may offset to center, resources use direct tile position.
     *
     * @param tileX Raw tile X under cursor
     * @param tileY Raw tile Y under cursor
     * @param subType The entity subtype being placed
     * @returns Anchor position for preview
     */
    protected abstract resolveAnchorPosition(tileX: number, tileY: number, subType: TSubType): { x: number; y: number };

    /**
     * Create the placement command to execute.
     *
     * @param x Anchor X position
     * @param y Anchor Y position
     * @param data Current mode data
     * @returns Command object for game.execute()
     */
    protected abstract createPlacementCommand(
        x: number,
        y: number,
        data: PlacementModeData<TSubType>
    ): Record<string, unknown>;

    /**
     * Initialize mode data from enter data.
     * Override to handle additional enter data fields.
     *
     * Note: This is only called after onEnter validates that subType exists,
     * so the non-null assertion is safe.
     *
     * @param enterData Data passed when entering the mode
     * @returns Initial mode data
     */
    protected initializeModeData(enterData: PlacementModeEnterData<TSubType>): PlacementModeData<TSubType> {
        return {
            subType: enterData.subType!,
            race: enterData.race,
            previewX: 0,
            previewY: 0,
            previewValid: false,
            extra: {},
        };
    }

    /**
     * Get extra preview data for render state.
     * Override to add entity-specific preview data (amount, rotation, etc).
     *
     * @param data Current mode data
     * @returns Extra data to include in preview
     */
    protected getPreviewExtra(data: PlacementModeData<TSubType>): Record<string, unknown> {
        return data.extra;
    }

    /**
     * Get status text for the current state.
     * Override for custom status messages.
     *
     * @param data Current mode data
     * @returns Status text to display
     */
    protected getStatusText(data: PlacementModeData<TSubType>): string {
        const typeName = this.getSubTypeName(data.subType);
        return data.previewValid ? `Place ${typeName}` : 'Cannot place here';
    }

    /**
     * Check if a position is valid for placement.
     * Default: delegates to the validatePlacement callback.
     * PlaceBuildingMode overrides to use the precomputed grid.
     */
    protected isPositionValid(x: number, y: number, subType: TSubType): boolean {
        return this.validatePlacement(x, y, subType);
    }

    // ─────────────────────────────────────────────────────────────────
    // InputMode lifecycle implementation
    // ─────────────────────────────────────────────────────────────────

    override onEnter(context: InputContext, enterData?: PlacementModeEnterData<TSubType>): void {
        if (enterData?.subType == null) {
            // No subtype specified, switch back to select
            context.switchMode('select');
            return;
        }

        this.currentPlayer = enterData.player ?? 0;
        context.setModeData(this.initializeModeData(enterData));
    }

    override onExit(context: InputContext): void {
        this.dragging = false;
        this.lastPlacedTileX = -1;
        this.lastPlacedTileY = -1;
        context.setModeData<PlacementModeData<TSubType> | undefined>(undefined);
    }

    override onAction(action: InputAction, context: InputContext): InputResult {
        // Only handles placement-relevant actions; others fall through to UNHANDLED
        // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- partial: unknown actions fall through to UNHANDLED
        switch (action) {
            case InputAction.CancelPlacement:
            case InputAction.DeselectAll:
                context.switchMode('select');
                return HANDLED;

            default:
                return UNHANDLED;
        }
    }

    override onPointerDown(data: PointerData, context: InputContext): InputResult {
        const modeData = context.getModeData<PlacementModeData<TSubType>>();
        if (!modeData) {
            return UNHANDLED;
        }

        if (data.button === MouseButton.Left) {
            this.dragging = true;
            this.tryPlace(modeData, context);
            return HANDLED;
        }

        return UNHANDLED;
    }

    override onPointerUp(data: PointerData, context: InputContext): InputResult {
        if (data.button === MouseButton.Left) {
            this.dragging = false;
            this.lastPlacedTileX = -1;
            this.lastPlacedTileY = -1;
            return HANDLED;
        }

        if (data.button === MouseButton.Right) {
            context.switchMode('select');
            return HANDLED;
        }

        return UNHANDLED;
    }

    /**
     * Re-evaluate tile under cursor each frame so the ghost tracks camera pan/zoom
     * even when the mouse hasn't physically moved.
     */
    override onUpdate(_deltaTime: number, context: InputContext): void {
        const modeData = context.getModeData<PlacementModeData<TSubType>>();
        if (!modeData || !context.currentTile) {
            return;
        }
        this.updatePreview(context.currentTile.x, context.currentTile.y, modeData, context);
    }

    override onPointerMove(data: PointerData, context: InputContext): InputResult {
        const modeData = context.getModeData<PlacementModeData<TSubType>>();
        if (!modeData || data.tileX === undefined || data.tileY === undefined) {
            return UNHANDLED;
        }
        this.updatePreview(data.tileX, data.tileY, modeData, context);

        return HANDLED;
    }

    override getRenderState(context: InputContext): ModeRenderState {
        const modeData = context.getModeData<PlacementModeData<TSubType>>();

        if (!modeData) {
            return {
                cursor: CursorType.Crosshair,
            };
        }

        const preview: PlacementPreview = {
            type: 'placement',
            entityType: this.entityType,
            subType: modeData.subType as number,
            race: modeData.race,
            x: modeData.previewX,
            y: modeData.previewY,
            valid: modeData.previewValid,
            extra: this.getPreviewExtra(modeData),
        };

        return {
            cursor: modeData.previewValid ? CursorType.Crosshair : CursorType.NotAllowed,
            preview,
            hoverTile: {
                x: modeData.previewX,
                y: modeData.previewY,
            },
            statusText: this.getStatusText(modeData),
        };
    }

    // ─────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * Shared preview update: resolve anchor, validate, and optionally drag-place.
     * Called from both onPointerMove (mouse moved) and onUpdate (camera moved).
     */
    private updatePreview(
        tileX: number,
        tileY: number,
        modeData: PlacementModeData<TSubType>,
        context: InputContext
    ): void {
        const anchor = this.resolveAnchorPosition(tileX, tileY, modeData.subType);
        if (anchor.x === modeData.previewX && anchor.y === modeData.previewY) {
            return;
        }

        this.onTileHover?.(tileX, tileY);
        modeData.previewX = anchor.x;
        modeData.previewY = anchor.y;
        modeData.previewValid = this.isPositionValid(anchor.x, anchor.y, modeData.subType);
        context.setModeData(modeData);

        if (this.dragging && (anchor.x !== this.lastPlacedTileX || anchor.y !== this.lastPlacedTileY)) {
            this.tryPlace(modeData, context);
        }
    }

    /**
     * Attempt to place at the current preview position. Tracks last placed tile to avoid duplicates.
     */
    private tryPlace(modeData: PlacementModeData<TSubType>, context: InputContext): void {
        this.lastPlacedTileX = modeData.previewX;
        this.lastPlacedTileY = modeData.previewY;

        if (!modeData.previewValid) {
            return;
        }

        const command = this.createPlacementCommand(modeData.previewX, modeData.previewY, modeData);
        const result = context.executeCommand(command);

        if (result.success) {
            this.logPlacement(modeData, true);
            if (this.resetAfterPlace) {
                this.dragging = false;
                context.switchMode('select');
                return;
            }
            // Re-validate current tile (now occupied) so preview updates
            modeData.previewValid = this.isPositionValid(modeData.previewX, modeData.previewY, modeData.subType);
            context.setModeData(modeData);
        } else {
            this.logPlacement(modeData, false, result.error ?? 'Command failed');
        }
    }

    private logPlacement(data: PlacementModeData<TSubType>, success: boolean, reason?: string): void {
        const typeName = this.getSubTypeName(data.subType);
        const pos = `${data.previewX},${data.previewY}`;

        if (success) {
            BasePlacementMode.baseLog.info(`Placed ${typeName} at ${pos}`);
        } else {
            BasePlacementMode.baseLog.warn(`Failed to place ${typeName} at ${pos} (${reason})`);
        }
    }
}
