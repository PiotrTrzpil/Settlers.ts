/**
 * Input manager type aliases — callback types and configuration interface.
 *
 * Extracted from input-manager.ts to keep it under the line limit.
 */

import type { Ref } from 'vue';
import type { TileCoord } from '../entity';
import type { InputConfig } from './input-config';
import type { Race } from '../core/race';
import type { CommandResult } from '../commands';

/** Tile resolver function type. */
export type TileResolver = (screenX: number, screenY: number) => TileCoord | null;

/** Command executor function type. Returns CommandResult with success status, error details, and effects. */
export type CommandExecutor = (command: Record<string, unknown>) => CommandResult;

/** Mode change callback. */
export type ModeChangeCallback = (oldMode: string, newMode: string, data?: Record<string, unknown>) => void;

/** Pick entity at screen coords (sprite-bounds hit test). Returns entity ID or null. */
export type EntityPicker = (screenX: number, screenY: number) => number | null;

/** Pick entities whose sprites intersect a screen-space rectangle. */
export type EntityRectPicker = (sx1: number, sy1: number, sx2: number, sy2: number) => number[];

/** Input manager configuration. */
export interface InputManagerOptions {
    /** Target element for input events */
    target: Ref<HTMLElement | null>;
    /** Input configuration (key bindings, etc.) */
    config?: InputConfig;
    /** Function to resolve screen coordinates to tile coordinates */
    tileResolver?: TileResolver;
    /** Function to execute game commands */
    commandExecutor?: CommandExecutor;
    /** Screen-space entity picker (click) */
    entityPicker?: EntityPicker;
    /** Screen-space entity rect picker (box select) */
    entityRectPicker?: EntityRectPicker;
    /** Initial mode name */
    initialMode?: string;
    /** Callback when mode changes */
    onModeChange?: ModeChangeCallback;
    /** Provider for the local player's race (used in debug spawn commands). */
    raceProvider?: () => Race | null;
    /** Show a transient hint near a screen position. Wired by the UI layer; absent in headless/test contexts. */
    hintProvider?: (message: string, screenX: number, screenY: number) => void;
}
