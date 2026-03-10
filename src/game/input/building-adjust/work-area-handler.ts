/**
 * Work Area Adjust Handler
 *
 * UI handler for adjusting work area centers via the building-adjust mode.
 * Delegates all state to the shared WorkAreaStore (owned by GameServices),
 * so gameplay systems can also query work area positions.
 *
 * Per-instance override ('work-area-instance') — adjusts this specific building only.
 */

import type { BuildingType } from '../../entity';
import type { Race } from '../../core/race';
import type { TileHighlight } from '../../input/render-state';
import type { BuildingAdjustHandler, AdjustableItem, TileOffset } from './types';
import type { WorkAreaStore } from '../../features/work-areas/work-area-store';
import { hasWorkArea } from '../../features/work-areas/types';

const INSTANCE_KEY = 'work-area-instance';

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

    getItems(buildingType: BuildingType, race: Race): readonly AdjustableItem[] {
        if (!hasWorkArea(buildingType, race)) return [];
        return [WORK_AREA_INSTANCE_ITEM];
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
        }
    }

    /** Get the work area radius (in tiles) for a building type+race from XML data. */
    getRadius(buildingType: BuildingType, race: Race): number {
        return this.store.getRadius(buildingType, race);
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

    save(): void {
        // No-op: work area instance offsets are saved with game state, not to disk
    }

    getHighlights(
        buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race,
        activeItemKey: string | null
    ): TileHighlight[] {
        if (!hasWorkArea(buildingType, race)) return [];

        const offset = this.store.getOffset(buildingType, race, buildingId);
        const x = buildingX + offset.dx;
        const y = buildingY + offset.dy;
        const isActive = activeItemKey === INSTANCE_KEY;

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
}
