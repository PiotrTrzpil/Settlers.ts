/**
 * BuildingPositionResolver — converts building-relative (x, y) offsets from jobInfo.xml
 * into world hex tile positions.
 *
 * jobInfo.xml nodes carry two kinds of position:
 *   - useWork: false  →  (x, y) is a tile offset from the building's anchor tile
 *   - useWork: true   →  (x, y) is a tile offset from the building's work-area center
 *
 * The "work-area center" is the WorkAreaStore concept: the user-adjustable point that
 * represents where a settler operates outside the building (e.g. where a woodcutter
 * stands to chop trees in the vicinity).
 *
 * For pile positions (source/destination stacks) the InventoryVisualizer already tracks
 * the exact tile where the resource entity lives — we delegate to its getStackPosition().
 */

import type { BuildingPositionResolver } from './choreo-types';
import type { GameState } from '../../game-state';
import type { InventoryVisualizer } from '../inventory';
import type { BuildingPileRegistry } from '../inventory/building-pile-registry';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import { EntityType, BuildingType, type Entity } from '../../entity';
import { EMaterialType } from '../../economy/material-type';

// ─────────────────────────────────────────────────────────────
// String → EMaterialType lookup
// ─────────────────────────────────────────────────────────────

/** Parse a material string (e.g. 'GOOD_LOG', 'LOG') into EMaterialType. Returns null if unknown. */
function parseMaterialString(material: string): EMaterialType | null {
    // Strip optional 'GOOD_' prefix that appears in some jobInfo.xml entity fields
    const key = material.startsWith('GOOD_') ? material.slice(5) : material;
    // EMaterialType is a numeric enum — index with the string key and guard against reverse lookups
    const value = (EMaterialType as Record<string, unknown>)[key];
    return typeof value === 'number' ? (value as EMaterialType) : null;
}

// ─────────────────────────────────────────────────────────────
// Config interface (3+ deps → accept a config object)
// ─────────────────────────────────────────────────────────────

/** Constructor dependencies for BuildingPositionResolverImpl. */
export interface BuildingPositionResolverConfig {
    gameState: GameState;
    /** Lazy getter — the visualizer may not be available at construction time. */
    getInventoryVisualizer: () => InventoryVisualizer;
    /** Lazy getter — the pile registry may not be available at construction time. */
    getPileRegistry: () => BuildingPileRegistry | null;
    workAreaStore: WorkAreaStore;
}

// ─────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────

/**
 * Resolves building-relative (x, y) positions from jobInfo.xml to world hex coordinates.
 *
 * Algorithm:
 *   resolvePosition(buildingId, x, y, useWork)
 *     1. Fetch building entity (throws on missing — contract violation).
 *     2. useWork = true  → base = workAreaStore.getAbsoluteCenter(...)
 *        useWork = false → base = { building.x, building.y }
 *     3. Return { x: base.x + x, y: base.y + y }
 *
 *   getSourcePilePosition(buildingId, material)
 *     → delegates to InventoryVisualizer.getStackPosition(..., 'input')
 *
 *   getDestinationPilePosition(buildingId, material)
 *     → delegates to InventoryVisualizer.getStackPosition(..., 'output')
 */
export class BuildingPositionResolverImpl implements BuildingPositionResolver {
    private readonly gameState: GameState;
    private readonly getInventoryVisualizer: () => InventoryVisualizer;
    private readonly getPileRegistry: () => BuildingPileRegistry | null;
    private readonly workAreaStore: WorkAreaStore;

    constructor(config: BuildingPositionResolverConfig) {
        this.gameState = config.gameState;
        this.getInventoryVisualizer = config.getInventoryVisualizer;
        this.getPileRegistry = config.getPileRegistry;
        this.workAreaStore = config.workAreaStore;
    }

    /**
     * Resolve (buildingId, x, y, useWork) → world hex tile position.
     *
     * Throws if the building entity does not exist (contract violation).
     *
     * @param buildingId  Entity ID of the building
     * @param x           Tile X offset from anchor (useWork=false) or work center (useWork=true)
     * @param y           Tile Y offset from anchor (useWork=false) or work center (useWork=true)
     * @param useWork     When true, apply offset from the building's work-area center
     */
    resolvePosition(buildingId: number, x: number, y: number, useWork: boolean): { x: number; y: number } {
        const building = this.gameState.getEntityOrThrow(buildingId, 'BuildingPositionResolver.resolvePosition');
        assertIsBuilding(building, buildingId);

        if (useWork) {
            const center = this.workAreaStore.getAbsoluteCenter(
                buildingId,
                building.x,
                building.y,
                building.subType as BuildingType,
                building.race
            );
            return { x: center.x + x, y: center.y + y };
        }

        return { x: building.x + x, y: building.y + y };
    }

    /**
     * Get the source pile (input stack) tile position for the given material at a building.
     *
     * Uses the BuildingPileRegistry (XML data) as the canonical source for pile positions.
     * For storage buildings, queries the InventoryVisualizer for existing stack positions.
     * Returns null for storage buildings with no existing stack (caller falls back to door).
     */
    getSourcePilePosition(buildingId: number, material: string): { x: number; y: number } | null {
        const materialType = parseMaterialString(material);
        if (materialType === null) return null;

        return this.resolvePileFromRegistry(buildingId, materialType, 'input');
    }

    /**
     * Get the destination pile (output stack) tile position for the given material at a building.
     *
     * Uses the BuildingPileRegistry (XML data) as the canonical source for pile positions.
     * For storage buildings, queries the InventoryVisualizer for existing stack positions.
     * Returns null for storage buildings with no existing stack (caller falls back to door).
     */
    getDestinationPilePosition(buildingId: number, material: string): { x: number; y: number } | null {
        const materialType = parseMaterialString(material);
        if (materialType === null) return null;

        return this.resolvePileFromRegistry(buildingId, materialType, 'output');
    }

    /**
     * Resolve pile position from the BuildingPileRegistry (XML data).
     *
     * For production buildings, throws if no pile entry exists (data error).
     * For storage buildings (bidirectional piles), queries the InventoryVisualizer
     * for an existing stack position, returning null if none exists yet.
     */
    private resolvePileFromRegistry(
        buildingId: number,
        material: EMaterialType,
        slotType: 'input' | 'output'
    ): { x: number; y: number } | null {
        const building = this.gameState.getEntityOrThrow(buildingId, 'resolvePileFromRegistry');
        assertIsBuilding(building, buildingId);

        const registry = this.getPileRegistry();
        if (!registry) {
            throw new Error(
                `BuildingPileRegistry not available when resolving ${slotType} pile ` +
                    `for ${EMaterialType[material]} at building ${buildingId} (${BuildingType[building.subType]})`
            );
        }

        const pos = registry.getPilePositionForSlot(
            building.subType as BuildingType,
            building.race,
            slotType,
            material,
            building.x,
            building.y
        );
        if (pos) return pos;

        // Storage buildings: piles are material-agnostic, query the visualizer for existing stacks
        if (registry.hasStoragePiles(building.subType as BuildingType, building.race)) {
            return this.getInventoryVisualizer().getStackPosition(buildingId, material, slotType);
        }

        // No pile defined (e.g. construction materials delivered to a production building).
        // Return null so the caller falls back to the building door.
        return null;
    }
}

// ─────────────────────────────────────────────────────────────
// Internal guards
// ─────────────────────────────────────────────────────────────

/** Assert that an entity is a building. Throws with context if violated. */
function assertIsBuilding(entity: Entity, buildingId: number): void {
    if (entity.type !== EntityType.Building) {
        throw new Error(
            `BuildingPositionResolver: entity ${buildingId} is not a building ` +
                `(EntityType=${EntityType[entity.type]})`
        );
    }
}
