import { reactive, watch } from 'vue';
import { EntityType, MapObjectType } from './entity';
import { isResourceDeposit, getEnvironmentSubLayer, EnvironmentSubLayer } from './renderer/layer-visibility';
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
    /** Render callback overhead (sync state, etc.) in ms */
    callback: number;
    /** Browser/vsync/rAF scheduling overhead in ms */
    other: number;
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
    resourceCount: number;
    environmentCount: number;
    treeCount: number;
    stoneCount: number;
    plantCount: number;
    otherCount: number;
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

/** Accumulator for render timing samples */
interface RenderTimingSamples {
    frame: number[];
    ticks: number[];
    animations: number[];
    callback: number[];
    other: number[];
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
        frame: [], ticks: [], animations: [], callback: [], other: [], render: [],
        landscape: [], entities: [], cullSort: [],
        visibleCount: [], drawCalls: [], spriteCount: [],
        indicators: [], textured: [], color: [], selection: [],
    };
    private lastRenderTimingUpdate = 0;

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
                cacheHit: false,
                cacheSource: null,
            },
            fps: 0,
            frameTimeMs: 0,
            frameTimeMin: 0,
            frameTimeMax: 0,
            ticksPerSec: 0,
            entityCount: 0,
            buildingCount: 0,
            unitCount: 0,
            resourceCount: 0,
            environmentCount: 0,
            treeCount: 0,
            stoneCount: 0,
            plantCount: 0,
            otherCount: 0,
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
            renderTimings: {
                frame: 0,
                ticks: 0,
                animations: 0,
                callback: 0,
                other: 0,
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
            },
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
        this.lastEntityCountUpdate = 0;

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
        const now = performance.now();
        if (now - this.tickResetTime >= 1000) {
            this.state.ticksPerSec = this.tickCount;
            this.tickCount = 0;
            this.tickResetTime = now;
        }
    }

    /**
     * Record render timing data for a single frame.
     * Call this from the game loop at the end of each frame.
     */
    public recordRenderTiming(timing: {
        frame: number;
        ticks: number;
        animations: number;
        callback: number;
        other: number;
        render: number;
        landscape: number;
        entities: number;
        cullSort: number;
        visibleCount: number;
        drawCalls: number;
        spriteCount: number;
        indicators: number;
        textured: number;
        color: number;
        selection: number;
    }): void {
        // Add samples
        this.renderSamples.frame.push(timing.frame);
        this.renderSamples.ticks.push(timing.ticks);
        this.renderSamples.animations.push(timing.animations);
        this.renderSamples.callback.push(timing.callback);
        this.renderSamples.other.push(timing.other);
        this.renderSamples.render.push(timing.render);
        this.renderSamples.landscape.push(timing.landscape);
        this.renderSamples.entities.push(timing.entities);
        this.renderSamples.cullSort.push(timing.cullSort);
        this.renderSamples.visibleCount.push(timing.visibleCount);
        this.renderSamples.drawCalls.push(timing.drawCalls);
        this.renderSamples.spriteCount.push(timing.spriteCount);
        this.renderSamples.indicators.push(timing.indicators);
        this.renderSamples.textured.push(timing.textured);
        this.renderSamples.color.push(timing.color);
        this.renderSamples.selection.push(timing.selection);

        // Update averages periodically
        const now = performance.now();
        if (now - this.lastRenderTimingUpdate >= RENDER_TIMING_UPDATE_INTERVAL) {
            this.updateRenderTimingAverages();
            this.lastRenderTimingUpdate = now;
        }
    }

    /** Compute averages from samples and update state */
    private updateRenderTimingAverages(): void {
        const avg = (arr: number[]) => arr.length > 0
            ? arr.reduce((a, b) => a + b, 0) / arr.length
            : 0;

        this.state.renderTimings.frame = Math.round(avg(this.renderSamples.frame) * 100) / 100;
        this.state.renderTimings.ticks = Math.round(avg(this.renderSamples.ticks) * 100) / 100;
        this.state.renderTimings.animations = Math.round(avg(this.renderSamples.animations) * 100) / 100;
        this.state.renderTimings.callback = Math.round(avg(this.renderSamples.callback) * 100) / 100;
        this.state.renderTimings.other = Math.round(avg(this.renderSamples.other) * 100) / 100;
        this.state.renderTimings.render = Math.round(avg(this.renderSamples.render) * 100) / 100;
        this.state.renderTimings.landscape = Math.round(avg(this.renderSamples.landscape) * 100) / 100;
        this.state.renderTimings.entities = Math.round(avg(this.renderSamples.entities) * 100) / 100;
        this.state.renderTimings.cullSort = Math.round(avg(this.renderSamples.cullSort) * 100) / 100;
        this.state.renderTimings.visibleCount = Math.round(avg(this.renderSamples.visibleCount));
        this.state.renderTimings.drawCalls = Math.round(avg(this.renderSamples.drawCalls));
        this.state.renderTimings.spriteCount = Math.round(avg(this.renderSamples.spriteCount));
        this.state.renderTimings.indicators = Math.round(avg(this.renderSamples.indicators) * 100) / 100;
        this.state.renderTimings.textured = Math.round(avg(this.renderSamples.textured) * 100) / 100;
        this.state.renderTimings.color = Math.round(avg(this.renderSamples.color) * 100) / 100;
        this.state.renderTimings.selection = Math.round(avg(this.renderSamples.selection) * 100) / 100;

        // Clear samples for next period
        this.renderSamples.frame.length = 0;
        this.renderSamples.ticks.length = 0;
        this.renderSamples.animations.length = 0;
        this.renderSamples.callback.length = 0;
        this.renderSamples.other.length = 0;
        this.renderSamples.render.length = 0;
        this.renderSamples.landscape.length = 0;
        this.renderSamples.entities.length = 0;
        this.renderSamples.cullSort.length = 0;
        this.renderSamples.visibleCount.length = 0;
        this.renderSamples.drawCalls.length = 0;
        this.renderSamples.spriteCount.length = 0;
        this.renderSamples.indicators.length = 0;
        this.renderSamples.textured.length = 0;
        this.renderSamples.color.length = 0;
        this.renderSamples.selection.length = 0;
    }

    // Throttle entity counting - no need to count every frame
    private lastEntityCountUpdate = 0;
    private static readonly ENTITY_COUNT_INTERVAL = 500; // ms

    public updateFromGame(game: Game): void {
        // Expose game reference for e2e tests (Vue internals are stripped in prod builds)
        (window as any).__settlers_game__ = game;
        const gameState = game.state;

        // Always update total count (cheap)
        this.state.entityCount = gameState.entities.length;

        // Throttle expensive per-entity counting
        const now = performance.now();
        if (now - this.lastEntityCountUpdate < DebugStats.ENTITY_COUNT_INTERVAL) {
            // Skip detailed counting, just update selection/mode state
            this.state.selectedEntityId = gameState.selectedEntityId;
            this.state.selectedCount = gameState.selectedEntityIds.size;
            this.updateAudioState(game);
            return;
        }
        this.lastEntityCountUpdate = now;

        let buildings = 0;
        let units = 0;
        let resources = 0;
        let environment = 0;
        let trees = 0;
        let stones = 0;
        let plants = 0;
        let other = 0;

        for (const e of gameState.entities) {
            switch (e.type) {
            case EntityType.Building:
                buildings++;
                break;
            case EntityType.Unit:
                units++;
                break;
            case EntityType.StackedResource:
                resources++;
                break;
            case EntityType.MapObject: {
                const objType = e.subType as MapObjectType;
                if (isResourceDeposit(objType)) {
                    resources++;
                } else {
                    environment++;
                    switch (getEnvironmentSubLayer(objType)) {
                    case EnvironmentSubLayer.Trees: trees++; break;
                    case EnvironmentSubLayer.Stones: stones++; break;
                    case EnvironmentSubLayer.Plants: plants++; break;
                    case EnvironmentSubLayer.Other: other++; break;
                    }
                }
                break;
            }
            }
        }
        this.state.buildingCount = buildings;
        this.state.unitCount = units;
        this.state.resourceCount = resources;
        this.state.environmentCount = environment;
        this.state.treeCount = trees;
        this.state.stoneCount = stones;
        this.state.plantCount = plants;
        this.state.otherCount = other;

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
