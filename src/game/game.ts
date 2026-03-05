import { FileManager } from '@/utilities/file-manager';
import { IMapLoader } from '@/resources/map/imap-loader';
import { GameState } from './game-state';
import { GameLoop } from './game-loop';
import { GameServices } from './game-services';
import { Command, executeCommand, type CommandResult, type CommandContext } from './commands';
import { TerrainData } from './terrain';
import { populateMapObjectsFromEntityData } from './systems/map-objects';
import { expandTrees } from './features/trees/tree-expansion';
import { populateMapBuildings } from './features/building-construction';
import { populateMapSettlers } from './systems/map-settlers';
import { populateMapStacks } from './systems/map-stacks';
import { SoundManager } from './audio';
import { Race, s4TribeToRace, loadSavedRace } from './race';
import { EventBus } from './event-bus';
import { EntityType } from './entity';
import { GameSettingsManager } from './game-settings';
import { GameViewState } from './game-view-state';
import { setDirectionRunLength } from './systems/pathfinding';
import { watch } from 'vue';
import type { FrameRenderTiming } from './renderer/renderer';
import { debugStats } from './debug-stats';

/** Options for resetToCleanState */
export interface ResetOptions {
    /** Keep environment objects (trees, stones). Default: true */
    keepEnvironment?: boolean;
    /** Rebuild inventory visualizer after reset. Default: true */
    rebuildInventory?: boolean;
}
// Scripting is loaded dynamically to avoid bundling Lua when disabled
// import { ScriptService, type ScriptLoadResult } from './scripting';
type ScriptLoadResult = { success: boolean; scriptPath: string | null; error?: string };

/**
 * Interface for the dynamically-loaded ScriptService.
 * Matches the public API of ScriptService without importing it.
 */
interface IScriptService {
    loadScriptForMap(mapFilename: string): Promise<ScriptLoadResult>;
    destroy(): void;
}

/** contains the game state */
export class Game {
    /** Terrain data — single owner for ground type, ground height, and map dimensions */
    public readonly terrain: TerrainData;
    public fileManager: FileManager;
    public readonly mapLoader: IMapLoader;
    public state: GameState;
    public readonly eventBus: EventBus;

    /** Game settings — user preferences (camera, audio, graphics, debug) */
    public readonly settings: GameSettingsManager;

    /** Reactive bridge between GameState and Vue components */
    public readonly viewState: GameViewState;

    /** All game managers and domain systems (composition root) */
    public readonly services: GameServices;

    /** Frame loop — private; use delegation methods on Game instead */
    private readonly _gameLoop: GameLoop;

    // Script service is optional - only loaded when Lua is enabled
    private scriptService: IScriptService | null = null;

    /** Callback to sync Territory feature toggle with visual layer visibility */
    private _onTerritoryToggle: ((enabled: boolean) => void) | null = null;

    /** Current interaction mode */
    public mode: string = 'select';

    /** Building type to place (when mode === 'place_building') */
    public placeBuildingType = 0;

    /** Current player index */
    public currentPlayer = 0;

    /** When true, renderers use procedural textures instead of loading game assets */
    public useProceduralTextures = false;

    /** Per-player race mapping (player index → Race enum value), populated from map data */
    public readonly playerRaces: Map<number, Race> = new Map();

    public constructor(fileManager: FileManager, mapLoader: IMapLoader) {
        const start = performance.now();
        const mlt = debugStats.state.mapLoadTimings;
        this.fileManager = fileManager;
        this.mapLoader = mapLoader;
        this.terrain = new TerrainData(
            mapLoader.landscape.getGroundType(),
            mapLoader.landscape.getGroundHeight(),
            mapLoader.mapSize
        );
        mlt.terrain = Math.round(performance.now() - start);

        const initStart = performance.now();
        this.eventBus = new EventBus();
        this.state = new GameState(this.eventBus);
        this.settings = new GameSettingsManager();
        this.viewState = new GameViewState();

        // Sync pathfinding direction run length from settings (initial + reactive)
        setDirectionRunLength(this.settings.state.pathStraightness);
        watch(
            () => this.settings.state.pathStraightness,
            v => setDirectionRunLength(v)
        );

        this.services = new GameServices(this.state, this.eventBus, this.execute.bind(this));
        this.services.setTerrainData(this.terrain, mapLoader.landscape.getResourceData?.());

        // Create frame loop and register tick systems
        this._gameLoop = new GameLoop(this.state, this.services.visualService, this.settings.state, this.viewState);
        for (const { system, group } of this.services.getTickSystems()) {
            this._gameLoop.registerSystem(system, group);
        }

        // Register feature toggles
        const dispatcher = this.services.logisticsDispatcher;
        this._gameLoop.registerFeatureToggle({
            name: 'Global Logistics',
            group: 'Logistics',
            requires: ['Territory'],
            get: () => dispatcher.globalLogistics,
            set: v => {
                dispatcher.globalLogistics = v;
            },
        });
        this._gameLoop.registerFeatureToggle({
            name: 'Territory',
            group: 'World',
            get: () => dispatcher.territoryEnabled,
            set: v => {
                dispatcher.territoryEnabled = v;
                this._onTerritoryToggle?.(v);
            },
        });

        // Restore feature toggles from localStorage (features panel may not mount immediately)
        this.restoreFeatureToggles();

        // Wire entity removal notifications to tick systems
        this.eventBus.on('entity:removed', ({ entityId }) => {
            this._gameLoop.notifyEntityRemoved(entityId);
        });
        mlt.gameInit = Math.round(performance.now() - initStart);

        // Scripting system is initialized lazily when loadScript is called
        // This avoids bundling Lua/wasmoon when scripting is disabled

        this.populateMapEntities(mapLoader);

        // Initialize Audio (async init called from constructor — sonarjs/no-async-constructor)
        // eslint-disable-next-line sonarjs/no-async-constructor -- fire-and-forget audio init, failure is non-fatal
        this.soundManager
            .init(this.fileManager)
            .then(() => {
                const playerRace = this.playerRaces.get(this.currentPlayer);
                this.soundManager.playRandomMusic(playerRace ?? loadSavedRace());
            })
            .catch((err: unknown) => {
                console.warn('Game: SoundManager initialization failed:', err);
            });

        // Debug helper (typed via env.d.ts)
        window.debugSound = () => {
            console.log('--- Sound Debug ---');
            console.log('Current Music ID:', this.soundManager.currentMusicId);
            console.log('Audio Context State:', Howler.ctx.state);
        };

        mlt.gameConstructor = Math.round(performance.now() - start);
        mlt.mapSize = `${this.terrain.width}x${this.terrain.height}`;
        mlt.entityCount = this.state.entities.length;
        console.log(`Game\tMap loaded: ${this.terrain.width}x${this.terrain.height} in ${mlt.gameConstructor}ms`);
    }

    /** Load players, objects, buildings, settlers, and pile stacks from parsed map data. */
    private populateMapEntities(mapLoader: IMapLoader): void {
        const mlt = debugStats.state.mapLoadTimings;
        const entityData = mapLoader.entityData;
        if (!entityData) return;

        // Build per-player race mapping
        for (const p of entityData.players) {
            this.playerRaces.set(p.playerIndex, s4TribeToRace(p.tribe));
        }

        // Default to first player from map data
        if (entityData.players.length > 0) {
            this.currentPlayer = entityData.players[0]!.playerIndex;
        }

        // Trees + decorations
        if (entityData.objects.length) {
            const t0 = performance.now();
            this.populateMapTrees(entityData.objects, mlt);
            // populateMapTrees records its own timings for trees + expansion
            mlt.populateTrees += Math.round(performance.now() - t0);
        }

        // Buildings
        if (entityData.buildings.length) {
            const t0 = performance.now();
            const count = populateMapBuildings(this.state, entityData.buildings, {
                eventBus: this.eventBus,
                terrain: this.terrain,
                playerRaces: this.playerRaces,
            });
            mlt.populateBuildings = Math.round(performance.now() - t0);
            if (count > 0) console.log(`Game: Loaded ${count} buildings from map data`);
        }

        // Settlers (units)
        if (entityData.settlers.length) {
            const t0 = performance.now();
            const count = populateMapSettlers(this.state, entityData.settlers, {
                playerRaces: this.playerRaces,
            });
            mlt.populateUnits = Math.round(performance.now() - t0);
            if (count > 0) console.log(`Game: Loaded ${count} settlers from map data`);
        }

        // Resource stacks
        if (entityData.stacks.length) {
            const t0 = performance.now();
            const count = populateMapStacks(this.state, entityData.stacks, this.eventBus);
            mlt.populateStacks = Math.round(performance.now() - t0);
            if (count > 0) console.log(`Game: Loaded ${count} pile stacks from map data`);
        }
    }

    public get soundManager(): SoundManager {
        return SoundManager.getInstance();
    }

    /** Load trees/decorations from map objects and optionally expand forests. */
    private populateMapTrees(
        objects: import('@/resources/map/map-entity-data').MapObjectData[],
        mlt: import('./debug-stats').MapLoadTimings
    ): void {
        const beforeCount = this.state.entities.length;
        const seedCount = populateMapObjectsFromEntityData(this.state, objects, this.terrain);
        const totalAdded = this.state.entities.length - beforeCount;
        const decoCount = totalAdded - seedCount;
        console.log(`Game: Loaded ${seedCount} seed trees + ${decoCount} decorations from map data`);

        const expandRaw = localStorage.getItem('settlers_treeExpansion');
        const expandEnabled = expandRaw !== 'false';
        if (seedCount > 0 && expandEnabled) {
            const t0 = performance.now();
            const expandedCount = expandTrees(this.state, this.terrain, {
                radius: 10,
                density: 0.04,
                minSpacing: 1,
            });
            mlt.treeExpansion = Math.round(performance.now() - t0);
            console.log(`Game: Expanded into ${expandedCount} additional trees (from ${seedCount} seeds)`);
        } else if (!expandEnabled) {
            console.log(
                `Game: Tree expansion DISABLED (localStorage=${expandRaw}), showing ${seedCount} seed trees only`
            );
        }
    }

    /** Shared context passed to every command execution */
    public get commandContext(): CommandContext {
        return {
            state: this.state,
            terrain: this.terrain,
            eventBus: this.eventBus,
            settings: this.settings.state,
            settlerTaskSystem: this.services.settlerTaskSystem,
            constructionSiteManager: this.services.constructionSiteManager,
            treeSystem: this.services.treeSystem,
            cropSystem: this.services.cropSystem,
            combatSystem: this.services.combatSystem,
            productionControlManager: this.services.productionControlManager,
            storageFilterManager: this.services.storageFilterManager,
        };
    }

    /** Execute a command against the game state */
    public execute(cmd: Command): CommandResult {
        return executeCommand(this.commandContext, cmd);
    }

    /** Find the starting position for the current player from map data */
    public findPlayerStartPosition(): { x: number; y: number } | null {
        const playerInfo = this.mapLoader.entityData?.players.find(p => p.playerIndex === this.currentPlayer);
        if (playerInfo?.startX != null && playerInfo.startY != null) {
            return { x: playerInfo.startX, y: playerInfo.startY };
        }
        return null;
    }

    /** Find the first buildable land tile, spiraling out from map center */
    // eslint-disable-next-line sonarjs/cognitive-complexity -- spiral search with per-tile boundary checks
    public findLandTile(): { x: number; y: number } | null {
        const { width: w, height: h } = this.terrain;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        for (let r = 0; r < Math.max(w, h) / 2; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const tx = cx + dx;
                    const ty = cy + dy;
                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
                    if (this.terrain.isBuildable(tx, ty)) {
                        return { x: tx, y: ty };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Remove all entities via the command pipeline.
     * Each entity goes through the full remove_entity command flow
     * (terrain restoration, movement cleanup, selection cleanup, etc.).
     */
    public removeAllEntities(): void {
        const ids = this.state.entities.map(e => e.id);
        for (const id of ids) {
            this.execute({ type: 'remove_entity', entityId: id });
        }
    }

    /**
     * Reset game to a clean state by removing user-placed entities.
     * Used by both debug panel and e2e tests for consistent reset behavior.
     *
     * @param options Reset options
     * @returns Number of entities removed
     */
    public resetToCleanState(options: ResetOptions = {}): number {
        const { keepEnvironment = true, rebuildInventory = true } = options;

        // Determine which entity types to remove
        const typesToRemove = keepEnvironment
            ? [EntityType.Unit, EntityType.Building, EntityType.StackedPile]
            : [EntityType.Unit, EntityType.Building, EntityType.StackedPile, EntityType.MapObject];

        // Collect entities to remove (snapshot IDs first to avoid mutation during iteration)
        const idsToRemove = this.state.entities.filter(e => typesToRemove.includes(e.type)).map(e => e.id);

        // Remove via command pipeline for proper cleanup
        for (const id of idsToRemove) {
            this.execute({ type: 'remove_entity', entityId: id });
        }

        // Rebuild inventory pile sync to reconnect registry to pre-existing pile entities
        if (rebuildInventory) {
            this.services.inventoryPileSync?.rebuildFromExistingEntities();
        }

        return idsToRemove.length;
    }

    /**
     * Load and execute a Lua script for the map.
     * Scripting is only loaded when enabled in settings.
     */
    public async loadScript(mapFilename: string): Promise<ScriptLoadResult> {
        // Check if Lua scripting is enabled
        try {
            if (localStorage.getItem('settlers_luaEnabled') !== 'true') {
                return { success: false, scriptPath: null, error: 'Lua scripting disabled' };
            }
        } catch {
            return { success: false, scriptPath: null, error: 'Lua scripting disabled' };
        }

        // Dynamically import scripting module to avoid bundling when disabled
        try {
            const { ScriptService } = await import('./scripting');

            if (!this.scriptService) {
                const service = new ScriptService({
                    gameState: this.state,
                    constructionSiteManager: this.services.constructionSiteManager,
                    mapWidth: this.terrain.width,
                    mapHeight: this.terrain.height,
                    landscape: this.mapLoader.landscape,
                    playerRaces: this.playerRaces,
                    executeCommand: this.execute.bind(this),
                });
                await service.initialize();
                this._gameLoop.registerSystem(service, 'Scripting');
                this.scriptService = service;
            }

            return this.scriptService.loadScriptForMap(mapFilename);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { success: false, scriptPath: null, error: msg };
        }
    }

    // ===== Frame loop delegation =====

    /** Start the game loop */
    public start(): void {
        this._gameLoop.start();
    }

    /** Stop the game loop */
    public stop(): void {
        this._gameLoop.stop();
    }

    /** Whether the game loop is currently running */
    public get isRunning(): boolean {
        return this._gameLoop.isRunning;
    }

    /** Enable game ticks (call after sprites are loaded) */
    public enableTicks(): void {
        this._gameLoop.enableTicks();
    }

    /** Set the per-frame render callback */
    public setRenderCallback(callback: (alpha: number, deltaSec: number) => FrameRenderTiming | null): void {
        this._gameLoop.setRenderCallback(callback);
    }

    /** Set the per-frame update callback (input, sound, debug stats) */
    public setUpdateCallback(callback: (deltaSec: number) => void): void {
        this._gameLoop.setUpdateCallback(callback);
    }

    /** Get the name, group, and enabled state of every registered system and feature toggle */
    public getSystemStates(): import('./game-loop').SystemState[] {
        return this._gameLoop.getSystemStates();
    }

    /** Enable or disable a tick system by name */
    public setSystemEnabled(name: string, enabled: boolean): void {
        this._gameLoop.setSystemEnabled(name, enabled);
    }

    /**
     * Register a callback to sync the Territory feature toggle with visual layer visibility.
     * Called from the Vue layer so the game can update showTerritory when the toggle changes.
     */
    public onTerritoryToggle(callback: (enabled: boolean) => void): void {
        this._onTerritoryToggle = callback;
        // Fire immediately with current state so visual matches on connect
        callback(this.services.logisticsDispatcher.territoryEnabled);
    }

    private static readonly FEATURE_STORAGE_KEY = 'settlers-feature-toggles';

    /** Restore feature toggle states from localStorage at game init */
    private restoreFeatureToggles(): void {
        try {
            const raw = localStorage.getItem(Game.FEATURE_STORAGE_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw) as Record<string, boolean>;
            for (const [name, enabled] of Object.entries(saved)) {
                this._gameLoop.setSystemEnabled(name, enabled);
            }
        } catch {
            // localStorage may be unavailable
        }
    }

    /** Destroy the game and clean up all resources */
    public destroy(): void {
        this.scriptService?.destroy();
        this.services.destroy();
        this._gameLoop.destroy();
    }
}
