// Input Actions & Types
export {
    InputAction,
    MouseButton,
    type PointerEventType,
    type PointerData,
    type DragData,
    type KeyboardData,
} from './input-actions';

// Configuration
export {
    type KeyBinding,
    type InputConfig,
    getDefaultInputConfig,
    mergeInputConfig,
    findBindingsForAction,
    matchesKeyBinding,
    matchesMouseBinding,
} from './input-config';

// State
export {
    type InputState,
    createInputState,
    handleKeyDown,
    handleKeyUp,
    handlePointerDown,
    handlePointerUp,
    clearKeyboardState,
    clearMouseState,
} from './input-state';

// Mode System
export {
    type InputMode,
    type InputContext,
    type InputResult,
    HANDLED,
    UNHANDLED,
    BaseInputMode,
} from './input-mode';

// Render State (for mode rendering)
export {
    CursorType,
    type ModeRenderState,
    type PlacementPreview,
    type PlacementEntityType,
    type BuildingPreview,
    type SelectionBox,
    type PathPreview,
    type TileHighlight,
    type ModePreview,
    createDefaultRenderState,
} from './render-state';

// Base Placement Mode
export {
    BasePlacementMode,
    type PlacementModeData,
    type PlacementModeEnterData,
} from './modes/place-mode-base';

// Built-in Modes
export { SelectMode } from './modes/select-mode';
export {
    PlaceBuildingMode,
    type PlaceBuildingModeData,
    type PlaceBuildingEnterData,
} from './modes/place-building-mode';
export {
    PlaceResourceMode,
    type PlaceResourceModeData,
    type PlaceResourceEnterData,
} from './modes/place-resource-mode';
export { CameraMode } from './modes/camera-mode';

// Input Manager
export {
    InputManager,
    type TileResolver,
    type CommandExecutor,
    type ModeChangeCallback,
    type InputManagerOptions,
} from './input-manager';

// Vue Composable
export {
    useInputManager,
    createInputManager,
    type UseInputManagerOptions,
    type UseInputManagerReturn,
} from './use-input-manager';

// TilePicker (existing)
export { TilePicker } from './tile-picker';
