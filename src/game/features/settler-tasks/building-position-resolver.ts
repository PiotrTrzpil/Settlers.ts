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
    private readonly workAreaStore: WorkAreaStore;

    constructor(config: BuildingPositionResolverConfig) {
        this.gameState = config.gameState;
        this.getInventoryVisualizer = config.getInventoryVisualizer;
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
     * The "source pile" is where carriers drop off input materials — i.e. the building's
     * input inventory stack for that material.
     *
     * Returns null if no visual stack exists yet (inventory empty, or building not yet
     * registered with the visualizer).
     *
     * @param buildingId  Entity ID of the building
     * @param material    Material string (e.g. 'GOOD_LOG', 'LOG', or enum name 'LOG')
     */
    getSourcePilePosition(buildingId: number, material: string): { x: number; y: number } | null {
        const materialType = parseMaterialString(material);
        if (materialType === null) return null;

        return this.getInventoryVisualizer().getStackPosition(buildingId, materialType, 'input');
    }

    /**
     * Get the destination pile (output stack) tile position for the given material at a building.
     *
     * The "destination pile" is where carriers pick up output materials — i.e. the building's
     * output inventory stack for that material.
     *
     * Returns null if no visual stack exists yet (output empty).
     *
     * @param buildingId  Entity ID of the building
     * @param material    Material string (e.g. 'GOOD_LOG', 'LOG', or enum name 'LOG')
     */
    getDestinationPilePosition(buildingId: number, material: string): { x: number; y: number } | null {
        const materialType = parseMaterialString(material);
        if (materialType === null) return null;

        return this.getInventoryVisualizer().getStackPosition(buildingId, materialType, 'output');
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
