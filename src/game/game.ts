import { FileManager } from '@/utilities/file-manager';
import { IMapLoader } from '@/resources/map/imap-loader';
import { GameState } from './game-state';
import { GameLoop } from './game-loop';
import { GameServices } from './game-services';
import { Command, executeCommand, type CommandResult, type CommandContext } from './commands';
import { TerrainData } from './terrain';
import { populateMapObjectsFromEntityData, expandTrees } from './systems/map-objects';
import { populateMapBuildings } from './features/building-construction';
import { SoundManager } from './audio';
import { Race } from './renderer/sprite-metadata';
import { EventBus } from './event-bus';
import { EntityType } from './entity';
import { GameSettingsManager } from './game-settings';
import { GameViewState } from './game-view-state';
import type { TickSystem } from './tick-system';
import type { FrameRenderTiming } from './renderer/renderer';

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

    /** Current interaction mode */
    public mode: 'select' | 'place_building' | 'move' = 'select';

    /** Building type to place (when mode === 'place_building') */
    public placeBuildingType = 0;

    /** Current player index */
    public currentPlayer = 0;

    /** When true, renderers use procedural textures instead of loading game assets */
    public useProceduralTextures = false;

    public constructor(fileManager: FileManager, mapLoader: IMapLoader) {
        const start = performance.now();
        this.fileManager = fileManager;
        this.mapLoader = mapLoader;
        this.terrain = new TerrainData(
            mapLoader.landscape.getGroundType(),
            mapLoader.landscape.getGroundHeight(),
            mapLoader.mapSize
        );

        this.eventBus = new EventBus();
        this.state = new GameState(this.eventBus);
        this.settings = new GameSettingsManager();
        this.viewState = new GameViewState();

        // Create all game managers and domain systems
        // Use arrow fn so commandContext is resolved lazily (after services is assigned)
        this.services = new GameServices(this.state, this.eventBus, cmd => this.execute(cmd));
        this.services.setTerrainData(this.terrain);

        // Create frame loop and register tick systems
        this._gameLoop = new GameLoop(this.state, this.services.animationService, this.settings.state, this.viewState);
        for (const system of this.services.getTickSystems()) {
            this._gameLoop.registerSystem(system);
        }

        // Wire entity removal notifications to tick systems
        this.eventBus.on('entity:removed', ({ entityId }) => {
            this._gameLoop.notifyEntityRemoved(entityId);
        });

        // Scripting system is initialized lazily when loadScript is called
        // This avoids bundling Lua/wasmoon when scripting is disabled

        // Populate map objects (trees) from entity data chunk (type 6)
        if (mapLoader.entityData?.objects?.length) {
            const seedCount = populateMapObjectsFromEntityData(this.state, mapLoader.entityData.objects, this.terrain);
            if (seedCount > 0) {
                console.log(`Game: Loaded ${seedCount} seed trees from map data`);

                // Expand seed trees into forests
                const expandedCount = expandTrees(this.state, this.terrain, {
                    radius: 12,
                    density: 0.7,
                    minSpacing: 1,
                });
                console.log(`Game: Expanded into ${expandedCount} additional trees`);
            }
        }

        // Populate buildings from map entity data (if available)
        if (mapLoader.entityData?.buildings?.length) {
            const count = populateMapBuildings(this.state, mapLoader.entityData.buildings, {
                buildingStateManager: this.services.buildingStateManager,
                eventBus: this.eventBus,
                terrain: this.terrain,
            });
            if (count > 0) {
                console.log(`Game: Loaded ${count} buildings from map data`);
            }
        }

        // Initialize Audio
        this.soundManager
            .init(this.fileManager)
            .then(() => {
                if (!this.soundManager.currentMusicId) {
                    console.log('Game: SoundManager initialized, requesting music...');
                    this.soundManager.playRandomMusic(Race.Roman);
                }
            })
            .catch((err: unknown) => {
                console.warn('Game: SoundManager initialization failed:', err);
            });

        // Debug helper (typed via env.d.ts)
        window.debugSound = () => {
            console.log('--- Sound Debug ---');
            console.log('Current Music ID:', this.soundManager.currentMusicId);
            console.log('Audio Context State:', Howler.ctx ? Howler.ctx.state : 'No Context');
        };

        console.log(
            `Game\tMap loaded: ${this.terrain.width}x${this.terrain.height} in ${Math.round(performance.now() - start)}ms`
        );
    }

    public get soundManager(): SoundManager {
        return SoundManager.getInstance();
    }

    /** Shared context passed to every command execution */
    public get commandContext(): CommandContext {
        return {
            state: this.state,
            terrain: this.terrain,
            eventBus: this.eventBus,
            settings: this.settings.state,
            settlerTaskSystem: this.services.settlerTaskSystem,
            buildingStateManager: this.services.buildingStateManager,
            treeSystem: this.services.treeSystem,
        };
    }

    /** Execute a command against the game state */
    public execute(cmd: Command): CommandResult {
        return executeCommand(this.commandContext, cmd);
    }

    /** Find the first buildable land tile, spiraling out from map center */
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
            ? [EntityType.Unit, EntityType.Building, EntityType.StackedResource]
            : [EntityType.Unit, EntityType.Building, EntityType.StackedResource, EntityType.MapObject];

        // Collect entities to remove (snapshot IDs first to avoid mutation during iteration)
        const idsToRemove = this.state.entities.filter(e => typesToRemove.includes(e.type)).map(e => e.id);

        // Remove via command pipeline for proper cleanup
        for (const id of idsToRemove) {
            this.execute({ type: 'remove_entity', entityId: id });
        }

        // Rebuild inventory visualizer to sync with new entity state
        if (rebuildInventory) {
            this.services.inventoryVisualizer.rebuildFromExistingEntities();
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
                    buildingStateManager: this.services.buildingStateManager,
                    mapWidth: this.terrain.width,
                    mapHeight: this.terrain.height,
                    landscape: this.mapLoader.landscape,
                    executeCommand: cmd => this.execute(cmd),
                });
                await service.initialize();
                this._gameLoop.registerSystem(service as unknown as TickSystem);
                this.scriptService = service;
            }

            return this.scriptService!.loadScriptForMap(mapFilename);
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

    /** Destroy the game and clean up all resources */
    public destroy(): void {
        this.scriptService?.destroy();
        this.services.destroy();
        this._gameLoop.destroy();
    }
}
