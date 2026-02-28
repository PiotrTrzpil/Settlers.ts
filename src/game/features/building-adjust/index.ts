/**
 * Building Adjust System
 *
 * Unified tool for fine-tuning spatial properties of buildings.
 * Operates per (BuildingType, Race), edits from the selected building
 * apply to all buildings of that type + race.
 *
 * Two categories of adjustable properties:
 * - Resource Stacks — input/output material tile positions
 * - Work Areas — center positions for worker search areas
 *
 * Public API:
 * - Types: BuildingAdjustHandler, AdjustableItem, AdjustCategory, etc.
 * - Handlers: StackAdjustHandler, WorkAreaAdjustHandler
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
export { StackAdjustHandler } from './stack-handler';
export { WorkAreaAdjustHandler } from './work-area-handler';
