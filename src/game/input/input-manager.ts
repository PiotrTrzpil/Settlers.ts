import type { Ref } from 'vue';
import type { TileCoord } from '../entity';
import type { InputMode, InputContext, InputResult } from './input-mode';
import type { InputConfig } from './input-config';
import type { InputState } from './input-state';
import type { ModeRenderState } from './render-state';
import {
    InputAction,
    MouseButton,
    type PointerData,
    type KeyboardData,
} from './input-actions';
import {
    matchesKeyBinding,
    matchesMouseBinding,
    getDefaultInputConfig,
} from './input-config';
import {
    createInputState,
    handleKeyDown,
    handleKeyUp,
    handlePointerDown,
    handlePointerUp,
    clearKeyboardState,
} from './input-state';
import { CameraMode } from './modes/camera-mode';


/**
 * Tile resolver function type.
 */
export type TileResolver = (screenX: number, screenY: number) => TileCoord | null;

/**
 * Command executor function type.
 */
export type CommandExecutor = (command: any) => boolean;

/**
 * Mode change callback.
 */
export type ModeChangeCallback = (oldMode: string, newMode: string, data?: any) => void;

/**
 * Input manager configuration.
 */
export interface InputManagerOptions {
    /** Target element for input events */
    target: Ref<HTMLElement | null>;
    /** Input configuration (key bindings, etc.) */
    config?: InputConfig;
    /** Function to resolve screen coordinates to tile coordinates */
    tileResolver?: TileResolver;
    /** Function to execute game commands */
    commandExecutor?: CommandExecutor;
    /** Initial mode name */
    initialMode?: string;
    /** Callback when mode changes */
    onModeChange?: ModeChangeCallback;
}

/**
 * Central input manager that coordinates all input handling.
 */
export class InputManager {
    private config: InputConfig;
    private target: Ref<HTMLElement | null>;
    private state: InputState;
    private modes: Map<string, InputMode> = new Map();
    private currentModeName: string = 'select';
    private modeData: Map<string, any> = new Map();
    private tileResolver: TileResolver | null = null;
    private commandExecutor: CommandExecutor | null = null;
    private onModeChange: ModeChangeCallback | null = null;
    private cameraMode: CameraMode;
    private isDestroyed = false;

    // Bound event handlers for cleanup
    private boundHandlers: {
        pointerdown: (e: PointerEvent) => void;
        pointerup: (e: PointerEvent) => void;
        pointermove: (e: PointerEvent) => void;
        wheel: (e: WheelEvent) => void;
        contextmenu: (e: Event) => void;
        keydown: (e: KeyboardEvent) => void;
        keyup: (e: KeyboardEvent) => void;
        blur: () => void;
    };

    constructor(options: InputManagerOptions) {
        this.config = options.config ?? getDefaultInputConfig();
        this.target = options.target;
        this.tileResolver = options.tileResolver ?? null;
        this.commandExecutor = options.commandExecutor ?? null;
        this.onModeChange = options.onModeChange ?? null;

        // Create input state tracker
        this.state = createInputState(this.target, this.config);

        // Create camera mode (always active)
        this.cameraMode = new CameraMode(this.config);

        // Bind event handlers
        this.boundHandlers = {
            pointerdown: this.handlePointerDown.bind(this),
            pointerup: this.handlePointerUp.bind(this),
            pointermove: this.handlePointerMove.bind(this),
            wheel: this.handleWheel.bind(this),
            contextmenu: this.handleContextMenu.bind(this),
            keydown: this.handleKeyDown.bind(this),
            keyup: this.handleKeyUp.bind(this),
            blur: this.handleBlur.bind(this),
        };

        // Set initial mode
        if (options.initialMode) {
            this.currentModeName = options.initialMode;
        }
    }

    /**
     * Register an input mode.
     */
    registerMode(mode: InputMode): void {
        this.modes.set(mode.name, mode);
    }

    /**
     * Unregister an input mode.
     */
    unregisterMode(name: string): void {
        this.modes.delete(name);
        this.modeData.delete(name);
    }

    /**
     * Get the current mode name.
     */
    getModeName(): string {
        return this.currentModeName;
    }

    /**
     * Get the current mode instance.
     */
    getCurrentMode(): InputMode | undefined {
        return this.modes.get(this.currentModeName);
    }

    /**
     * Switch to a different mode.
     */
    switchMode(name: string, data?: any): void {
        const oldMode = this.getCurrentMode();
        const newMode = this.modes.get(name);

        if (!newMode) {
            console.warn(`InputManager: Unknown mode '${name}'`);
            return;
        }

        const oldModeName = this.currentModeName;

        // Exit old mode
        if (oldMode?.onExit) {
            oldMode.onExit(this.createContext());
        }

        // Clear mode-specific data
        this.modeData.delete(oldModeName);

        // Switch mode
        this.currentModeName = name;

        // Enter new mode
        if (newMode.onEnter) {
            newMode.onEnter(this.createContext(), data);
        }

        // Notify listeners
        this.onModeChange?.(oldModeName, name, data);
    }

    /**
     * Get the camera mode for direct access to camera state.
     */
    getCamera(): CameraMode {
        return this.cameraMode;
    }

    /**
     * Set the tile resolver function.
     */
    setTileResolver(resolver: TileResolver | null): void {
        this.tileResolver = resolver;
    }

    /**
     * Set the command executor function.
     */
    setCommandExecutor(executor: CommandExecutor | null): void {
        this.commandExecutor = executor;
    }

    /**
     * Get the current input state.
     */
    getState(): InputState {
        return this.state;
    }

    /**
     * Get the input configuration.
     */
    getConfig(): InputConfig {
        return this.config;
    }

    /**
     * Get the tile at the center of the screen/camera.
     */
    getCenterTile(): TileCoord | null {
        const el = this.target.value;
        if (!el || !this.tileResolver) return null;

        const centerX = el.clientWidth / 2;
        const centerY = el.clientHeight / 2;
        return this.tileResolver(centerX, centerY);
    }

    /**
     * Update the input configuration.
     */
    setConfig(config: InputConfig): void {
        this.config = config;
    }

    /**
     * Attach event listeners to target element.
     */
    attach(): void {
        const el = this.target.value;
        if (!el) return;

        el.addEventListener('pointerdown', this.boundHandlers.pointerdown);
        el.addEventListener('pointerup', this.boundHandlers.pointerup);
        el.addEventListener('pointermove', this.boundHandlers.pointermove);
        el.addEventListener('wheel', this.boundHandlers.wheel, { passive: false });
        el.addEventListener('contextmenu', this.boundHandlers.contextmenu);

        window.addEventListener('keydown', this.boundHandlers.keydown);
        window.addEventListener('keyup', this.boundHandlers.keyup);
        window.addEventListener('blur', this.boundHandlers.blur);
    }

    /**
     * Detach event listeners.
     */
    detach(): void {
        const el = this.target.value;
        if (el) {
            el.removeEventListener('pointerdown', this.boundHandlers.pointerdown);
            el.removeEventListener('pointerup', this.boundHandlers.pointerup);
            el.removeEventListener('pointermove', this.boundHandlers.pointermove);
            el.removeEventListener('wheel', this.boundHandlers.wheel);
            el.removeEventListener('contextmenu', this.boundHandlers.contextmenu);
        }

        window.removeEventListener('keydown', this.boundHandlers.keydown);
        window.removeEventListener('keyup', this.boundHandlers.keyup);
        window.removeEventListener('blur', this.boundHandlers.blur);
    }

    /**
     * Clean up all resources.
     */
    destroy(): void {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
        this.detach();
        this.modes.clear();
        this.modeData.clear();
    }

    /**
     * Update input state (call each frame).
     */
    update(deltaTime: number): void {
        const context = this.createContext();

        // Update camera mode
        this.cameraMode.onUpdate(deltaTime, context);

        // Update current mode
        const mode = this.getCurrentMode();
        mode?.onUpdate?.(deltaTime, context);
    }

    /**
     * Get the current render state from the active mode.
     * This is the primary way for the rendering system to know what overlays to draw.
     */
    getRenderState(): ModeRenderState | null {
        const mode = this.getCurrentMode();
        if (!mode) return null;

        const context = this.createContext();
        return mode.getRenderState(context);
    }

    // ─── Private Methods ─────────────────────────────────────────────────

    private createContext(): InputContext {
        const currentTile = this.resolveTile(
            this.state.mouseX.value,
            this.state.mouseY.value
        );

        return {
            state: this.state,
            currentTile,
            executeCommand: (cmd) => this.commandExecutor?.(cmd) ?? false,
            switchMode: (mode, data) => this.switchMode(mode, data),
            getModeData: <T>() => this.modeData.get(this.currentModeName) as T | undefined,
            setModeData: <T>(data: T) => this.modeData.set(this.currentModeName, data),
        };
    }

    private resolveTile(screenX: number, screenY: number): TileCoord | null {
        return this.tileResolver?.(screenX, screenY) ?? null;
    }

    private createPointerData(e: PointerEvent | WheelEvent, tile?: TileCoord | null): PointerData {
        const rect = this.target.value?.getBoundingClientRect();
        const screenX = rect ? e.clientX - rect.left : e.clientX;
        const screenY = rect ? e.clientY - rect.top : e.clientY;
        const resolvedTile = tile ?? this.resolveTile(screenX, screenY);

        return {
            screenX,
            screenY,
            tileX: resolvedTile?.x,
            tileY: resolvedTile?.y,
            button: (e as PointerEvent).button as MouseButton ?? MouseButton.Left,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey || e.metaKey,
            altKey: e.altKey,
            wheelDelta: (e as WheelEvent).deltaY,
            originalEvent: e,
        };
    }

    private createKeyboardData(e: KeyboardEvent): KeyboardData {
        return {
            key: e.key,
            code: e.code,
            shiftKey: e.shiftKey,
            ctrlKey: e.ctrlKey || e.metaKey,
            altKey: e.altKey,
            repeat: e.repeat,
        };
    }

    private applyResult(result: InputResult, e: Event): void {
        if (result.preventDefault) {
            e.preventDefault();
        }
        if (result.stopPropagation) {
            e.stopPropagation();
        }
    }

    private findActionForKey(
        code: string,
        shiftKey: boolean,
        ctrlKey: boolean,
        altKey: boolean
    ): InputAction | null {
        for (const binding of this.config.bindings) {
            if (matchesKeyBinding(binding, code, shiftKey, ctrlKey, altKey)) {
                return binding.action;
            }
        }
        return null;
    }

    private findActionForMouse(
        button: MouseButton,
        shiftKey: boolean,
        ctrlKey: boolean,
        altKey: boolean
    ): InputAction | null {
        for (const binding of this.config.bindings) {
            if (matchesMouseBinding(binding, button, shiftKey, ctrlKey, altKey)) {
                return binding.action;
            }
        }
        return null;
    }

    // ─── Event Handlers ──────────────────────────────────────────────────

    private handlePointerDown(e: PointerEvent): void {
        handlePointerDown(this.state, e.button);

        const data = this.createPointerData(e);
        const context = this.createContext();

        // Try camera mode first
        let result = this.cameraMode.onPointerDown(data, context);
        if (result.handled) {
            this.applyResult(result, e);
            return;
        }

        // Then current mode
        const mode = this.getCurrentMode();
        result = mode?.onPointerDown?.(data, context) ?? { handled: false };
        this.applyResult(result, e);
    }

    private handlePointerUp(e: PointerEvent): void {
        handlePointerUp(this.state, e.button);

        const data = this.createPointerData(e);
        const context = this.createContext();
        const dragData = this.state.drag.value;

        // Check if this was a drag
        if (dragData?.isDragging) {
            // Try camera mode first
            let result = this.cameraMode.onDragEnd?.(dragData, context) ?? { handled: false };
            if (result.handled) {
                this.state.endDrag();
                this.applyResult(result, e);
                return;
            }

            // Then current mode
            const mode = this.getCurrentMode();
            result = mode?.onDragEnd?.(dragData, context) ?? { handled: false };
            this.state.endDrag();
            this.applyResult(result, e);
            return;
        }

        // Regular pointer up (click)
        // Try camera mode first
        let result = this.cameraMode.onPointerUp(data, context);
        if (result.handled) {
            this.applyResult(result, e);
            return;
        }

        // Then current mode
        const mode = this.getCurrentMode();
        result = mode?.onPointerUp?.(data, context) ?? { handled: false };
        this.applyResult(result, e);
    }

    private handlePointerMove(e: PointerEvent): void {
        const data = this.createPointerData(e);
        const context = this.createContext();

        // Update drag state if dragging
        if (this.state.drag.value) {
            this.state.updateDrag(data.screenX, data.screenY, data.tileX, data.tileY);

            if (this.state.drag.value.isDragging) {
                // Try camera mode first
                let result = this.cameraMode.onDrag?.(this.state.drag.value, context) ?? { handled: false };
                if (result.handled) {
                    this.applyResult(result, e);
                    return;
                }

                // Then current mode
                const mode = this.getCurrentMode();
                result = mode?.onDrag?.(this.state.drag.value, context) ?? { handled: false };
                if (result.handled) {
                    this.applyResult(result, e);
                    return;
                }
            }
        }

        // Regular pointer move
        // Try camera mode first
        let result = this.cameraMode.onPointerMove(data, context);
        if (result.handled) {
            this.applyResult(result, e);
            return;
        }

        // Then current mode
        const mode = this.getCurrentMode();
        result = mode?.onPointerMove?.(data, context) ?? { handled: false };
        this.applyResult(result, e);
    }

    private handleWheel(e: WheelEvent): void {
        const data = this.createPointerData(e);
        const context = this.createContext();

        // Camera mode handles zoom
        const result = this.cameraMode.onWheel(data, context);
        this.applyResult(result, e);
    }

    private handleContextMenu(e: Event): void {
        e.preventDefault();
    }

    private handleKeyDown(e: KeyboardEvent): void {
        // Don't handle input if focus is in an input element
        if (this.isInputFocused()) return;

        handleKeyDown(this.state, e.code);

        // Skip repeats unless action allows it
        const action = this.findActionForKey(e.code, e.shiftKey, e.ctrlKey || e.metaKey, e.altKey);
        if (action) {
            const binding = this.config.bindings.find(b => b.action === action);
            if (e.repeat && !binding?.repeatable) return;

            const context = this.createContext();
            const mode = this.getCurrentMode();
            const result = mode?.onAction?.(action, context) ?? { handled: false };
            this.applyResult(result, e);
        }

        // Also pass raw keyboard event to mode
        const keyData = this.createKeyboardData(e);
        const context = this.createContext();
        const mode = this.getCurrentMode();
        mode?.onKeyboard?.(keyData, true, context);
    }

    private handleKeyUp(e: KeyboardEvent): void {
        handleKeyUp(this.state, e.code);

        // Pass raw keyboard event to mode
        const keyData = this.createKeyboardData(e);
        const context = this.createContext();
        const mode = this.getCurrentMode();
        mode?.onKeyboard?.(keyData, false, context);
    }

    private handleBlur(): void {
        // Clear all keyboard state when window loses focus
        clearKeyboardState(this.state);
    }

    private isInputFocused(): boolean {
        const active = document.activeElement;
        if (!active) return false;
        const tag = active.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select';
    }
}
