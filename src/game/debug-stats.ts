import { reactive, watch } from 'vue';
import { EntityType } from './entity';
import type { Game } from './game';

const WINDOW_SIZE = 60;
const SETTINGS_STORAGE_KEY = 'settlers_debug_settings';

/** Load timing data for each layer */
export interface LoadTimings {
    landscape: number;
    filePreload: number;
    atlasAlloc: number;
    buildings: number;
    mapObjects: number;
    resources: number;
    units: number;
    gpuUpload: number;
    totalSprites: number;
    atlasSize: string;
    spriteCount: number;
}

export interface DebugStatsState {
    // Readiness (for Playwright tests)
    gameLoaded: boolean;
    rendererReady: boolean;
    frameCount: number;

    // Load timings
    loadTimings: LoadTimings;

    // Performance
    fps: number;
    frameTimeMs: number;
    frameTimeMin: number;
    frameTimeMax: number;
    ticksPerSec: number;

    // Entities
    entityCount: number;
    buildingCount: number;
    unitCount: number;
    unitsMoving: number;
    totalPathSteps: number;

    // Camera (written externally)
    cameraX: number;
    cameraY: number;
    zoom: number;
    zoomSpeed: number;
    panSpeed: number;
    canvasWidth: number;
    canvasHeight: number;

    // Tile (written externally)
    tileX: number;
    tileY: number;
    tileGroundType: number;
    tileGroundHeight: number;
    hasTile: boolean;

    // Game mode (written by InputManager onModeChange callback)
    mode: string;
    placeBuildingType: number;
    placeResourceType: number;
    placeUnitType: number;
    selectedEntityId: number | null;
    selectedCount: number;

    // Audio state (for e2e tests)
    musicEnabled: boolean;
    musicPlaying: boolean;
    currentMusicId: string | null;

    // River texture debug
    riverSlotPermutation: number;
    riverFlipInner: boolean;
    riverFlipOuter: boolean;
    riverFlipMiddle: boolean;

    // Debug panel UI state (persisted)
    debugPanelOpen: boolean;
    debugGridEnabled: boolean;

    // Layer panel UI state (persisted)
    layerPanelOpen: boolean;
}

/** Settings that should be persisted to localStorage */
interface PersistedDebugSettings {
    zoomSpeed: number;
    panSpeed: number;
    riverSlotPermutation: number;
    riverFlipInner: boolean;
    riverFlipOuter: boolean;
    riverFlipMiddle: boolean;
    debugPanelOpen: boolean;
    debugGridEnabled: boolean;
    layerPanelOpen: boolean;
}

/** Default values for persisted settings */
const DEFAULT_SETTINGS: PersistedDebugSettings = {
    zoomSpeed: 0.05,
    panSpeed: 40,
    riverSlotPermutation: 0,
    riverFlipInner: false,
    riverFlipOuter: false,
    riverFlipMiddle: false,
    debugPanelOpen: false,
    debugGridEnabled: false,
    layerPanelOpen: false,
};

/** Load persisted settings from localStorage */
function loadDebugSettings(): PersistedDebugSettings {
    try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!stored) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(stored) as Partial<PersistedDebugSettings>;
        return {
            zoomSpeed: parsed.zoomSpeed ?? DEFAULT_SETTINGS.zoomSpeed,
            panSpeed: parsed.panSpeed ?? DEFAULT_SETTINGS.panSpeed,
            riverSlotPermutation: parsed.riverSlotPermutation ?? DEFAULT_SETTINGS.riverSlotPermutation,
            riverFlipInner: parsed.riverFlipInner ?? DEFAULT_SETTINGS.riverFlipInner,
            riverFlipOuter: parsed.riverFlipOuter ?? DEFAULT_SETTINGS.riverFlipOuter,
            riverFlipMiddle: parsed.riverFlipMiddle ?? DEFAULT_SETTINGS.riverFlipMiddle,
            debugPanelOpen: parsed.debugPanelOpen ?? DEFAULT_SETTINGS.debugPanelOpen,
            debugGridEnabled: parsed.debugGridEnabled ?? DEFAULT_SETTINGS.debugGridEnabled,
            layerPanelOpen: parsed.layerPanelOpen ?? DEFAULT_SETTINGS.layerPanelOpen,
        };
    } catch (e) {
        console.warn('Failed to load debug settings from localStorage:', e);
        return { ...DEFAULT_SETTINGS };
    }
}

/** Save persisted settings to localStorage */
function saveDebugSettings(settings: PersistedDebugSettings): void {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save debug settings to localStorage:', e);
    }
}

class DebugStats {
    public readonly state: DebugStatsState;

    private frameTimes: number[] = [];
    private lastFrameTime = 0;
    private tickCount = 0;
    private tickResetTime = 0;

    constructor() {
        // Load persisted settings
        const savedSettings = loadDebugSettings();

        this.state = reactive<DebugStatsState>({
            gameLoaded: false,
            rendererReady: false,
            frameCount: 0,
            loadTimings: {
                landscape: 0,
                filePreload: 0,
                atlasAlloc: 0,
                buildings: 0,
                mapObjects: 0,
                resources: 0,
                units: 0,
                gpuUpload: 0,
                totalSprites: 0,
                atlasSize: '',
                spriteCount: 0,
            },
            fps: 0,
            frameTimeMs: 0,
            frameTimeMin: 0,
            frameTimeMax: 0,
            ticksPerSec: 0,
            entityCount: 0,
            buildingCount: 0,
            unitCount: 0,
            unitsMoving: 0,
            totalPathSteps: 0,
            cameraX: 0,
            cameraY: 0,
            zoom: 0,
            zoomSpeed: savedSettings.zoomSpeed,
            panSpeed: savedSettings.panSpeed,
            canvasWidth: 0,
            canvasHeight: 0,
            tileX: 0,
            tileY: 0,
            tileGroundType: 0,
            tileGroundHeight: 0,
            hasTile: false,
            mode: 'select',
            placeBuildingType: 0,
            placeResourceType: 0,
            placeUnitType: 0,
            selectedEntityId: null,
            selectedCount: 0,
            musicEnabled: true,
            musicPlaying: false,
            currentMusicId: null,
            riverSlotPermutation: savedSettings.riverSlotPermutation,
            riverFlipInner: savedSettings.riverFlipInner,
            riverFlipOuter: savedSettings.riverFlipOuter,
            riverFlipMiddle: savedSettings.riverFlipMiddle,
            debugPanelOpen: savedSettings.debugPanelOpen,
            debugGridEnabled: savedSettings.debugGridEnabled,
            layerPanelOpen: savedSettings.layerPanelOpen,
        });

        // Expose on window for Playwright tests
        (window as any).__settlers_debug__ = this.state;

        // Set up watchers to auto-save settings when they change
        this.setupSettingsWatchers();
    }

    /** Set up watchers to persist settings on change */
    private setupSettingsWatchers(): void {
        // Watch all persisted settings and save when any changes
        const settingsKeys: (keyof PersistedDebugSettings)[] = [
            'zoomSpeed', 'panSpeed', 'riverSlotPermutation',
            'riverFlipInner', 'riverFlipOuter', 'riverFlipMiddle',
            'debugPanelOpen', 'debugGridEnabled', 'layerPanelOpen'
        ];

        for (const key of settingsKeys) {
            watch(
                () => this.state[key],
                () => this.saveSettings(),
                { flush: 'post' }
            );
        }
    }

    /** Save current settings to localStorage */
    private saveSettings(): void {
        saveDebugSettings({
            zoomSpeed: this.state.zoomSpeed,
            panSpeed: this.state.panSpeed,
            riverSlotPermutation: this.state.riverSlotPermutation,
            riverFlipInner: this.state.riverFlipInner,
            riverFlipOuter: this.state.riverFlipOuter,
            riverFlipMiddle: this.state.riverFlipMiddle,
            debugPanelOpen: this.state.debugPanelOpen,
            debugGridEnabled: this.state.debugGridEnabled,
            layerPanelOpen: this.state.layerPanelOpen,
        });
    }

    public recordFrame(now: number): void {
        this.state.frameCount++;
        if (this.lastFrameTime > 0) {
            const dt = now - this.lastFrameTime;
            this.frameTimes.push(dt);
            if (this.frameTimes.length > WINDOW_SIZE) {
                this.frameTimes.shift();
            }

            const sum = this.frameTimes.reduce((a, b) => a + b, 0);
            const avg = sum / this.frameTimes.length;
            this.state.fps = Math.round(1000 / avg);
            this.state.frameTimeMs = Math.round(avg * 10) / 10;
            this.state.frameTimeMin = Math.round(Math.min(...this.frameTimes) * 10) / 10;
            this.state.frameTimeMax = Math.round(Math.max(...this.frameTimes) * 10) / 10;
        }
        this.lastFrameTime = now;
    }

    public recordTick(): void {
        this.tickCount++;
        const now = performance.now();
        if (now - this.tickResetTime >= 1000) {
            this.state.ticksPerSec = this.tickCount;
            this.tickCount = 0;
            this.tickResetTime = now;
        }
    }

    public updateFromGame(game: Game): void {
        // Expose game reference for e2e tests (Vue internals are stripped in prod builds)
        (window as any).__settlers_game__ = game;
        const gameState = game.state;
        this.state.entityCount = gameState.entities.length;

        let buildings = 0;
        let units = 0;
        for (const e of gameState.entities) {
            if (e.type === EntityType.Building) buildings++;
            else if (e.type === EntityType.Unit) units++;
        }
        this.state.buildingCount = buildings;
        this.state.unitCount = units;

        let moving = 0;
        let pathSteps = 0;
        for (const controller of gameState.movement.getAllControllers()) {
            const remaining = controller.path.length - controller.pathIndex;
            if (remaining > 0) {
                moving++;
                pathSteps += remaining;
            }
        }
        this.state.unitsMoving = moving;
        this.state.totalPathSteps = pathSteps;

        // Note: mode and placeBuildingType are managed by InputManager onModeChange callback
        // to ensure immediate updates without frame delay
        this.state.selectedEntityId = gameState.selectedEntityId;
        this.state.selectedCount = gameState.selectedEntityIds.size;

        // Update audio state
        const soundManager = game.soundManager;
        this.state.musicEnabled = soundManager.isMusicEnabled;
        this.state.currentMusicId = soundManager.currentMusicId;
        this.state.musicPlaying = soundManager.currentMusicId !== null;
    }
}

export const debugStats = new DebugStats();
