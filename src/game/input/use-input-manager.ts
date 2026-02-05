import { ref, shallowRef, watch, onUnmounted, type Ref, type ShallowRef } from 'vue';
import { InputManager, type TileResolver, type CommandExecutor } from './input-manager';
import type { InputConfig } from './input-config';
import type { InputMode } from './input-mode';
import { SelectMode } from './modes/select-mode';
import { PlaceBuildingMode } from './modes/place-building-mode';
import type { BuildingType } from '../entity';
import { type ModeRenderState, createDefaultRenderState } from './render-state';

/**
 * Options for useInputManager composable.
 */
export interface UseInputManagerOptions {
    /** Target canvas element */
    canvas: Ref<HTMLCanvasElement | null>;
    /** Input configuration */
    config?: InputConfig;
    /** Function to resolve screen coordinates to tile coordinates */
    tileResolver?: Ref<TileResolver | null>;
    /** Function to execute game commands */
    commandExecutor?: Ref<CommandExecutor | null>;
}

/**
 * Return type for useInputManager composable.
 */
export interface UseInputManagerReturn {
    /** The input manager instance */
    manager: ShallowRef<InputManager | null>;
    /** Current mode name */
    modeName: Ref<string>;
    /** Whether input manager is ready */
    isReady: Ref<boolean>;
    /** Current render state from the active mode - updated each frame */
    renderState: Ref<ModeRenderState>;

    // Camera state
    /** Camera X position */
    cameraX: Ref<number>;
    /** Camera Y position */
    cameraY: Ref<number>;
    /** Camera zoom level */
    cameraZoom: Ref<number>;

    // Mode control
    /** Switch to select mode */
    selectMode: () => void;
    /** Switch to building placement mode */
    placeBuildingMode: (buildingType: BuildingType, player?: number) => void;
    /** Register a custom mode */
    registerMode: (mode: InputMode) => void;

    // Camera control
    /** Set camera position */
    setCamera: (x: number, y: number) => void;
    /** Set camera zoom */
    setZoom: (zoom: number) => void;

    // Configuration
    /** Update input configuration */
    setConfig: (config: InputConfig) => void;

    // Update loop
    /** Call each frame to update input state */
    update: (deltaTime: number) => void;
}

/**
 * Vue composable for managing game input.
 *
 * @example
 * ```vue
 * <script setup>
 * const canvas = ref<HTMLCanvasElement | null>(null);
 * const { manager, modeName, cameraX, cameraY, selectMode, placeBuildingMode } = useInputManager({
 *     canvas,
 *     tileResolver: computed(() => tilePicker ? (x, y) => tilePicker.screenToTile(x, y) : null),
 *     commandExecutor: computed(() => game ? (cmd) => game.execute(cmd) : null),
 * });
 * </script>
 * ```
 */
export function useInputManager(options: UseInputManagerOptions): UseInputManagerReturn {
    const manager = shallowRef<InputManager | null>(null);
    const modeName = ref('select');
    const isReady = ref(false);
    const renderState = ref<ModeRenderState>(createDefaultRenderState());

    // Camera state (reactive)
    const cameraX = ref(0);
    const cameraY = ref(0);
    const cameraZoom = ref(1);

    // Initialize manager when canvas is available
    function initManager(): void {
        if (!options.canvas.value) return;

        // Clean up existing manager
        if (manager.value) {
            manager.value.destroy();
        }

        // Create new manager
        manager.value = new InputManager({
            target: options.canvas as Ref<HTMLElement | null>,
            config: options.config,
            tileResolver: options.tileResolver?.value ?? undefined,
            commandExecutor: options.commandExecutor?.value ?? undefined,
            initialMode: 'select',
            onModeChange: (oldMode, newMode) => {
                modeName.value = newMode;
            },
        });

        // Register default modes
        manager.value.registerMode(new SelectMode());
        manager.value.registerMode(new PlaceBuildingMode());

        // Attach event listeners
        manager.value.attach();

        isReady.value = true;
    }

    // Watch for canvas changes
    watch(() => options.canvas.value, (newCanvas) => {
        if (newCanvas) {
            initManager();
        }
    }, { immediate: true });

    // Watch for tile resolver changes
    watch(() => options.tileResolver?.value, (resolver) => {
        manager.value?.setTileResolver(resolver ?? null);
    });

    // Watch for command executor changes
    watch(() => options.commandExecutor?.value, (executor) => {
        manager.value?.setCommandExecutor(executor ?? null);
    });

    // Cleanup on unmount
    onUnmounted(() => {
        manager.value?.destroy();
        manager.value = null;
        isReady.value = false;
    });

    // Mode control functions
    function selectMode(): void {
        manager.value?.switchMode('select');
    }

    function placeBuildingMode(buildingType: BuildingType, player?: number): void {
        manager.value?.switchMode('place_building', { buildingType, player });
    }

    function registerMode(mode: InputMode): void {
        manager.value?.registerMode(mode);
    }

    // Camera control functions
    function setCamera(x: number, y: number): void {
        manager.value?.getCamera().setPosition(x, y);
        cameraX.value = x;
        cameraY.value = y;
    }

    function setZoom(zoom: number): void {
        manager.value?.getCamera().setZoom(zoom);
        cameraZoom.value = zoom;
    }

    // Configuration
    function setConfig(config: InputConfig): void {
        manager.value?.setConfig(config);
    }

    // Update function (call each frame)
    function update(deltaTime: number): void {
        if (!manager.value) return;

        manager.value.update(deltaTime);

        // Sync camera state
        const camera = manager.value.getCamera();
        cameraX.value = camera.x;
        cameraY.value = camera.y;
        cameraZoom.value = camera.zoom;

        // Sync render state from current mode
        const newRenderState = manager.value.getRenderState();
        if (newRenderState) {
            renderState.value = newRenderState;
        }
    }

    return {
        manager,
        modeName,
        isReady,
        renderState,
        cameraX,
        cameraY,
        cameraZoom,
        selectMode,
        placeBuildingMode,
        registerMode,
        setCamera,
        setZoom,
        setConfig,
        update,
    };
}

/**
 * Create input manager for testing or non-Vue contexts.
 */
export function createInputManager(
    target: Ref<HTMLElement | null>,
    config?: InputConfig
): InputManager {
    const manager = new InputManager({
        target,
        config,
        initialMode: 'select',
    });

    manager.registerMode(new SelectMode());
    manager.registerMode(new PlaceBuildingMode());

    return manager;
}
