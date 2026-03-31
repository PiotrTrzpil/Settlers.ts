import { reactive, watch, effectScope, type EffectScope } from 'vue';

const SETTINGS_STORAGE_KEY = 'settlers_game_settings';

/**
 * Game settings schema - add new settings here and they will be automatically
 * persisted to localStorage and restored on game start.
 */
export interface GameSettings {
    // Game
    paused: boolean;
    gameSpeed: number;

    // Camera
    zoomSpeed: number;
    panSpeed: number;

    // Audio
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;

    // Display
    showDebugGrid: boolean;
    disablePlayerTinting: boolean;
    showBuildingFootprint: boolean;
    darkLandDilation: boolean;
    darkGroundFixup: boolean;

    // Map loading
    treeExpansion: boolean;

    // Graphics
    antialias: boolean;

    // Building placement
    placeBuildingsCompleted: boolean;
    placeBuildingsWithWorker: boolean;

    // UI state (persisted)
    settingsPanelOpen: boolean;

    // Pathfinding
    /** Direction run length for hex line grouping.
     *  1 = maximum zigzag (alternating every tile), higher = straighter paths.
     *  Controls how many tiles a unit moves in one direction before turning. */
    pathStraightness: number;

    // Performance
    cacheDisabled: boolean;
    cacheCompressionEnabled: boolean;
}

/** Default values for all settings */
const DEFAULT_SETTINGS: GameSettings = {
    // Game
    paused: false,
    gameSpeed: 1.0,

    // Camera
    zoomSpeed: 0.05,
    panSpeed: 40,

    // Audio
    musicEnabled: true,
    musicVolume: 0.5,
    sfxEnabled: true,
    sfxVolume: 0.7,

    // Display
    showDebugGrid: false,
    disablePlayerTinting: false,
    showBuildingFootprint: false,
    darkLandDilation: true,
    darkGroundFixup: true,

    // Map loading
    treeExpansion: true,

    // Graphics
    antialias: true,

    // Building placement
    placeBuildingsCompleted: false,
    placeBuildingsWithWorker: true,

    // Pathfinding
    pathStraightness: 8,

    // UI state
    settingsPanelOpen: false,

    // Performance
    cacheDisabled: false,
    cacheCompressionEnabled: true,
};

/** Load settings from localStorage, merging with defaults */
function loadSettings(): GameSettings {
    try {
        if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
            return { ...DEFAULT_SETTINGS };
        }
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!stored) {
            return { ...DEFAULT_SETTINGS };
        }

        const parsed = JSON.parse(stored) as Partial<GameSettings>;

        // Merge with defaults to handle new settings added in future versions
        return {
            ...DEFAULT_SETTINGS,
            ...parsed,
        };
    } catch (e) {
        console.warn('Failed to load game settings from localStorage:', e);
        return { ...DEFAULT_SETTINGS };
    }
}

/** Save settings to localStorage */
function saveSettings(settings: GameSettings): void {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save game settings to localStorage:', e);
    }
}

/**
 * Centralized game settings manager.
 * - Automatically loads settings from localStorage on init
 * - Automatically saves settings when any value changes
 * - Exposes reactive state for Vue components
 */
export class GameSettingsManager {
    public readonly state: GameSettings;

    private saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private readonly _scope: EffectScope;

    constructor() {
        // Load persisted settings
        this.state = reactive<GameSettings>(loadSettings());

        // Set up watchers to auto-save settings when they change — scoped so they
        // can be stopped when this manager is destroyed (prevents Vue watcher leaks).
        this._scope = effectScope();
        this._scope.run(() => this.setupAutoSave());
    }

    /** Stop auto-save watchers and flush any pending save. Call from Game.destroy(). */
    public destroy(): void {
        this._scope.stop();
        if (this.saveTimeoutId !== null) {
            clearTimeout(this.saveTimeoutId);
            saveSettings(this.state); // flush pending write
            this.saveTimeoutId = null;
        }
    }

    /** Set up watchers to persist settings on change (debounced) */
    private setupAutoSave(): void {
        // Watch all settings keys and save when any changes
        const settingsKeys = Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[];

        for (const key of settingsKeys) {
            watch(
                () => this.state[key],
                () => this.debouncedSave(),
                { flush: 'post' }
            );
        }
    }

    /** Debounced save to avoid excessive writes */
    private debouncedSave(): void {
        if (this.saveTimeoutId !== null) {
            clearTimeout(this.saveTimeoutId);
        }
        this.saveTimeoutId = setTimeout(() => {
            saveSettings(this.state);
            this.saveTimeoutId = null;
        }, 100);
    }

    /** Reset all settings to defaults */
    public resetToDefaults(): void {
        Object.assign(this.state, DEFAULT_SETTINGS);
    }

    /** Get a copy of the default settings */
    public getDefaults(): GameSettings {
        return { ...DEFAULT_SETTINGS };
    }
}
