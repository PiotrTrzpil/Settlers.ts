/**
 * debug-stats.ts — Performance instrumentation and debug settings.
 *
 * Owns ONLY: FPS/timing metrics, load timings, debug UI settings,
 * camera/tile overlay state, and readiness flags for e2e tests.
 *
 * Game state for Vue components (mode, selection, entity counts) lives
 * in {@link gameViewState} instead.
 */

import { reactive, watch } from 'vue';
import type { Game } from './game';
import type { GameSettingsManager } from './game-settings';
import { spiralSearch } from './utils/spiral-search';

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
    /** True if sprites were restored from cache */
    cacheHit: boolean;
    /** Cache source: 'module' (HMR), 'indexeddb' (refresh), or null (miss) */
    cacheSource: 'module' | 'indexeddb' | null;
}

/** Per-frame render timing data (averaged over window) */
export interface RenderTimings {
    /** Total frame period (should match frameTimeMs) */
    frame: number;
    /** Tick simulation time in ms */
    ticks: number;
    /** Animation update time in ms */
    animations: number;
    /** Per-frame update callback (camera, input, sound, debug stats) in ms */
    update: number;
    /** Render callback overhead (sync state, etc.) in ms */
    callback: number;
    /** Idle time between frames (vsync/rAF scheduling) in ms */
    idle: number;
    /** Total GPU render time in ms */
    render: number;
    /** Landscape render time in ms */
    landscape: number;
    /** All entities draw time in ms */
    entities: number;
    /** Entity culling and sorting time in ms */
    cullSort: number;
    /** Number of visible entities */
    visibleCount: number;
    /** Number of draw calls */
    drawCalls: number;
    /** Number of sprites rendered */
    spriteCount: number;
    // Detailed entity breakdown
    /** Building indicators draw time in ms */
    indicators: number;
    /** Textured sprites draw time in ms */
    textured: number;
    /** Color fallback draw time in ms */
    color: number;
    /** Selection overlay draw time in ms */
    selection: number;
    /** Per-system tick timing breakdown (system name → ms) */
    tickSystems: Record<string, number>;
}

export interface DebugStatsState {
    // Readiness (for Playwright tests)
    gameLoaded: boolean;
    rendererReady: boolean;
    frameCount: number;
    tickCount: number;

    // Load timings
    loadTimings: LoadTimings;

    // Performance
    fps: number;
    frameTimeMs: number;
    frameTimeMin: number;
    frameTimeMax: number;
    ticksPerSec: number;

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

    // Logistics panel UI state (persisted)
    logisticsPanelOpen: boolean;

    // Debug selection mode - allows selecting normally non-selectable units
    selectAllUnits: boolean;

    // Render timings (updated every ~1 sec)
    renderTimings: RenderTimings;
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
    logisticsPanelOpen: boolean;
    selectAllUnits: boolean;
}

const PERSISTED_KEYS: readonly (keyof PersistedDebugSettings)[] = [
    'zoomSpeed',
    'panSpeed',
    'riverSlotPermutation',
    'riverFlipInner',
    'riverFlipOuter',
    'riverFlipMiddle',
    'debugPanelOpen',
    'debugGridEnabled',
    'layerPanelOpen',
    'logisticsPanelOpen',
    'selectAllUnits',
];

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
    logisticsPanelOpen: false,
    selectAllUnits: false,
};

/** Load persisted settings from localStorage */
function loadDebugSettings(): PersistedDebugSettings {
    try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!stored) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(stored) as Partial<PersistedDebugSettings>;
        return { ...DEFAULT_SETTINGS, ...parsed };
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

/** Keys present in a timing sample (excludes tickSystems which is handled separately) */
type RenderTimingKey = keyof RenderTimingSamples;

/** A single frame's timing sample */
type RenderTimingSample = Record<RenderTimingKey, number> & { tickSystems: Record<string, number> };

const RENDER_TIMING_KEYS: readonly RenderTimingKey[] = [
    'frame',
    'ticks',
    'animations',
    'update',
    'callback',
    'idle',
    'render',
    'landscape',
    'entities',
    'cullSort',
    'visibleCount',
    'drawCalls',
    'spriteCount',
    'indicators',
    'textured',
    'color',
    'selection',
];

/** Integer-valued timing keys (no fractional rounding needed) */
const INTEGER_TIMING_KEYS = new Set<RenderTimingKey>(['visibleCount', 'drawCalls', 'spriteCount']);

interface RenderTimingSamples {
    frame: number[];
    ticks: number[];
    animations: number[];
    update: number[];
    callback: number[];
    idle: number[];
    render: number[];
    landscape: number[];
    entities: number[];
    cullSort: number[];
    visibleCount: number[];
    drawCalls: number[];
    spriteCount: number[];
    indicators: number[];
    textured: number[];
    color: number[];
    selection: number[];
}

/** How often to update render timing averages (ms) */
const RENDER_TIMING_UPDATE_INTERVAL = 1000;

class DebugStats {
    public readonly state: DebugStatsState;

    private frameTimes: number[] = [];
    private lastFrameTime = 0;
    private tickCount = 0;
    private tickResetTime = 0;

    // Render timing accumulation
    private renderSamples: RenderTimingSamples = {
        frame: [],
        ticks: [],
        animations: [],
        update: [],
        callback: [],
        idle: [],
        render: [],
        landscape: [],
        entities: [],
        cullSort: [],
        visibleCount: [],
        drawCalls: [],
        spriteCount: [],
        indicators: [],
        textured: [],
        color: [],
        selection: [],
    };
    /** Per-system tick timing samples (system name → array of per-frame ms values) */
    private tickSystemSamples = new Map<string, number[]>();
    private lastRenderTimingUpdate = 0;

    constructor() {
        // Load persisted settings
        const savedSettings = loadDebugSettings();

        this.state = reactive<DebugStatsState>({
            gameLoaded: false,
            tickCount: 0,
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
                cacheHit: false,
                cacheSource: null,
            },
            fps: 0,
            frameTimeMs: 0,
            frameTimeMin: 0,
            frameTimeMax: 0,
            ticksPerSec: 0,
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
            logisticsPanelOpen: savedSettings.logisticsPanelOpen,
            selectAllUnits: savedSettings.selectAllUnits,
            renderTimings: {
                frame: 0,
                ticks: 0,
                animations: 0,
                update: 0,
                callback: 0,
                idle: 0,
                render: 0,
                landscape: 0,
                entities: 0,
                cullSort: 0,
                visibleCount: 0,
                drawCalls: 0,
                spriteCount: 0,
                indicators: 0,
                textured: 0,
                color: 0,
                selection: 0,
                tickSystems: {},
            },
        });

        // Expose on window for Playwright tests (skip in Node.js environment)
        if (typeof window !== 'undefined') {
            (window as any).__settlers_debug__ = this.state;
            (window as any).__settlers_spiral_search__ = spiralSearch;
        }

        // Set up watchers to auto-save settings when they change
        this.setupSettingsWatchers();
    }

    private setupSettingsWatchers(): void {
        for (const key of PERSISTED_KEYS) {
            watch(
                () => this.state[key],
                () => this.saveSettings(),
                { flush: 'post' }
            );
        }
    }

    private saveSettings(): void {
        const settings = {} as PersistedDebugSettings;
        for (const key of PERSISTED_KEYS) {
            (settings as any)[key] = this.state[key];
        }
        saveDebugSettings(settings);
    }

    /**
     * Reset timing data when game is reloaded (e.g., during HMR).
     * Call this before starting a new game to clear stale timing data.
     */
    public reset(): void {
        this.frameTimes.length = 0;
        this.lastFrameTime = 0;
        this.tickCount = 0;
        this.tickResetTime = 0;
        this.lastRenderTimingUpdate = 0;

        // Clear render timing samples
        for (const key of Object.keys(this.renderSamples) as (keyof RenderTimingSamples)[]) {
            this.renderSamples[key].length = 0;
        }

        // Reset state counters (but keep UI settings)
        this.state.fps = 0;
        this.state.frameTimeMs = 0;
        this.state.frameTimeMin = 0;
        this.state.frameTimeMax = 0;
        this.state.ticksPerSec = 0;
        this.state.frameCount = 0;
        this.state.tickCount = 0;
        this.state.gameLoaded = false;
        this.state.rendererReady = false;
    }

    /**
     * Record a frame for FPS calculation.
     * Uses performance.now() for actual wall-clock timing instead of the rAF
     * timestamp, which can be misleading when the main thread is blocked.
     * @returns The frame period in ms (time since last frame)
     */
    public recordFrame(_rafTimestamp?: number): number {
        const now = performance.now();
        this.state.frameCount++;
        let dt = 0;
        if (this.lastFrameTime > 0) {
            dt = now - this.lastFrameTime;
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
        return dt;
    }

    public recordTick(): void {
        this.tickCount++;
        this.state.tickCount++;
        const now = performance.now();
        if (now - this.tickResetTime >= 1000) {
            this.state.ticksPerSec = this.tickCount;
            this.tickCount = 0;
            this.tickResetTime = now;
        }
    }

    public recordRenderTiming(timing: RenderTimingSample): void {
        for (const key of RENDER_TIMING_KEYS) {
            this.renderSamples[key].push(timing[key]);
        }

        // Accumulate per-system tick timings
        for (const [name, ms] of Object.entries(timing.tickSystems)) {
            let arr = this.tickSystemSamples.get(name);
            if (!arr) {
                arr = [];
                this.tickSystemSamples.set(name, arr);
            }
            arr.push(ms);
        }

        const now = performance.now();
        if (now - this.lastRenderTimingUpdate >= RENDER_TIMING_UPDATE_INTERVAL) {
            this.updateRenderTimingAverages();
            this.lastRenderTimingUpdate = now;
        }
    }

    private updateRenderTimingAverages(): void {
        const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

        for (const key of RENDER_TIMING_KEYS) {
            const value = avg(this.renderSamples[key]);
            (this.state.renderTimings as unknown as Record<string, number>)[key] = INTEGER_TIMING_KEYS.has(key)
                ? Math.round(value)
                : Math.round(value * 100) / 100;
            this.renderSamples[key].length = 0;
        }

        // Average per-system tick timings
        const systems: Record<string, number> = {};
        for (const [name, arr] of this.tickSystemSamples) {
            systems[name] = Math.round(avg(arr) * 100) / 100;
            arr.length = 0;
        }
        this.state.renderTimings.tickSystems = systems;
    }

    /**
     * Update debug stats from a running game (audio state, e2e window refs).
     * Game view state (entities, selection, mode) is handled by GameViewState.
     */
    public updateFromGame(game: Game, settings: GameSettingsManager): void {
        // Expose references for e2e tests (Vue internals are stripped in prod builds)
        (window as any).__settlers_game__ = game;
        (window as any).__settlers_game_settings__ = settings;

        this.updateAudioState(game);
    }

    private updateAudioState(game: Game): void {
        const soundManager = game.soundManager;
        this.state.musicEnabled = soundManager.isMusicEnabled;
        this.state.currentMusicId = soundManager.currentMusicId;
        this.state.musicPlaying = soundManager.currentMusicId !== null;
    }
}

export const debugStats = new DebugStats();
