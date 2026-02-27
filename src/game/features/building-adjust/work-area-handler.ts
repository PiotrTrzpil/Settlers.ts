/**
 * Work Area Adjust Handler
 *
 * UI handler for adjusting work area centers via the building-adjust mode.
 * Delegates all state to the shared WorkAreaStore (owned by GameServices),
 * so gameplay systems can also query work area positions.
 *
 * Two item keys:
 * - 'work-area' — adjusts the per-type+race default (debug panel, saved to YAML)
 * - 'work-area-instance' — adjusts this specific building only (gameplay button, runtime only)
 */

import type { BuildingType } from '../../entity';
import type { Race } from '../../race';
import type { TileHighlight } from '../../input/render-state';
import type { BuildingAdjustHandler, AdjustableItem, TileOffset } from './types';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import { WORK_AREA_BUILDINGS } from '../work-areas/types';

const DEFAULT_KEY = 'work-area';
const INSTANCE_KEY = 'work-area-instance';

/** Item shown in the debug adjustments panel — edits per-type+race YAML defaults */
const WORK_AREA_DEFAULT_ITEM: AdjustableItem = {
    key: DEFAULT_KEY,
    label: 'Work Area',
    category: 'work-area',
    precision: 'tile',
};

/** Item used by the gameplay "Set Work Area" button — edits per-instance */
const WORK_AREA_INSTANCE_ITEM: AdjustableItem = {
    key: INSTANCE_KEY,
    label: 'Work Area',
    category: 'work-area',
    precision: 'tile',
};

export class WorkAreaAdjustHandler implements BuildingAdjustHandler {
    readonly category = 'work-area' as const;
    readonly categoryLabel = 'Work Area';

    constructor(private readonly store: WorkAreaStore) {}

    /** Returns the default item for the debug adjustments panel */
    getItems(buildingType: BuildingType, _race: Race): readonly AdjustableItem[] {
        if (!WORK_AREA_BUILDINGS.has(buildingType)) return [];
        return [WORK_AREA_DEFAULT_ITEM];
    }

    /** Get the instance item for the gameplay "Set Work Area" button */
    getInstanceItem(): AdjustableItem {
        return WORK_AREA_INSTANCE_ITEM;
    }

    getOffset(buildingType: BuildingType, race: Race, _itemKey: string, buildingId?: number): TileOffset | null {
        return this.store.getOffset(buildingType, race, buildingId);
    }

    setOffset(buildingType: BuildingType, race: Race, itemKey: string, offset: TileOffset, buildingId?: number): void {
        if (itemKey === INSTANCE_KEY && buildingId !== undefined) {
            this.store.setInstanceOffset(buildingId, offset);
        } else {
            this.store.setDefault(buildingType, race, offset);
        }
    }

    /** Get the resolved work area center in absolute tile coordinates */
    getAbsoluteCenter(
        buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race
    ): { x: number; y: number } {
        return this.store.getAbsoluteCenter(buildingId, buildingX, buildingY, buildingType, race);
    }

    getHighlights(
        buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race,
        activeItemKey: string | null
    ): TileHighlight[] {
        if (!WORK_AREA_BUILDINGS.has(buildingType)) return [];

        const offset = this.store.getOffset(buildingType, race, buildingId);
        const x = buildingX + offset.dx;
        const y = buildingY + offset.dy;
        const isActive = activeItemKey === DEFAULT_KEY || activeItemKey === INSTANCE_KEY;

        return [
            {
                x,
                y,
                color: isActive ? '#ff9933' : '#cc7722',
                alpha: isActive ? 0.8 : 0.4,
                style: isActive ? 'solid' : 'outline',
            },
        ];
    }

    save(): void {
        this.store.saveDefaults();
    }
}
