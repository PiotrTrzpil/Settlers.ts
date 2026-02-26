/**
 * Entrance (Door) Adjust Handler
 *
 * Manages the building entrance/door position — a single tile offset
 * per (BuildingType, Race). Currently buildings default to center;
 * this handler allows fine-tuning the exact tile settlers walk to.
 *
 * Persisted in data/building-entrances.yaml.
 */

import type { BuildingType } from '../../entity';
import type { Race } from '../../race';
import type { TileHighlight } from '../../input/render-state';
import type { BuildingAdjustHandler, AdjustableItem, TileOffset } from './types';
import { YamlStore } from './yaml-store';
import entrancesYaml from './data/building-entrances.yaml?raw';

const ITEM_KEY = 'door';

const FILE_PATH = 'src/game/features/building-adjust/data/building-entrances.yaml';

/** The single adjustable item for entrance. */
const ENTRANCE_ITEM: AdjustableItem = {
    key: ITEM_KEY,
    label: 'Entrance',
    category: 'entrance',
    precision: 'tile',
};

export class EntranceAdjustHandler implements BuildingAdjustHandler {
    readonly category = 'entrance' as const;
    readonly categoryLabel = 'Entrance';
    private readonly store: YamlStore;

    constructor() {
        this.store = new YamlStore(entrancesYaml, FILE_PATH);
    }

    getItems(_buildingType: BuildingType, _race: Race): readonly AdjustableItem[] {
        return [ENTRANCE_ITEM];
    }

    getOffset(buildingType: BuildingType, race: Race, _itemKey: string): TileOffset | null {
        const raw = this.store.get(buildingType, race, ITEM_KEY);
        if (!raw || raw['dx'] === undefined || raw['dy'] === undefined) return null;
        return { dx: raw['dx'], dy: raw['dy'] };
    }

    setOffset(buildingType: BuildingType, race: Race, _itemKey: string, offset: TileOffset): void {
        this.store.set(buildingType, race, ITEM_KEY, { dx: offset.dx, dy: offset.dy });
        this.store.save();
    }

    getHighlights(
        _buildingId: number,
        buildingX: number,
        buildingY: number,
        buildingType: BuildingType,
        race: Race,
        activeItemKey: string | null
    ): TileHighlight[] {
        const offset = this.getOffset(buildingType, race, ITEM_KEY);
        if (!offset) return [];

        const x = buildingX + offset.dx;
        const y = buildingY + offset.dy;
        const isActive = activeItemKey === ITEM_KEY;

        return [
            {
                x,
                y,
                color: isActive ? '#ffffff' : '#60a0e0',
                alpha: isActive ? 0.8 : 0.4,
                style: isActive ? 'solid' : 'outline',
            },
        ];
    }

    save(): void {
        this.store.save();
    }
}
