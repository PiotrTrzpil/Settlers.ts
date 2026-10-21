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
 * Pile tiles are NOT derived here: they are fixed on the inventory slots at slot creation.
 * getPilePosition only parses the jobInfo.xml material string and asks the inventory.
 */

import type { BuildingPositionResolver } from './choreo-types';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager, PileSide } from '../inventory';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import { EntityType, BuildingType, Tile, getEntityOfType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';

// ─────────────────────────────────────────────────────────────
// String → EMaterialType lookup
// ─────────────────────────────────────────────────────────────

/** Parse a jobInfo.xml material string (e.g. 'GOOD_LOG', 'LOG') into EMaterialType. Throws if unknown. */
function parseMaterialString(material: string): EMaterialType {
    // Strip optional 'GOOD_' prefix that appears in some jobInfo.xml entity fields
    const key = material.startsWith('GOOD_') ? material.slice(5) : material;
    // EMaterialType is a string enum — values ARE the string keys.
    const value = (EMaterialType as Record<string, unknown>)[key];
    if (typeof value !== 'string') {
        throw new Error(`BuildingPositionResolver: unknown material '${material}' in jobInfo.xml pile node`);
    }
    return value as EMaterialType;
}

// ─────────────────────────────────────────────────────────────
// Config interface (3+ deps → accept a config object)
// ─────────────────────────────────────────────────────────────

/** Constructor dependencies for BuildingPositionResolverImpl. */
export interface BuildingPositionResolverConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
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
 *   getPilePosition(buildingId, material, side)
 *     → BuildingInventoryManager.getPilePosition (slot position fixed at slot creation)
 */
export class BuildingPositionResolverImpl implements BuildingPositionResolver {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly workAreaStore: WorkAreaStore;

    constructor(config: BuildingPositionResolverConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
        this.workAreaStore = config.workAreaStore;
    }

    /**
     * Resolve (buildingId, offset, useWork) → world hex tile position.
     *
     * Throws if the building entity does not exist (contract violation).
     *
     * @param buildingId  Entity ID of the building
     * @param offset      Tile offset from anchor (useWork=false) or work center (useWork=true)
     * @param useWork     When true, apply offset from the building's work-area center
     */
    resolvePosition(buildingId: number, offset: Tile, useWork: boolean): Tile {
        const { x, y } = offset;
        const building = getEntityOfType(
            this.gameState,
            buildingId,
            EntityType.Building,
            'BuildingPositionResolver.resolvePosition'
        );

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
     * Tile of the building's pile for a jobInfo.xml material on the given side.
     * Throws if the building has no such pile (choreography / pile data mismatch).
     */
    getPilePosition(buildingId: number, material: string, side: PileSide): Tile {
        return this.inventoryManager.getPilePosition(buildingId, parseMaterialString(material), side);
    }

    hasWorkArea(buildingId: number): boolean {
        const building = getEntityOfType(this.gameState, buildingId, EntityType.Building, 'hasWorkArea');
        return this.workAreaStore.hasWorkArea(building.subType as BuildingType, building.race);
    }

    getWorkAreaCenter(buildingId: number): Tile {
        return this.resolvePosition(buildingId, { x: 0, y: 0 }, true);
    }

    getWorkAreaRadius(buildingId: number): number {
        const building = getEntityOfType(this.gameState, buildingId, EntityType.Building, 'getWorkAreaRadius');
        const buildingType = building.subType as BuildingType;
        if (!this.workAreaStore.hasWorkArea(buildingType, building.race)) {
            throw new Error(
                `getWorkAreaRadius: no work area for ${String(buildingType)} / race ${building.race} ` +
                    `(building ${buildingId})`
            );
        }
        return this.workAreaStore.getRadius(buildingType, building.race);
    }
}
