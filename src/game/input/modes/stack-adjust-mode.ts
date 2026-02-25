/**
 * Stack Adjust Mode — debug tool for repositioning building inventory stacks.
 *
 * Activated from the debug panel. Click a stack to select it,
 * then click a tile to move it there. The new position is saved
 * per building type + race and written directly to the YAML file.
 *
 * Escape returns to select mode.
 */

import { BaseInputMode, HANDLED, UNHANDLED, type InputContext, type InputResult } from '../input-mode';
import { InputAction, MouseButton, type PointerData } from '../input-actions';
import { CursorType, type ModeRenderState, type TileHighlight } from '../render-state';
import { EntityType, type BuildingType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import type { Race } from '../../race';
import type { InventoryVisualizer, DebugSlotInfo } from '../../features/inventory/inventory-visualizer';
import type { StackPositions } from '../../features/inventory/stack-positions';
import type { GameState } from '../../game-state';

interface SelectedStack {
    buildingId: number;
    buildingType: BuildingType;
    buildingRace: Race;
    buildingX: number;
    buildingY: number;
    slotType: 'input' | 'output';
    material: EMaterialType;
}

export interface StackAdjustDeps {
    gameState: GameState;
    inventoryVisualizer: InventoryVisualizer;
    stackPositions: StackPositions;
}

function getHighlightColor(slotType: 'input' | 'output'): string {
    return slotType === 'output' ? '#40a040' : '#a0a040';
}

export class StackAdjustMode extends BaseInputMode {
    readonly name = 'stack-adjust';
    readonly displayName = 'Adjust Stacks';

    private selected: SelectedStack | null = null;

    constructor(private readonly getDeps: () => StackAdjustDeps | null) {
        super();
    }

    /** Get the stack positions instance (for YAML export from debug panel). */
    getStackPositions(): StackPositions | null {
        return this.getDeps()?.stackPositions ?? null;
    }

    override onEnter(_context: InputContext, _data?: Record<string, unknown>): void {
        this.selected = null;
        this.getDeps()?.inventoryVisualizer.createSlotPreviews();
    }

    override onExit(_context: InputContext): void {
        this.selected = null;
        this.getDeps()?.inventoryVisualizer.removeSlotPreviews();
    }

    override onAction(action: InputAction, context: InputContext): InputResult {
        if (action === InputAction.DeselectAll) {
            if (this.selected) {
                this.selected = null;
                return HANDLED;
            }
            context.switchMode('select');
            return HANDLED;
        }
        return UNHANDLED;
    }

    override onPointerUp(data: PointerData, _context: InputContext): InputResult {
        if (data.button !== MouseButton.Left) return UNHANDLED;
        if (data.tileX === undefined || data.tileY === undefined) return UNHANDLED;

        const deps = this.getDeps();
        if (!deps) return UNHANDLED;

        return this.selected
            ? this.moveSelectedStack(deps, data.tileX, data.tileY)
            : this.trySelectStack(deps, data.tileX, data.tileY);
    }

    private moveSelectedStack(deps: StackAdjustDeps, tileX: number, tileY: number): InputResult {
        const { buildingType, buildingRace, buildingX, buildingY, slotType, material } = this.selected!;

        deps.stackPositions.setPosition(
            buildingType,
            buildingRace,
            slotType,
            material,
            buildingX,
            buildingY,
            tileX,
            tileY
        );

        deps.inventoryVisualizer.refreshBuildingType(buildingType);
        // Recreate previews since positions changed
        deps.inventoryVisualizer.createSlotPreviews();
        this.selected = null;
        return HANDLED;
    }

    private trySelectStack(deps: StackAdjustDeps, tileX: number, tileY: number): InputResult {
        // Try entity-based selection first (clicking on an existing stack)
        const entity = deps.gameState.getEntityAt(tileX, tileY);
        if (entity?.type === EntityType.StackedResource) {
            const stackInfo = deps.inventoryVisualizer.identifyStack(entity.id);
            if (stackInfo) {
                this.selected = stackInfo;
                return HANDLED;
            }
        }

        // Fall back to position-based selection (clicking on an empty configured slot)
        const slot = deps.inventoryVisualizer.getAllSlotPositions().find(s => s.x === tileX && s.y === tileY);
        if (slot) {
            const building = deps.gameState.getEntity(slot.buildingId);
            if (building) {
                this.selected = {
                    buildingId: slot.buildingId,
                    buildingType: building.subType as BuildingType,
                    buildingRace: building.race,
                    buildingX: building.x,
                    buildingY: building.y,
                    slotType: slot.slotType,
                    material: slot.material,
                };
                return HANDLED;
            }
        }

        return HANDLED;
    }

    override getRenderState(context: InputContext): ModeRenderState {
        const highlights = this.buildHighlights();

        return {
            cursor: this.selected ? CursorType.Crosshair : CursorType.Pointer,
            hoverTile: context.currentTile,
            highlights,
            statusText: this.selected
                ? `Moving ${EMaterialType[this.selected.material]} ` + `(${this.selected.slotType}) — click target tile`
                : 'Click an inventory stack to select it',
        };
    }

    private buildHighlights(): TileHighlight[] {
        const deps = this.getDeps();
        if (!deps) return [];
        const highlights: TileHighlight[] = [];

        for (const slot of deps.inventoryVisualizer.getAllSlotPositions()) {
            highlights.push(this.slotToHighlight(slot));
        }

        this.addBuildingHighlight(highlights, deps);
        return highlights;
    }

    /** Convert a debug slot to a tile highlight. */
    private slotToHighlight(slot: DebugSlotInfo): TileHighlight {
        if (this.isSlotSelected(slot)) {
            return { x: slot.x, y: slot.y, color: '#ffffff', alpha: 0.8, style: 'solid' };
        }
        if (slot.hasEntity) {
            return { x: slot.x, y: slot.y, color: getHighlightColor(slot.slotType), alpha: 0.4, style: 'outline' };
        }
        return { x: slot.x, y: slot.y, color: getHighlightColor(slot.slotType), alpha: 0.2, style: 'dashed' };
    }

    /** Check if a slot matches the current selection. */
    private isSlotSelected(slot: DebugSlotInfo): boolean {
        if (!this.selected) return false;
        return (
            this.selected.buildingId === slot.buildingId &&
            this.selected.slotType === slot.slotType &&
            this.selected.material === slot.material
        );
    }

    /** Add a highlight for the selected stack's parent building. */
    private addBuildingHighlight(highlights: TileHighlight[], deps: StackAdjustDeps): void {
        if (!this.selected) return;
        const building = deps.gameState.getEntity(this.selected.buildingId);
        if (!building) return;
        highlights.push({
            x: building.x,
            y: building.y,
            color: '#4080c0',
            alpha: 0.3,
            style: 'outline',
        });
    }
}
