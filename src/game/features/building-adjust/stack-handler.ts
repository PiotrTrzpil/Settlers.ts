/**
 * Stack Adjust Handler
 *
 * Wraps the existing StackPositions system to expose input/output
 * resource stack positions through the unified BuildingAdjustHandler interface.
 *
 * Persisted in the existing data/stack-positions.yaml via StackPositions.
 */

import { BuildingType } from '../../entity';
import type { Race } from '../../race';
import { EMaterialType } from '../../economy/material-type';
import type { TileHighlight } from '../../input/render-state';
import type { BuildingAdjustHandler, AdjustableItem, TileOffset } from './types';
import type { StackPositions } from '../inventory/stack-positions';
import type { InventoryVisualizer } from '../inventory/inventory-visualizer';
import { INVENTORY_CONFIGS } from '../inventory/inventory-configs';

function getHighlightColor(slotType: 'input' | 'output'): string {
    return slotType === 'output' ? '#40a040' : '#a0a040';
}

/** Parse a stack item key like "output:LOG" into slot type and material. */
function parseStackKey(key: string): { slotType: 'input' | 'output'; material: EMaterialType } | null {
    const [slotType, materialName] = key.split(':');
    if (slotType !== 'input' && slotType !== 'output') return null;
    const material = (EMaterialType as unknown as Record<string, number>)[materialName!];
    if (material === undefined) return null;
    return { slotType, material: material as EMaterialType };
}

export class StackAdjustHandler implements BuildingAdjustHandler {
    readonly category = 'stack' as const;
    readonly categoryLabel = 'Resource Stacks';
    private readonly stackPositions: StackPositions;
    private readonly inventoryVisualizer: InventoryVisualizer;

    constructor(stackPositions: StackPositions, inventoryVisualizer: InventoryVisualizer) {
        this.stackPositions = stackPositions;
        this.inventoryVisualizer = inventoryVisualizer;
    }

    getItems(buildingType: BuildingType, _race: Race): readonly AdjustableItem[] {
        const config = INVENTORY_CONFIGS.get(buildingType);
        if (!config) return [];

        const items: AdjustableItem[] = [];

        for (const slot of config.outputSlots) {
            const materialName = EMaterialType[slot.materialType];
            items.push({
                key: `output:${materialName}`,
                label: `Out: ${materialName}`,
                category: 'stack',
                precision: 'tile',
            });
        }

        for (const slot of config.inputSlots) {
            const materialName = EMaterialType[slot.materialType];
            items.push({
                key: `input:${materialName}`,
                label: `In: ${materialName}`,
                category: 'stack',
                precision: 'tile',
            });
        }

        return items;
    }

    getOffset(buildingType: BuildingType, race: Race, itemKey: string): TileOffset | null {
        const parsed = parseStackKey(itemKey);
        if (!parsed) return null;

        // Use a reference point to extract dx/dy from the absolute position
        const REF_X = 0;
        const REF_Y = 0;
        const pos = this.stackPositions.getPositionForSlot(
            buildingType,
            race,
            parsed.slotType,
            parsed.material,
            REF_X,
            REF_Y
        );
        if (!pos) return null;
        return { dx: pos.x - REF_X, dy: pos.y - REF_Y };
    }

    setOffset(buildingType: BuildingType, race: Race, itemKey: string, offset: TileOffset): void {
        const parsed = parseStackKey(itemKey);
        if (!parsed) return;

        // setPosition expects absolute coordinates; use 0,0 anchor + offset
        const REF_X = 0;
        const REF_Y = 0;
        this.stackPositions.setPosition(
            buildingType,
            race,
            parsed.slotType,
            parsed.material,
            REF_X,
            REF_Y,
            REF_X + offset.dx,
            REF_Y + offset.dy
        );

        // Refresh all buildings of this type to show the new position
        this.inventoryVisualizer.refreshBuildingType(buildingType);
    }

    getHighlights(
        _buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race,
        activeItemKey: string | null
    ): TileHighlight[] {
        const highlights: TileHighlight[] = [];
        const items = this.getItems(buildingType, race);

        for (const item of items) {
            const offset = this.getOffset(buildingType, race, item.key);
            if (!offset) continue;

            const x = buildingX + offset.dx;
            const y = buildingY + offset.dy;
            const isActive = activeItemKey === item.key;
            const parsed = parseStackKey(item.key);
            const color = parsed ? getHighlightColor(parsed.slotType) : '#808080';

            highlights.push({
                x,
                y,
                color: isActive ? '#ffffff' : color,
                alpha: isActive ? 0.8 : 0.4,
                style: isActive ? 'solid' : 'outline',
            });
        }

        return highlights;
    }

    save(): void {
        this.stackPositions.saveToFile();
    }

    /** Expose the underlying StackPositions for backward compat (defaults generation). */
    getStackPositions(): StackPositions {
        return this.stackPositions;
    }

    /** Expose the underlying InventoryVisualizer for backward compat (defaults generation). */
    getInventoryVisualizer(): InventoryVisualizer {
        return this.inventoryVisualizer;
    }
}
