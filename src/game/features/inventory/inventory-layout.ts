/**
 * Inventory Layout
 *
 * Handles all visual positioning and layout logic for building inventory stacks.
 * Calculates which tiles are adjacent to a building footprint, categorises them
 * into output (upper/right) vs. input (lower/left) positions, and resolves the
 * final tile coordinate for each material slot using the XML-derived BuildingPileRegistry
 * with an auto-calculated fallback for buildings missing from the XML.
 */

import { BuildingType, tileKey, getBuildingSize, type TileCoord } from '../../entity';
import { getBuildingFootprint } from '../../buildings/types';
import { EMaterialType } from '../../economy/material-type';
import { Race } from '../../race';
import type { GameState } from '../../game-state';
import type { BuildingPileRegistry } from './building-pile-registry';
import type { BuildingVisualState } from './material-stack-state';

/**
 * Pre-computed layout positions for one building.
 * Stored alongside the visual state so position calculation is not repeated.
 */
export interface BuildingLayoutPositions {
    /** Positions available for placing output resource stacks (right side, upper) */
    outputPositions: TileCoord[];
    /** Positions available for placing input resource stacks (right side, lower) */
    inputPositions: TileCoord[];
}

/**
 * Manages visual positioning logic for building inventory stacks.
 * Stateless with respect to which entities exist — that is handled by MaterialStackState.
 */
export class InventoryLayout {
    /** Cached auto-calculated positions per building ID */
    private cachedPositions: Map<number, BuildingLayoutPositions> = new Map();

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
     * Get (or lazily compute) the auto-calculated layout positions for a building.
     */
    getLayoutPositions(buildingId: number): BuildingLayoutPositions {
        const cached = this.cachedPositions.get(buildingId);
        if (cached) return cached;

        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            return { outputPositions: [], inputPositions: [] };
        }

        const positions = this.calculateAutoStackPositions(
            building.x,
            building.y,
            building.subType as BuildingType,
            building.race
        );

        this.cachedPositions.set(buildingId, positions);
        return positions;
    }

    /**
     * Invalidate cached positions for a specific building (e.g. after config reload).
     */
    invalidateCache(buildingId: number): void {
        this.cachedPositions.delete(buildingId);
    }

    /**
     * Invalidate all cached positions for buildings of a given type.
     */
    invalidateCacheForType(buildingType: BuildingType): void {
        for (const [buildingId] of this.cachedPositions) {
            const building = this.gameState.getEntity(buildingId);
            if (building && (building.subType as BuildingType) === buildingType) {
                this.cachedPositions.delete(buildingId);
            }
        }
    }

    /**
     * Resolve the tile coordinate where a new visual stack should be placed.
     * Checks the BuildingPileRegistry (XML-derived) first; falls back to the auto-calculated pool
     * for buildings not covered by the XML.
     *
     * Storage buildings (e.g. StorageArea) use their own XML-defined pile positions as the pool —
     * each position is bidirectional (serves as both input and output).
     */
    resolveStackPosition(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        visualState: BuildingVisualState
    ): TileCoord | null {
        const building = this.gameState.getEntity(buildingId);

        if (this.pileRegistry && building) {
            // 1. Try exact material match from XML (production buildings)
            const pos = this.pileRegistry.getPilePositionForSlot(
                building.subType as BuildingType,
                building.race,
                slotType,
                materialType,
                building.x,
                building.y
            );
            if (pos) return pos;

            // 2. Storage buildings: use XML-defined positions as a shared pool
            const bt = building.subType as BuildingType;
            if (this.pileRegistry.hasStoragePiles(bt, building.race)) {
                const storagePositions = this.pileRegistry.getStoragePileWorldPositions(
                    bt,
                    building.race,
                    building.x,
                    building.y
                );
                return this.findAvailablePosition(visualState, storagePositions);
            }
        }

        // 3. Fallback: auto-calculated adjacent positions
        const layout = this.getLayoutPositions(buildingId);
        const fallbackPositions = slotType === 'output' ? layout.outputPositions : layout.inputPositions;
        return this.findAvailablePosition(visualState, fallbackPositions);
    }

    /**
     * Auto-calculate fallback positions from building footprint adjacency.
     * Finds all tiles adjacent to the footprint but outside it, then splits
     * them into output (upper/right) and input (lower/left) groups.
     *
     * - Outputs: upper positions (lower Y in isometric view = visually higher)
     * - Inputs:  lower positions
     */
    calculateAutoStackPositions(
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race = Race.Roman
    ): BuildingLayoutPositions {
        const size = getBuildingSize(buildingType);
        const footprint = getBuildingFootprint(buildingX, buildingY, buildingType, race);
        const footprintSet = new Set(footprint.map(t => tileKey(t.x, t.y)));

        const adjacentSet = new Set<string>();
        const adjacentTiles: TileCoord[] = [];

        for (const tile of footprint) {
            for (const [dx, dy] of [
                [0, -1] as [number, number],
                [1, 0] as [number, number],
                [0, 1] as [number, number],
                [-1, 0] as [number, number],
            ]) {
                const nx = tile.x + dx;
                const ny = tile.y + dy;
                if (nx < 0 || ny < 0) continue;
                const key = tileKey(nx, ny);
                if (footprintSet.has(key) || adjacentSet.has(key)) continue;
                adjacentSet.add(key);
                adjacentTiles.push({ x: nx, y: ny });
            }
        }

        const centerY = buildingY + size.height / 2;
        const outputPositions: TileCoord[] = [];
        const inputPositions: TileCoord[] = [];

        for (const pos of adjacentTiles) {
            if (pos.y < centerY) {
                outputPositions.push(pos);
            } else {
                inputPositions.push(pos);
            }
        }

        // Sort outputs: prefer right side (higher x), then top (lower y)
        outputPositions.sort((a, b) => b.x - a.x || a.y - b.y);
        // Sort inputs: prefer right side (higher x), then bottom (higher y)
        inputPositions.sort((a, b) => b.x - a.x || b.y - a.y);

        return { outputPositions, inputPositions };
    }

    // --- Private ---

    /**
     * Find an available position from the auto-calculated pool that is not
     * already occupied by another stack or any other entity.
     */
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
