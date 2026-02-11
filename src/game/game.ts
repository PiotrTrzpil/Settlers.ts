import { FileManager } from '@/utilities/file-manager';
import { IMapLoader } from '@/resources/map/imap-loader';
import { MapSize } from '@/utilities/map-size';
import { GameState } from './game-state';
import { GameLoop } from './game-loop';
import { Command, executeCommand } from './commands';
import { isBuildable } from './features/placement';
import { populateMapObjectsFromEntityData, expandTrees } from './systems/map-objects';
import { populateMapBuildings } from './systems/map-buildings';
import { SoundManager } from './audio';
import { Race } from './renderer/sprite-metadata';
import { EventBus } from './event-bus';
// Scripting is loaded dynamically to avoid bundling Lua when disabled
// import { ScriptService, type ScriptLoadResult } from './scripting';
type ScriptLoadResult = { success: boolean; scriptPath: string | null; error?: string };

/** contains the game state */
export class Game {
    public mapSize: MapSize;
    public groundHeight: Uint8Array;
    public groundType: Uint8Array;
    public fileManager: FileManager;
    public readonly mapLoader: IMapLoader;
    public state: GameState;
    public readonly eventBus: EventBus;
    public gameLoop: GameLoop;
    // Script service is optional - only loaded when Lua is enabled
    private scriptService: unknown = null;

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
        this.mapSize = mapLoader.mapSize;
        this.groundHeight = mapLoader.landscape.getGroundHeight();
        this.groundType = mapLoader.landscape.getGroundType();

        this.state = new GameState();
        this.eventBus = new EventBus();
        this.gameLoop = new GameLoop(this.state, this.eventBus);
        this.gameLoop.setTerrainData(this.groundType, this.groundHeight, this.mapSize.width, this.mapSize.height);

        // Scripting system is initialized lazily when loadScript is called
        // This avoids bundling Lua/wasmoon when scripting is disabled

        // Populate map objects (trees) from entity data chunk (type 6)
        if (mapLoader.entityData?.objects?.length) {
            const seedCount = populateMapObjectsFromEntityData(
                this.state, mapLoader.entityData.objects, this.groundType, this.mapSize
            );
            if (seedCount > 0) {
                console.log(`Game: Loaded ${seedCount} seed trees from map data`);

                // Expand seed trees into forests
                const expandedCount = expandTrees(this.state, this.groundType, this.mapSize, {
                    radius: 12,
                    density: 0.7,
                    minSpacing: 1,
                });
                console.log(`Game: Expanded into ${expandedCount} additional trees`);
            }
        }

        // Populate buildings from map entity data (if available)
        if (mapLoader.entityData?.buildings?.length) {
            const count = populateMapBuildings(
                this.state,
                mapLoader.entityData.buildings
            );
            if (count > 0) {
                console.log(`Game: Loaded ${count} buildings from map data`);
            }
        }

        // Initialize Audio
        this.soundManager.init(this.fileManager).then(() => {
            if (!this.soundManager.currentMusicId) {
                console.log('Game: SoundManager initialized, requesting music...');
                this.soundManager.playRandomMusic(Race.Roman);
            }
        });

        // Debug helper
        (window as any).debugSound = () => {
            const sm = this.soundManager as any;
            console.log('--- Sound Debug ---');
            console.log('Current Music ID:', sm.currentMusicId);
            console.log('Music Volume:', sm.musicVolume);
            console.log('Master Volume:', sm.masterVolume);
            console.log('Audio Context State:', Howler.ctx ? Howler.ctx.state : 'No Context');
        };

        console.log(`Game\tMap loaded: ${this.mapSize.width}x${this.mapSize.height} in ${Math.round(performance.now() - start)}ms`);
    }

    public get soundManager(): SoundManager {
        return SoundManager.getInstance();
    }

    /** Execute a command against the game state */
    public execute(cmd: Command): boolean {
        return executeCommand(
            this.state, cmd, this.groundType, this.groundHeight, this.mapSize,
            this.eventBus, this.gameLoop.settlerTaskSystem
        );
    }

    /** Find the first buildable land tile, spiraling out from map center */
    public findLandTile(): { x: number; y: number } | null {
        const w = this.mapSize.width;
        const h = this.mapSize.height;
        const cx = Math.floor(w / 2);
        const cy = Math.floor(h / 2);

        for (let r = 0; r < Math.max(w, h) / 2; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const tx = cx + dx;
                    const ty = cy + dy;
                    if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
                    if (isBuildable(this.groundType[this.mapSize.toIndex(tx, ty)])) {
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
     * Load and execute a mission script for the current map.
     *
     * @param mapFilename The map filename to derive script path from
     * @returns Load result with success status
     */
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
                    mapWidth: this.mapSize.width,
                    mapHeight: this.mapSize.height,
                    landscape: this.mapLoader.landscape,
                });
                await service.initialize();
                this.gameLoop.registerSystem(service);
                this.scriptService = service;
            }

            return (this.scriptService as any).loadScriptForMap(mapFilename);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { success: false, scriptPath: null, error: msg };
        }
    }

    /** Start the game loop */
    public start(): void {
        this.gameLoop.start();
    }

    /** Stop the game loop */
    public stop(): void {
        this.gameLoop.stop();
    }

    /** Destroy the game and clean up all resources */
    public destroy(): void {
        if (this.scriptService && typeof (this.scriptService as any).destroy === 'function') {
            (this.scriptService as any).destroy();
        }
        this.gameLoop.destroy();
    }
}
