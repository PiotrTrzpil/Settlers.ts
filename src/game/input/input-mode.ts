import type { InputAction, PointerData, DragData, KeyboardData } from './input-actions';
import type { InputState } from './input-state';
import type { TileCoord } from '../entity';

/**
 * Context passed to input mode handlers.
 */
export interface InputContext {
    /** Current input state */
    state: InputState;
    /** Current tile under cursor (if resolved) */
    currentTile: TileCoord | null;
    /** Execute a game command */
    executeCommand: (command: any) => boolean;
    /** Switch to a different mode */
    switchMode: (mode: string, data?: any) => void;
    /** Get mode-specific data */
    getModeData: <T>() => T | undefined;
    /** Set mode-specific data */
    setModeData: <T>(data: T) => void;
}

/**
 * Result of handling an input event.
 */
export interface InputResult {
    /** Whether the event was handled */
    handled: boolean;
    /** Whether to prevent default browser behavior */
    preventDefault?: boolean;
    /** Whether to stop event propagation */
    stopPropagation?: boolean;
}

/** Default result for unhandled events */
export const UNHANDLED: InputResult = { handled: false };

/** Default result for handled events */
export const HANDLED: InputResult = { handled: true, preventDefault: true };

/**
 * Interface for input modes.
 * Each mode defines how input events are processed.
 */
export interface InputMode {
    /** Unique identifier for this mode */
    readonly name: string;

    /** Human-readable display name */
    readonly displayName: string;

    /**
     * Called when this mode is activated.
     * @param context Input context
     * @param data Optional data passed when switching to this mode
     */
    onEnter?(context: InputContext, data?: any): void;

    /**
     * Called when leaving this mode.
     * @param context Input context
     */
    onExit?(context: InputContext): void;

    /**
     * Handle a resolved input action.
     * @param action The action that was triggered
     * @param context Input context
     * @returns Whether the action was handled
     */
    onAction?(action: InputAction, context: InputContext): InputResult;

    /**
     * Handle pointer down event.
     * @param data Pointer event data
     * @param context Input context
     */
    onPointerDown?(data: PointerData, context: InputContext): InputResult;

    /**
     * Handle pointer up event (click or drag end).
     * @param data Pointer event data
     * @param context Input context
     */
    onPointerUp?(data: PointerData, context: InputContext): InputResult;

    /**
     * Handle pointer move event.
     * @param data Pointer event data
     * @param context Input context
     */
    onPointerMove?(data: PointerData, context: InputContext): InputResult;

    /**
     * Handle drag event (called during drag, after threshold exceeded).
     * @param data Current drag state
     * @param context Input context
     */
    onDrag?(data: DragData, context: InputContext): InputResult;

    /**
     * Handle drag end event.
     * @param data Final drag state
     * @param context Input context
     */
    onDragEnd?(data: DragData, context: InputContext): InputResult;

    /**
     * Handle mouse wheel event.
     * @param data Pointer data with wheelDelta
     * @param context Input context
     */
    onWheel?(data: PointerData, context: InputContext): InputResult;

    /**
     * Handle raw keyboard event (for keys not bound to actions).
     * @param data Keyboard event data
     * @param isDown Whether key is being pressed (vs released)
     * @param context Input context
     */
    onKeyboard?(data: KeyboardData, isDown: boolean, context: InputContext): InputResult;

    /**
     * Called every frame for continuous input processing.
     * @param deltaTime Time since last update in seconds
     * @param context Input context
     */
    onUpdate?(deltaTime: number, context: InputContext): void;
}

/**
 * Base class for input modes with default implementations.
 */
export abstract class BaseInputMode implements InputMode {
    abstract readonly name: string;
    abstract readonly displayName: string;

    onEnter(_context: InputContext, _data?: any): void {
        // Default: do nothing
    }

    onExit(_context: InputContext): void {
        // Default: do nothing
    }

    onAction(_action: InputAction, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onPointerDown(_data: PointerData, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onPointerUp(_data: PointerData, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onPointerMove(_data: PointerData, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onDrag(_data: DragData, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onDragEnd(_data: DragData, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onWheel(_data: PointerData, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onKeyboard(_data: KeyboardData, _isDown: boolean, _context: InputContext): InputResult {
        return UNHANDLED;
    }

    onUpdate(_deltaTime: number, _context: InputContext): void {
        // Default: do nothing
    }
}
