import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData } from '../input-actions';
import { CursorType, type ModeRenderState, type PlacementPreview, type PlacementEntityType } from '../render-state';
import { LogHandler } from '../../../utilities/log-handler';

/**
 * Generic data for any placement mode.
 * The subType field holds the specific type (BuildingType, EMaterialType, etc).
 */
export interface PlacementModeData<TSubType = number> {
    /** The specific entity subtype being placed */
    subType: TSubType;
    /** Current preview anchor position X */
    previewX: number;
    /** Current preview anchor position Y */
    previewY: number;
    /** Whether current preview position is valid */
    previewValid: boolean;
    /** Validation function - injected by use-renderer */
    validatePlacement?: (x: number, y: number, subType: TSubType) => boolean;
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

    /**
     * Get the command type string for executing placement.
     * @example 'place_building', 'place_resource'
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
    protected abstract resolveAnchorPosition(
        tileX: number,
        tileY: number,
        subType: TSubType
    ): { x: number; y: number };

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
        return data.previewValid
            ? `Place ${typeName}`
            : 'Cannot place here';
    }

    // ─────────────────────────────────────────────────────────────────
    // InputMode lifecycle implementation
    // ─────────────────────────────────────────────────────────────────

    onEnter(context: InputContext, enterData?: PlacementModeEnterData<TSubType>): void {
        if (!enterData?.subType && enterData?.subType !== 0) {
            // No subtype specified, switch back to select
            context.switchMode('select');
            return;
        }

        this.currentPlayer = enterData.player ?? 0;
        context.setModeData(this.initializeModeData(enterData));
    }

    onExit(context: InputContext): void {
        context.setModeData<PlacementModeData<TSubType> | undefined>(undefined);
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
        const modeData = context.getModeData<PlacementModeData<TSubType>>();
        if (!modeData) return UNHANDLED;

        if (data.button === MouseButton.Left) {
            if (modeData.previewValid) {
                const command = this.createPlacementCommand(
                    modeData.previewX,
                    modeData.previewY,
                    modeData
                );
                const success = context.executeCommand(command);

                if (success) {
                    this.logPlacement(modeData, true);
                    context.switchMode('select');
                } else {
                    this.logPlacement(modeData, false, 'Command failed');
                }
            } else {
                this.logPlacement(modeData, false, 'Invalid position');
            }
            return HANDLED;
        }

        if (data.button === MouseButton.Right) {
            context.switchMode('select');
            return HANDLED;
        }

        return UNHANDLED;
    }

    onPointerMove(data: PointerData, context: InputContext): InputResult {
        const modeData = context.getModeData<PlacementModeData<TSubType>>();
        if (!modeData || data.tileX === undefined || data.tileY === undefined) {
            return UNHANDLED;
        }

        // Calculate anchor position (may differ from cursor tile)
        const anchor = this.resolveAnchorPosition(data.tileX, data.tileY, modeData.subType);
        modeData.previewX = anchor.x;
        modeData.previewY = anchor.y;

        // Validate placement if validator is available
        if (modeData.validatePlacement) {
            modeData.previewValid = modeData.validatePlacement(anchor.x, anchor.y, modeData.subType);
        } else {
            // Default to valid if no validator (will be injected later)
            modeData.previewValid = true;
        }

        context.setModeData(modeData);
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
    // Public API for external configuration
    // ─────────────────────────────────────────────────────────────────

    /**
     * Set the placement validator function.
     * Called by use-renderer to inject game-aware validation.
     */
    setValidator(
        context: InputContext,
        validator: (x: number, y: number, subType: TSubType) => boolean
    ): void {
        const modeData = context.getModeData<PlacementModeData<TSubType>>();
        if (modeData) {
            modeData.validatePlacement = validator;
            context.setModeData(modeData);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────

    private logPlacement(
        data: PlacementModeData<TSubType>,
        success: boolean,
        reason?: string
    ): void {
        const typeName = this.getSubTypeName(data.subType);
        const pos = `${data.previewX},${data.previewY}`;

        if (success) {
            BasePlacementMode.baseLog.info(`Placed ${typeName} at ${pos}`);
        } else {
            BasePlacementMode.baseLog.warn(`Failed to place ${typeName} at ${pos} (${reason})`);
        }
    }
}
