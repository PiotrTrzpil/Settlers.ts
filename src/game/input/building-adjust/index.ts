/**
 * Building Adjust System
 *
 * Unified tool for fine-tuning spatial properties of buildings.
 * Operates per (BuildingType, Race), edits from the selected building
 * apply to all buildings of that type + race.
 *
 * Public API:
 * - Types: BuildingAdjustHandler, AdjustableItem, AdjustCategory, etc.
 * - Handlers: WorkAreaAdjustHandler
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
export { WorkAreaAdjustHandler } from './work-area-handler';
