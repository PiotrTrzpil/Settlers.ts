/**
 * Work Area Store
 *
 * Shared gameplay store for per-building-instance work area offsets.
 * Lives in GameServices so both the UI layer (adjust handler) and
 * gameplay systems (settler tasks, worker search) can access it.
 *
 * Uses XML workingPos as the default, with per-instance overrides from user adjustment.
 */

import type { BuildingType } from '../../buildings/types';
import type { Race } from '../../core/race';
import type { TileOffset } from '../../input/building-adjust/types';
import { hasWorkArea } from './types';
import { getBuildingInfo } from '../../data/game-data-access';
import { PersistentMap } from '@/game/persistence/persistent-store';
import type { Tile } from '@/game/core/coordinates';

export class WorkAreaStore {
    /** Per-instance overrides (entityId → offset), auto-persisted. */
    readonly persistentStore = new PersistentMap<TileOffset>('workAreaOffsets');

    /** Get the tile offset for a building (instance override → XML workingPos) */
    getOffset(buildingType: BuildingType, race: Race, buildingId?: number): TileOffset {
        if (buildingId !== undefined) {
            const inst = this.persistentStore.get(buildingId);
            if (inst) {
                return inst;
            }
        }
        return this.getDefaultOffset(buildingType, race);
    }

    /** Get the default work area offset from XML workingPos data. */
    private getDefaultOffset(buildingType: BuildingType, race: Race): TileOffset {
        const info = getBuildingInfo(race, buildingType);
        if (!info) {
            throw new Error(`No BuildingInfo for ${buildingType} / race ${race}`);
        }
        const { xOffset, yOffset } = info.workingPos;
        return { dx: xOffset, dy: yOffset };
    }

    /** Get the work area radius (in tiles) for a building type+race from XML data. */
    getRadius(buildingType: BuildingType, race: Race): number {
        const info = getBuildingInfo(race, buildingType);
        if (!info) {
            throw new Error(`No BuildingInfo for ${buildingType} / race ${race}`);
        }
        return info.workingAreaRadius;
    }

    /** Set a per-instance override */
    setInstanceOffset(buildingId: number, offset: TileOffset): void {
        this.persistentStore.set(buildingId, { dx: offset.dx, dy: offset.dy });
    }

    /** Remove a per-instance override (e.g. when building is destroyed) */
    removeInstance(buildingId: number): void {
        this.persistentStore.delete(buildingId);
    }

    /** Check if a building type supports work areas (derived from XML workingAreaRadius > 0) */
    hasWorkArea(buildingType: BuildingType, race: Race): boolean {
        return hasWorkArea(buildingType, race);
    }

    /** Get the resolved work area center in absolute tile coordinates */
    getAbsoluteCenter(
        buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race
    ): Tile {
        const offset = this.getOffset(buildingType, race, buildingId);
        return { x: buildingX + offset.dx, y: buildingY + offset.dy };
    }
}
