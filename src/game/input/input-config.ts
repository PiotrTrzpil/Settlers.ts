import { InputAction, MouseButton } from './input-actions';

/**
 * A key binding maps a key/mouse combination to an action.
 */
export interface KeyBinding {
    /** The action this binding triggers */
    action: InputAction;
    /** Key code (e.g., 'KeyW', 'Space', 'Digit1') - null for mouse-only bindings */
    key?: string;
    /** Alternative key (for keys like 'w' that have different codes) */
    altKey?: string;
    /** Mouse button - null for keyboard-only bindings */
    mouseButton?: MouseButton;
    /** Require shift to be held */
    shift?: boolean;
    /** Require ctrl/cmd to be held */
    ctrl?: boolean;
    /** Require alt to be held */
    alt?: boolean;
    /** Whether this action should trigger on key down (true) or key up (false) */
    onKeyDown?: boolean;
    /** Whether this action can repeat when key is held */
    repeatable?: boolean;
}

/**
 * Input configuration including all key bindings and settings.
 */
export interface InputConfig {
    /** All key bindings */
    bindings: KeyBinding[];
    /** Drag threshold in pixels - movement below this is a click, above is drag */
    dragThreshold: number;
    /** Camera pan speed (tiles per second) */
    cameraPanSpeed: number;
    /** Camera zoom speed (multiplier per scroll notch) */
    cameraZoomSpeed: number;
    /** Minimum zoom level */
    minZoom: number;
    /** Maximum zoom level */
    maxZoom: number;
    /** Whether to invert scroll direction for zoom */
    invertZoom: boolean;
    /** Whether to invert camera pan direction */
    invertPan: boolean;
}

/**
 * Default input configuration.
 * This provides standard RTS-style controls.
 */
export function getDefaultInputConfig(): InputConfig {
    return {
        bindings: [
            // Camera movement - WASD
            { action: InputAction.CameraPanUp, key: 'KeyW', repeatable: true, onKeyDown: true },
            { action: InputAction.CameraPanDown, key: 'KeyS', repeatable: true, onKeyDown: true },
            { action: InputAction.CameraPanLeft, key: 'KeyA', repeatable: true, onKeyDown: true },
            { action: InputAction.CameraPanRight, key: 'KeyD', repeatable: true, onKeyDown: true },

            // Camera movement - Arrow keys
            { action: InputAction.CameraPanUp, key: 'ArrowUp', repeatable: true, onKeyDown: true },
            { action: InputAction.CameraPanDown, key: 'ArrowDown', repeatable: true, onKeyDown: true },
            { action: InputAction.CameraPanLeft, key: 'ArrowLeft', repeatable: true, onKeyDown: true },
            { action: InputAction.CameraPanRight, key: 'ArrowRight', repeatable: true, onKeyDown: true },

            // Selection
            { action: InputAction.Select, mouseButton: MouseButton.Left, onKeyDown: true },
            { action: InputAction.SelectAdd, mouseButton: MouseButton.Left, shift: true, onKeyDown: true },
            { action: InputAction.SelectAll, key: 'KeyA', ctrl: true, onKeyDown: true },
            { action: InputAction.DeselectAll, key: 'Escape', onKeyDown: true },

            // Commands
            { action: InputAction.MoveUnit, mouseButton: MouseButton.Right, onKeyDown: true },
            { action: InputAction.AttackMove, key: 'KeyA', onKeyDown: true },
            { action: InputAction.Stop, key: 'KeyS', ctrl: true, onKeyDown: true },
            { action: InputAction.Delete, key: 'Delete', onKeyDown: true },
            { action: InputAction.Delete, key: 'Backspace', onKeyDown: true },

            // Building placement
            { action: InputAction.PlaceBuilding, mouseButton: MouseButton.Left, onKeyDown: true },
            { action: InputAction.CancelPlacement, key: 'Escape', onKeyDown: true },
            { action: InputAction.CancelPlacement, mouseButton: MouseButton.Right, onKeyDown: true },
            { action: InputAction.RotateBuilding, key: 'KeyR', onKeyDown: true },

            // Unit spawning
            { action: InputAction.SpawnCarrier, key: 'KeyU', onKeyDown: true },
            { action: InputAction.SpawnSwordsman, key: 'KeyI', onKeyDown: true },

            // UI toggles
            { action: InputAction.TogglePause, key: 'KeyP', onKeyDown: true },
            { action: InputAction.TogglePause, key: 'Space', onKeyDown: true },
            { action: InputAction.ToggleDebug, key: 'F3', onKeyDown: true },
            { action: InputAction.ToggleGrid, key: 'KeyG', onKeyDown: true },
            { action: InputAction.OpenBuildMenu, key: 'KeyB', onKeyDown: true },

            // Quick build keys
            { action: InputAction.QuickBuild1, key: 'Digit1', onKeyDown: true },
            { action: InputAction.QuickBuild2, key: 'Digit2', onKeyDown: true },
            { action: InputAction.QuickBuild3, key: 'Digit3', onKeyDown: true },
            { action: InputAction.QuickBuild4, key: 'Digit4', onKeyDown: true },
            { action: InputAction.QuickBuild5, key: 'Digit5', onKeyDown: true },
            { action: InputAction.QuickBuild6, key: 'Digit6', onKeyDown: true },
            { action: InputAction.QuickBuild7, key: 'Digit7', onKeyDown: true },
            { action: InputAction.QuickBuild8, key: 'Digit8', onKeyDown: true },
            { action: InputAction.QuickBuild9, key: 'Digit9', onKeyDown: true },
        ],

        dragThreshold: 5,
        cameraPanSpeed: 40,
        cameraZoomSpeed: 0.1,
        minZoom: 0.25,
        maxZoom: 4.0,
        invertZoom: false,
        invertPan: false,
    };
}

/**
 * Merge user config with defaults.
 */
export function mergeInputConfig(
    defaults: InputConfig,
    overrides: Partial<InputConfig>
): InputConfig {
    return {
        ...defaults,
        ...overrides,
        bindings: overrides.bindings ?? defaults.bindings,
    };
}

/**
 * Find all bindings for a given action.
 */
export function findBindingsForAction(
    config: InputConfig,
    action: InputAction
): KeyBinding[] {
    return config.bindings.filter(b => b.action === action);
}

/** Check if required modifiers are pressed */
function checkRequiredModifiers(
    binding: KeyBinding,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean
): boolean {
    if (binding.shift && !shiftKey) return false;
    if (binding.ctrl && !ctrlKey) return false;
    if (binding.alt && !altKey) return false;
    return true;
}

/** Check if unwanted modifiers are pressed when binding has no modifier requirements */
function hasUnwantedModifiers(binding: KeyBinding, ctrlKey: boolean, altKey: boolean): boolean {
    const noModifiersRequired = !binding.shift && !binding.ctrl && !binding.alt;
    return noModifiersRequired && (ctrlKey || altKey);
}

/**
 * Check if a key event matches a binding.
 */
export function matchesKeyBinding(
    binding: KeyBinding,
    code: string,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean
): boolean {
    if (!binding.key && !binding.altKey) return false;

    const keyMatches = binding.key === code || binding.altKey === code;
    if (!keyMatches) return false;

    if (!checkRequiredModifiers(binding, shiftKey, ctrlKey, altKey)) return false;
    if (hasUnwantedModifiers(binding, ctrlKey, altKey)) return false;

    return true;
}

/**
 * Check if a mouse event matches a binding.
 */
export function matchesMouseBinding(
    binding: KeyBinding,
    button: MouseButton,
    shiftKey: boolean,
    ctrlKey: boolean,
    altKey: boolean
): boolean {
    // Must have a mouse button to match
    if (binding.mouseButton === undefined) return false;
    if (binding.mouseButton !== button) return false;

    // Check modifiers
    if (binding.shift && !shiftKey) return false;
    if (!binding.shift && shiftKey) return false;
    if (binding.ctrl && !ctrlKey) return false;
    if (binding.alt && !altKey) return false;

    return true;
}
