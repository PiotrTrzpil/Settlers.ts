/**
 * Sprite Layer Adjust Handler
 *
 * Manages pixel-level offsets for building sprite layers:
 * - 'base' — the main building sprite
 * - Overlay keys (e.g. 'smoke', 'wheel') — each overlay layer
 *
 * Pixel offsets are relative to the building's sprite anchor point.
 * Persisted in data/building-sprite-offsets.yaml.
 */

import type { BuildingType } from '../../entity';
import type { Race } from '../../race';
import type { TileHighlight } from '../../input/render-state';
import type { BuildingAdjustHandler, AdjustableItem, PixelOffset } from './types';
import type { OverlayRegistry } from '../../systems/building-overlays';
import { YamlStore } from './yaml-store';
import spriteOffsetsYaml from './data/building-sprite-offsets.yaml?raw';

const FILE_PATH = 'src/game/features/building-adjust/data/building-sprite-offsets.yaml';

/** Colors for different overlay layers. */
const LAYER_COLORS: Record<string, string> = {
    base: '#e0a040',
    default: '#a060e0',
};

export class SpriteLayerAdjustHandler implements BuildingAdjustHandler {
    readonly category = 'sprite-layer' as const;
    readonly categoryLabel = 'Sprite Layers';
    private readonly store: YamlStore;
    private readonly overlayRegistry: OverlayRegistry;

    constructor(overlayRegistry: OverlayRegistry) {
        this.store = new YamlStore(spriteOffsetsYaml, FILE_PATH);
        this.overlayRegistry = overlayRegistry;
    }

    getItems(buildingType: BuildingType, race: Race): readonly AdjustableItem[] {
        const items: AdjustableItem[] = [
            {
                key: 'base',
                label: 'Base Sprite',
                category: 'sprite-layer',
                precision: 'pixel',
            },
        ];

        const overlays = this.overlayRegistry.getOverlays(buildingType, race);
        for (const overlay of overlays) {
            items.push({
                key: overlay.key,
                label: overlay.key.charAt(0).toUpperCase() + overlay.key.slice(1),
                category: 'sprite-layer',
                precision: 'pixel',
            });
        }

        return items;
    }

    getOffset(buildingType: BuildingType, race: Race, itemKey: string): PixelOffset | null {
        const raw = this.store.get(buildingType, race, itemKey);
        if (!raw || raw['px'] === undefined || raw['py'] === undefined) return null;
        return { px: raw['px'], py: raw['py'] };
    }

    setOffset(buildingType: BuildingType, race: Race, itemKey: string, offset: PixelOffset): void {
        this.store.set(buildingType, race, itemKey, { px: offset.px, py: offset.py });
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
        // Sprite layers are pixel-precision, but we still show a tile highlight
        // at the building anchor to indicate which building is being edited.
        // The actual pixel offset visualization is handled by the renderer overlay.
        const highlights: TileHighlight[] = [];
        const items = this.getItems(buildingType, race);

        for (const item of items) {
            const offset = this.getOffset(buildingType, race, item.key);
            if (!offset) continue;

            // Show highlight at building anchor (sprite layers are pixel-offset from anchor)
            const isActive = activeItemKey === item.key;
            const color = LAYER_COLORS[item.key] ?? LAYER_COLORS['default']!;

            highlights.push({
                x: buildingX,
                y: buildingY,
                color: isActive ? '#ffffff' : color,
                alpha: isActive ? 0.6 : 0.25,
                style: isActive ? 'solid' : 'dashed',
            });
        }

        return highlights;
    }

    save(): void {
        this.store.save();
    }
}
