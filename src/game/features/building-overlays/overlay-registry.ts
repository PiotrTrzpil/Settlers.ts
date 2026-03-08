/**
 * Overlay Registry
 *
 * Static registry mapping (BuildingType, Race) → overlay definitions.
 * Populated once at startup with declarative overlay data. Not tied to
 * any runtime state — purely a configuration lookup.
 *
 * @example
 * ```ts
 * const registry = new OverlayRegistry();
 *
 * registry.register(BuildingType.Sawmill, Race.Roman, [
 *     { key: 'wheel', layer: OverlayLayer.AboveBuilding, ... },
 *     { key: 'smoke', layer: OverlayLayer.AboveBuilding, ... },
 * ]);
 *
 * const overlays = registry.getOverlays(BuildingType.Sawmill, Race.Roman);
 * // → [{ key: 'wheel', ... }, { key: 'smoke', ... }]
 * ```
 */

import type { BuildingType } from '../../entity';
import type { Race } from '../../core/race';
import type { BuildingOverlayDef } from './types';

/** Composite key for the registry map: "buildingType:race" */
function makeKey(buildingType: BuildingType, race: Race): string {
    return `${buildingType}:${race}`;
}

/**
 * Static registry of overlay definitions per building type and race.
 *
 * Thread-safe for reads after initialization. Not designed for runtime mutation —
 * register all definitions at startup before any building is created.
 */
export class OverlayRegistry {
    private readonly defs = new Map<string, readonly BuildingOverlayDef[]>();

    /**
     * Register overlay definitions for a building type and race.
     * Replaces any previous definitions for the same (buildingType, race) pair.
     */
    register(buildingType: BuildingType, race: Race, overlays: readonly BuildingOverlayDef[]): void {
        this.defs.set(makeKey(buildingType, race), overlays);
    }

    /**
     * Get overlay definitions for a building type and race.
     * Returns an empty array if no overlays are defined.
     */
    getOverlays(buildingType: BuildingType, race: Race): readonly BuildingOverlayDef[] {
        return this.defs.get(makeKey(buildingType, race)) ?? EMPTY;
    }

    /**
     * Check whether a building type has any overlays for the given race.
     */
    hasOverlays(buildingType: BuildingType, race: Race): boolean {
        const defs = this.defs.get(makeKey(buildingType, race));
        return defs !== undefined && defs.length > 0;
    }

    /**
     * Collect all unique sprite references across all registered overlays.
     * Used by the sprite loader to know which overlay sprites to load for a race.
     */
    getSpriteManifest(race: Race): readonly BuildingOverlayDef[] {
        const result: BuildingOverlayDef[] = [];
        for (const [key, defs] of this.defs) {
            if (key.endsWith(`:${race}`)) {
                result.push(...defs);
            }
        }
        return result;
    }
}

const EMPTY: readonly BuildingOverlayDef[] = [];
