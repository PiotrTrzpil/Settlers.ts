/**
 * Debug stats type definitions — interfaces for load timings, render timings,
 * and the debug stats reactive state.
 *
 * Extracted from debug-stats.ts to keep the main module under the line limit.
 */

/** Load timing data for each layer */
export interface LoadTimings {
    landscape: number;
    /** Time waiting for IndexedDB cache read (overlaps landscape, 0 on module cache or miss) */
    cacheWait: number;
    filePreload: number;
    atlasAlloc: number;
    buildings: number;
    mapObjects: number;
    goods: number;
    units: number;
    /** Per-race unit sprite load timing (race name → ms) */
    unitsByRace: Record<string, number>;
    /** Time to deserialize registry from cache (0 on cache miss) */
    deserialize: number;
    /** Sub-timing: EntityTextureAtlas.fromCache() — per-layer pixel data memcpy */
    atlasRestore: number;
    /** Sub-timing: SpriteMetadataRegistry.deserialize() — JSON→Maps reconstruction */
    registryDeserialize: number;
    /** Sub-timing: palette restore + GPU upload */
    paletteUpload: number;
    gpuUpload: number;
    /** Number of atlas layers uploaded to GPU */
    gpuLayers: number;
    /** Time to load selection indicator sprites after main sprites */
    selectionIndicators: number;
    /** Time to load building overlay sprites */
    overlaySprites: number;
    totalSprites: number;
    atlasSize: string;
    spriteCount: number;
    /** True if sprites were restored from cache */
    cacheHit: boolean;
    /** Cache source: 'module' (HMR), 'indexeddb' (refresh), or null (miss) */
    cacheSource: 'module' | 'indexeddb' | null;
}

/** Full map load timing data — measured once per map load, displayed in debug panel */
export interface MapLoadTimings {
    // Phase 1: File + Parse
    fileRead: number;
    mapParse: number;
    // Phase 2: Game constructor
    terrain: number;
    gameInit: number;
    populateTrees: number;
    treeExpansion: number;
    populateBuildings: number;
    populateUnits: number;
    populateStacks: number;
    gameConstructor: number;
    // Phase 3: Post-constructor
    stateRestore: number;
    // Phase 4: Renderer init (wall-clock from startMapLoad to rendererReady)
    rendererInit: number;
    totalLoad: number;
    // Info
    mapSize: string;
    entityCount: number;
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

    // Map load timings (full pipeline)
    mapLoadTimings: MapLoadTimings;

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

    // Game behavior flags (persisted — read by game code, not just UI)
    debugGridEnabled: boolean;
    selectAllUnits: boolean;

    // Render timings (updated every ~1 sec)
    renderTimings: RenderTimings;
}
