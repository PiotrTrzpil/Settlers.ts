/**
 * Work Area Store
 *
 * Shared gameplay store for per-building-instance work area offsets.
 * Lives in GameServices so both the UI layer (adjust handler) and
 * gameplay systems (settler tasks, worker search) can access it.
 *
 * Falls back to per-type+race defaults from YAML, then to a hard-coded offset.
 */

import type { BuildingType } from '../../buildings/types';
import type { Race } from '../../race';
import type { TileOffset } from '../building-adjust/types';
import { YamlStore } from '../building-adjust/yaml-store';
import { DEFAULT_WORK_AREA_OFFSET_Y, WORK_AREA_BUILDINGS } from './types';
import workAreasYaml from '../building-adjust/data/building-work-areas.yaml?raw';

const ITEM_KEY = 'work-area';
const FILE_PATH = 'src/game/features/building-adjust/data/building-work-areas.yaml';

export class WorkAreaStore {
    /** Per-type+race defaults from YAML */
    private readonly defaults: YamlStore;

    /** Per-instance overrides (runtime only) */
    private readonly instanceOffsets = new Map<number, TileOffset>();

    constructor() {
        this.defaults = new YamlStore(workAreasYaml, FILE_PATH);
    }

    /** Get the tile offset for a building (instance override → YAML default → hard-coded fallback) */
    getOffset(buildingType: BuildingType, race: Race, buildingId?: number): TileOffset {
        // Per-instance override
        if (buildingId !== undefined) {
            const inst = this.instanceOffsets.get(buildingId);
            if (inst) return inst;
        }

        // Per-type+race YAML default
        const raw = this.defaults.get(buildingType, race, ITEM_KEY);
        if (raw && raw['dx'] !== undefined && raw['dy'] !== undefined) {
            return { dx: raw['dx'], dy: raw['dy'] };
        }

        // Hard-coded fallback
        return { dx: 0, dy: DEFAULT_WORK_AREA_OFFSET_Y };
    }

    /** Set the per-type+race default (persisted to YAML) */
    setDefault(buildingType: BuildingType, race: Race, offset: TileOffset): void {
        this.defaults.set(buildingType, race, ITEM_KEY, { dx: offset.dx, dy: offset.dy });
        this.defaults.save();
    }

    /** Set a per-instance override */
    setInstanceOffset(buildingId: number, offset: TileOffset): void {
        this.instanceOffsets.set(buildingId, { dx: offset.dx, dy: offset.dy });
    }

    /** Remove a per-instance override (e.g. when building is destroyed) */
    removeInstance(buildingId: number): void {
        this.instanceOffsets.delete(buildingId);
    }

    /** Check if a building type supports work areas */
    hasWorkArea(buildingType: BuildingType): boolean {
        return WORK_AREA_BUILDINGS.has(buildingType);
    }

    /** Get the resolved work area center in absolute tile coordinates */
    getAbsoluteCenter(
        buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race
    ): { x: number; y: number } {
        const offset = this.getOffset(buildingType, race, buildingId);
        return { x: buildingX + offset.dx, y: buildingY + offset.dy };
    }

    /** Save YAML defaults to disk */
    saveDefaults(): void {
        this.defaults.save();
    }
}
