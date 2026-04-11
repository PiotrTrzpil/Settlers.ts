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
import type { BuildingPileRegistry } from '../../systems/inventory/building-pile-registry';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import { EntityType, BuildingType, type Entity, Tile, getEntityOfType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';

// ─────────────────────────────────────────────────────────────
// String → EMaterialType lookup
// ─────────────────────────────────────────────────────────────

/** Parse a material string (e.g. 'GOOD_LOG', 'LOG') into EMaterialType. Returns null if unknown. */
function parseMaterialString(material: string): EMaterialType | null {
    // Strip optional 'GOOD_' prefix that appears in some jobInfo.xml entity fields
    const key = material.startsWith('GOOD_') ? material.slice(5) : material;
    // EMaterialType is a string enum — values ARE the string keys.
    const value = (EMaterialType as Record<string, unknown>)[key];
    return typeof value === 'string' ? (value as EMaterialType) : null;
}

// ─────────────────────────────────────────────────────────────
// Config interface (3+ deps → accept a config object)
// ─────────────────────────────────────────────────────────────

/** Constructor dependencies for BuildingPositionResolverImpl. */
export interface BuildingPositionResolverConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    /** Lazy getter — the pile registry may not be available at construction time. */
    getPileRegistry: () => BuildingPileRegistry | null;
    workAreaStore: WorkAreaStore;
    constructionSiteManager: ConstructionSiteManager;
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
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly getPileRegistry: () => BuildingPileRegistry | null;
    private readonly workAreaStore: WorkAreaStore;
    private readonly constructionSiteManager: ConstructionSiteManager;

    constructor(config: BuildingPositionResolverConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
        this.getPileRegistry = config.getPileRegistry;
        this.workAreaStore = config.workAreaStore;
        this.constructionSiteManager = config.constructionSiteManager;
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
     * Get the source pile (input stack) tile position for the given material at a building.
     *
     * Uses the BuildingPileRegistry (XML data) as the canonical source for pile positions.
     * For storage buildings, queries the InventoryVisualizer for existing stack positions.
     * Returns null for storage buildings with no existing stack (caller falls back to door).
     */
    getSourcePilePosition(buildingId: number, material: string): Tile | null {
        const materialType = parseMaterialString(material);
        if (materialType === null) {
            return null;
        }

        const pos = this.resolvePileFromRegistry(buildingId, materialType, SlotKind.Input);
        if (pos) {
            return pos;
        }

        // Construction sites have no XML pile data — resolve via construction pile candidates
        return this.resolveConstructionPilePosition(buildingId, materialType);
    }

    /**
     * Get the destination pile (output stack) tile position for the given material at a building.
     *
     * Uses the BuildingPileRegistry (XML data) as the canonical source for pile positions.
     * For storage buildings, queries the InventoryVisualizer for existing stack positions.
     * Returns null for storage buildings with no existing stack (caller falls back to door).
     */
    getDestinationPilePosition(buildingId: number, material: string): Tile | null {
        const materialType = parseMaterialString(material);
        if (materialType === null) {
            return null;
        }

        return this.resolvePileFromRegistry(buildingId, materialType, SlotKind.Output);
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
        slotType: SlotKind.Input | SlotKind.Output
    ): Tile | null {
        const building = this.gameState.getEntityOrThrow(buildingId, 'resolvePileFromRegistry');
        // Free piles are not buildings — return null so caller falls back to entity position
        if (building.type !== EntityType.Building) {
            return null;
        }
        assertIsBuilding(building, buildingId);

        const registry = this.getPileRegistry();
        if (!registry) {
            throw new Error(
                `BuildingPileRegistry not available when resolving ${slotType} pile ` +
                    `for ${material} at building ${buildingId} (${String(building.subType)})`
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
        if (pos) {
            return pos;
        }

        // Storage buildings: look up the live pile slot via BuildingInventoryManager
        if (registry.hasStoragePiles(building.subType as BuildingType, building.race)) {
            const slots = this.inventoryManager.getSlots(buildingId);
            const matchingSlot = slots.find(
                s =>
                    s.materialType === material &&
                    (s.kind === SlotKind.Output || s.kind === SlotKind.Storage) &&
                    s.entityId !== null
            );
            if (matchingSlot) {
                return matchingSlot.position;
            }
            return null;
        }

        // No pile defined (e.g. construction materials delivered to a production building).
        // Return null so the caller falls back to the building door.
        return null;
    }

    /**
     * Resolve a construction pile position for a building under construction.
     * Returns the first pre-computed pile position for this material.
     * Returns null if the building is not under construction or has no position for this material.
     */
    private resolveConstructionPilePosition(buildingId: number, material: EMaterialType): Tile | null {
        // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
        return this.constructionSiteManager.getConstructionPilePosition(buildingId, material, 0) ?? null;
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
