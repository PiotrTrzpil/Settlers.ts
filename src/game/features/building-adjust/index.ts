/**
 * Building Adjust System
 *
 * Unified tool for fine-tuning spatial properties of buildings.
 * Operates per (BuildingType, Race), edits from the selected building
 * apply to all buildings of that type + race.
 *
 * Three categories of adjustable properties:
 * - Entrance — door tile offset
 * - Sprite Layers — pixel offsets for base sprite and overlays
 * - Resource Stacks — input/output material tile positions
 *
 * Public API:
 * - Types: BuildingAdjustHandler, AdjustableItem, AdjustCategory, etc.
 * - Handlers: EntranceAdjustHandler, SpriteLayerAdjustHandler, StackAdjustHandler
 * - Persistence: YamlStore
 */

// Types
export type {
    BuildingAdjustHandler,
    AdjustableItem,
    AdjustCategory,
    AdjustPrecision,
    TileOffset,
    PixelOffset,
    HighlightPosition,
} from './types';

// Handlers
export { EntranceAdjustHandler } from './entrance-handler';
export { SpriteLayerAdjustHandler } from './sprite-layer-handler';
export { StackAdjustHandler } from './stack-handler';

// Persistence
export { YamlStore } from './yaml-store';
