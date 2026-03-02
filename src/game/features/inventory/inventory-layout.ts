/**
 * Inventory Layout
 *
 * Resolves pile (inventory stack) tile positions for buildings using the
 * XML-derived BuildingPileRegistry. All buildings must have pile data in XML — no fallbacks.
 */

import { BuildingType, tileKey, type TileCoord } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import type { BuildingPileRegistry } from './building-pile-registry';
import type { BuildingVisualState } from './material-stack-state';

/**
 * Manages visual positioning logic for building inventory stacks.
 * Stateless with respect to which entities exist — that is handled by MaterialStackState.
 */
export class InventoryLayout {
    private gameState: GameState;
    private pileRegistry: BuildingPileRegistry | null = null;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /** Set the pile registry (derived from XML game data). */
    setPileRegistry(registry: BuildingPileRegistry): void {
        this.pileRegistry = registry;
    }

    /**
     * Resolve the tile coordinate where a new visual stack should be placed.
     * Uses the BuildingPileRegistry (XML-derived) exclusively.
     *
     * - Production buildings: returns the XML-defined position for the exact material + slot type.
     * - Storage buildings: picks the first unoccupied XML-defined pile position.
     *
     * Throws if the pile registry is not set, the building is missing, or no XML pile data exists.
     */
    resolveStackPosition(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        visualState: BuildingVisualState
    ): TileCoord | null {
        if (!this.pileRegistry) throw new Error('InventoryLayout: pileRegistry not set');
        const building = this.gameState.getEntity(buildingId);
        if (!building) throw new Error(`InventoryLayout: building ${buildingId} not found`);

        const bt = building.subType as BuildingType;

        // 1. Exact material match (production buildings)
        const pos = this.pileRegistry.getPilePositionForSlot(
            bt,
            building.race,
            slotType,
            materialType,
            building.x,
            building.y
        );
        if (pos) return pos;

        // 2. Storage buildings: shared pool of XML-defined positions
        if (this.pileRegistry.hasStoragePiles(bt, building.race)) {
            const storagePositions = this.pileRegistry.getStoragePileWorldPositions(
                bt,
                building.race,
                building.x,
                building.y
            );
            return this.findAvailablePosition(visualState, storagePositions);
        }

        // No pile defined (e.g. construction materials delivered to a production building).
        // Return null so the visualizer skips creating a visual stack entity.
        return null;
    }

    // --- Private ---

    private findAvailablePosition(visualState: BuildingVisualState, positions: TileCoord[]): TileCoord | null {
        const usedPositions = new Set<string>();

        for (const entityId of visualState.outputStacks.values()) {
            const entity = this.gameState.getEntity(entityId);
            if (entity) usedPositions.add(tileKey(entity.x, entity.y));
        }
        for (const entityId of visualState.inputStacks.values()) {
            const entity = this.gameState.getEntity(entityId);
            if (entity) usedPositions.add(tileKey(entity.x, entity.y));
        }

        for (const pos of positions) {
            const key = tileKey(pos.x, pos.y);
            if (usedPositions.has(key)) continue;
            const occupant = this.gameState.getEntityAt(pos.x, pos.y);
            if (!occupant) return pos;
        }

        return null;
    }
}
