/**
 * Building Adjust Mode — unified input mode for repositioning building properties.
 *
 * Replaces the old StackAdjustMode with a generalized system that handles
 * three categories of adjustable properties:
 * - Entrance (door) — tile-precision
 * - Sprite layers — pixel-precision
 * - Resource stacks — tile-precision
 *
 * Operates on the currently selected building but saves per BuildingType + Race,
 * so edits apply to all buildings of that type + race combination.
 *
 * Interaction:
 * 1. User selects a building and opens the Adjustments panel
 * 2. User clicks an item in the panel → enters this mode with that item active
 * 3. Item is highlighted in the game world
 * 4. User clicks in the game world → sets the new position
 * 5. Escape deactivates the item, returning to select mode
 */

import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData } from '../input-actions';
import { CursorType, type ModeRenderState, type TileHighlight } from '../render-state';
import { EntityType, type BuildingType } from '../../entity';
import type { Race } from '../../core/race';
import type { GameState } from '../../game-state';
import type {
    BuildingAdjustHandler,
    AdjustableItem,
    TileOffset,
    PixelOffset,
} from '../building-adjust/types';

// ============================================================================
// Types
// ============================================================================

/** The active selection: which building + which item is being adjusted. */
export interface ActiveAdjustment {
    buildingId: number;
    buildingType: BuildingType;
    race: Race;
    buildingX: number;
    buildingY: number;
    item: AdjustableItem;
    handler: BuildingAdjustHandler;
}

/** Dependencies injected via callback. */
export interface BuildingAdjustDeps {
    gameState: GameState;
    handlers: readonly BuildingAdjustHandler[];
}

// ============================================================================
// Mode
// ============================================================================

export class BuildingAdjustMode extends BaseInputMode {
    readonly name = 'building-adjust';
    readonly displayName = 'Adjust Building';

    private active: ActiveAdjustment | null = null;

    constructor(private readonly getDeps: () => BuildingAdjustDeps | null) {
        super();
    }

    /** Get the list of all registered handlers. */
    getHandlers(): readonly BuildingAdjustHandler[] {
        return this.getDeps()?.handlers ?? [];
    }

    /** Set the active adjustment from the UI. */
    setActiveItem(buildingId: number, item: AdjustableItem, handler: BuildingAdjustHandler): void {
        const deps = this.getDeps();
        if (!deps) return;

        const building = deps.gameState.getEntity(buildingId);
        if (!building || building.type !== EntityType.Building) return;

        this.active = {
            buildingId,
            buildingType: building.subType as BuildingType,
            race: building.race,
            buildingX: building.x,
            buildingY: building.y,
            item,
            handler,
        };
    }

    /** Clear the active adjustment (item deselected in UI). */
    clearActiveItem(): void {
        this.active = null;
    }

    /** Get the currently active adjustment. */
    getActiveAdjustment(): ActiveAdjustment | null {
        return this.active;
    }

    override onEnter(_context: InputContext, _data?: Record<string, unknown>): void {
        // The UI calls setActiveItem separately after switching to this mode
    }

    override onExit(_context: InputContext): void {
        this.active = null;
    }

    override onAction(action: InputAction, context: InputContext): InputResult {
        if (action === InputAction.DeselectAll) {
            if (this.active) {
                this.active = null;
                return HANDLED;
            }
            context.switchMode('select');
            return HANDLED;
        }
        return UNHANDLED;
    }

    override onPointerUp(data: PointerData, _context: InputContext): InputResult {
        if (data.button !== MouseButton.Left) return UNHANDLED;
        if (!this.active) return UNHANDLED;

        const deps = this.getDeps();
        if (!deps) return UNHANDLED;

        if (this.active.item.precision === 'tile') {
            return this.handleTilePlacement(data, deps);
        } else {
            return this.handlePixelPlacement(data, deps);
        }
    }

    private handleTilePlacement(data: PointerData, _deps: BuildingAdjustDeps): InputResult {
        if (!this.active) throw new Error('BuildingAdjustMode: handleTilePlacement called without active adjustment');
        if (data.tileX === undefined || data.tileY === undefined) return UNHANDLED;

        const { buildingX, buildingY, item, handler, buildingType, race, buildingId } = this.active;
        const offset: TileOffset = {
            dx: data.tileX - buildingX,
            dy: data.tileY - buildingY,
        };

        handler.setOffset(buildingType, race, item.key, offset, buildingId);
        return HANDLED;
    }

    private handlePixelPlacement(data: PointerData, _deps: BuildingAdjustDeps): InputResult {
        // For pixel precision, we use the screen coordinates.
        // The UI/renderer will need to convert screen coords to pixel offset
        // relative to the building sprite anchor. We store the offset in the handler.
        //
        // For now, we use tile coordinates as a rough position and allow the
        // renderer glue layer to provide precise pixel conversion.
        // The actual pixel offset is computed by the caller via setPixelOffset().
        if (data.tileX === undefined || data.tileY === undefined) return UNHANDLED;

        // Store screen coordinates in the mode data so the glue layer can
        // resolve them to pixel offsets using the coordinate system.
        if (!this.active) throw new Error('BuildingAdjustMode: handlePixelPlacement called without active adjustment');
        const { item, handler, buildingType, race } = this.active;

        // For pixel items, we expect the glue layer to call resolvePixelPlacement()
        // with proper coordinate conversion. The PointerData gives us screenX/screenY.
        this.pendingPixelPlacement = {
            screenX: data.screenX,
            screenY: data.screenY,
            itemKey: item.key,
            buildingType,
            race,
            handler,
        };

        return HANDLED;
    }

    /** Pending pixel placement for the glue layer to resolve. */
    private pendingPixelPlacement: {
        screenX: number;
        screenY: number;
        itemKey: string;
        buildingType: BuildingType;
        race: Race;
        handler: BuildingAdjustHandler;
    } | null = null;

    /**
     * Consume a pending pixel placement.
     * Called by the glue layer after converting screen coords to pixel offset.
     */
    consumePendingPixelPlacement(): typeof this.pendingPixelPlacement {
        const pending = this.pendingPixelPlacement;
        this.pendingPixelPlacement = null;
        return pending;
    }

    /**
     * Complete a pixel placement with the resolved offset.
     * Called by the glue layer after coordinate conversion.
     */
    completePixelPlacement(buildingType: BuildingType, race: Race, itemKey: string, offset: PixelOffset): void {
        const handler = this.active?.handler;
        if (!handler) return;
        handler.setOffset(buildingType, race, itemKey, offset);
    }

    override getRenderState(context: InputContext): ModeRenderState {
        const highlights = this.buildHighlights();

        const statusText = this.active
            ? `Adjusting ${this.active.item.label} — click to set new position`
            : 'Select an item in the Adjustments panel';

        return {
            cursor: this.active ? CursorType.Crosshair : CursorType.Pointer,
            hoverTile: context.currentTile,
            highlights,
            statusText,
        };
    }

    private buildHighlights(): TileHighlight[] {
        if (!this.active) return [];

        const deps = this.getDeps();
        if (!deps) return [];

        const { buildingId, buildingX, buildingY, buildingType, race, item, handler } = this.active;
        const highlights: TileHighlight[] = [];

        // Add highlights from the active handler for the active item
        highlights.push(...handler.getHighlights(buildingId, buildingX, buildingY, buildingType, race, item.key));

        // Add building anchor highlight
        highlights.push({
            x: buildingX,
            y: buildingY,
            color: '#4080c0',
            alpha: 0.3,
            style: 'outline',
        });

        return highlights;
    }
}
