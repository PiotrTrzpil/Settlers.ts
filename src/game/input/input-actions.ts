/**
 * All possible input actions in the game.
 * Actions are decoupled from specific keys/buttons - bindings are configurable.
 */
export enum InputAction {
    // Camera movement
    CameraPanUp = 'camera_pan_up',
    CameraPanDown = 'camera_pan_down',
    CameraPanLeft = 'camera_pan_left',
    CameraPanRight = 'camera_pan_right',
    CameraZoomIn = 'camera_zoom_in',
    CameraZoomOut = 'camera_zoom_out',

    // Selection
    Select = 'select',
    SelectAdd = 'select_add',          // Add to selection (shift+click)
    SelectAll = 'select_all',
    DeselectAll = 'deselect_all',

    // Commands
    MoveUnit = 'move_unit',
    AttackMove = 'attack_move',
    Stop = 'stop',
    Delete = 'delete',

    // Building placement
    PlaceBuilding = 'place_building',
    CancelPlacement = 'cancel_placement',
    RotateBuilding = 'rotate_building',

    // UI
    TogglePause = 'toggle_pause',
    ToggleDebug = 'toggle_debug',
    ToggleGrid = 'toggle_grid',
    OpenBuildMenu = 'open_build_menu',

    // Quick select building types (1-9 keys)
    QuickBuild1 = 'quick_build_1',
    QuickBuild2 = 'quick_build_2',
    QuickBuild3 = 'quick_build_3',
    QuickBuild4 = 'quick_build_4',
    QuickBuild5 = 'quick_build_5',
    QuickBuild6 = 'quick_build_6',
    QuickBuild7 = 'quick_build_7',
    QuickBuild8 = 'quick_build_8',
    QuickBuild9 = 'quick_build_9',
}

/**
 * Mouse buttons
 */
export enum MouseButton {
    Left = 0,
    Middle = 1,
    Right = 2,
}

/**
 * Pointer event types we care about
 */
export type PointerEventType = 'down' | 'up' | 'move' | 'click' | 'drag' | 'wheel';

/**
 * Processed pointer event data
 */
export interface PointerData {
    /** Screen X coordinate */
    screenX: number;
    /** Screen Y coordinate */
    screenY: number;
    /** Tile X coordinate (if resolved) */
    tileX?: number;
    /** Tile Y coordinate (if resolved) */
    tileY?: number;
    /** Which button was pressed/released */
    button: MouseButton;
    /** Whether shift is held */
    shiftKey: boolean;
    /** Whether ctrl/cmd is held */
    ctrlKey: boolean;
    /** Whether alt is held */
    altKey: boolean;
    /** Wheel delta (for scroll events) */
    wheelDelta?: number;
    /** Original DOM event */
    originalEvent: PointerEvent | WheelEvent;
}

/**
 * Drag state data
 */
export interface DragData {
    /** Starting screen position */
    startX: number;
    startY: number;
    /** Current screen position */
    currentX: number;
    currentY: number;
    /** Starting tile (if resolved) */
    startTileX?: number;
    startTileY?: number;
    /** Current tile (if resolved) */
    currentTileX?: number;
    currentTileY?: number;
    /** Which button initiated the drag */
    button: MouseButton;
    /** Whether this is considered a drag (exceeded threshold) */
    isDragging: boolean;
}

/**
 * Keyboard event data
 */
export interface KeyboardData {
    /** The key code */
    key: string;
    /** The physical key code */
    code: string;
    /** Whether shift is held */
    shiftKey: boolean;
    /** Whether ctrl/cmd is held */
    ctrlKey: boolean;
    /** Whether alt is held */
    altKey: boolean;
    /** Whether this is a repeat event */
    repeat: boolean;
}
