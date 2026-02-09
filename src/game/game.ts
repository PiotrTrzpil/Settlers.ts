import { FileManager } from '@/utilities/file-manager';
import { IMapLoader } from '@/resources/map/imap-loader';
import { MapSize } from '@/utilities/map-size';
import { EntityType } from './entity';
import { GameState } from './game-state';
import { GameLoop } from './game-loop';
import { Command, executeCommand } from './commands/command';
import { TerritoryMap } from './buildings/territory';
import { isBuildable } from './systems/placement';
import { populateMapObjects } from './systems/map-objects';
import { SoundManager } from './audio/sound-manager';

/** contains the game state */
export class Game {
    public mapSize: MapSize;
    public groundHeight: Uint8Array;
    public groundType: Uint8Array;
    /** Raw object type data from landscape (null for test maps) */
    public objectType: Uint8Array | null = null;
    public fileManager: FileManager;
    public readonly mapLoader: IMapLoader;
    public state: GameState;
    public gameLoop: GameLoop;
    public territory: TerritoryMap;
    /** Incremented when territory changes, so renderers can cache-invalidate */
    public territoryVersion = 0;

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
        this.objectType = mapLoader.landscape.getObjectType?.() ?? null;

        this.state = new GameState();
        this.gameLoop = new GameLoop(this.state);
        this.gameLoop.setTerrainData(this.groundType, this.groundHeight, this.mapSize.width, this.mapSize.height);
        this.territory = new TerritoryMap(this.mapSize);

        if (this.objectType) {
            populateMapObjects(this.state, this.objectType, this.groundType, this.mapSize);
        }

        // Initialize Audio
        this.soundManager.init(this.fileManager).then(() => {
            if (!this.soundManager.currentMusicId) {
                console.log('Game: SoundManager initialized, requesting music...');
                this.soundManager.playRandomMusic('Roman');
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

    /** Execute a command against the game state, then update territory if needed */
    public execute(cmd: Command): boolean {
        const result = executeCommand(
            this.state, cmd, this.groundType, this.groundHeight, this.mapSize, this.territory
        );

        // Rebuild territory when buildings change
        if (result && (cmd.type === 'place_building' || cmd.type === 'remove_entity')) {
            this.rebuildTerritory();
        }

        return result;
    }

    /** Rebuild territory map from current building entities */
    public rebuildTerritory(): void {
        const buildings = this.state.entities.filter(e => e.type === EntityType.Building);
        this.territory.rebuild(buildings);
        this.territoryVersion++;
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
     * Remove all entities via the command pipeline and rebuild territory.
     * Each entity goes through the full remove_entity command flow
     * (terrain restoration, movement cleanup, selection cleanup, etc.).
     */
    public removeAllEntities(): void {
        const ids = this.state.entities.map(e => e.id);
        for (const id of ids) {
            this.execute({ type: 'remove_entity', entityId: id });
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
}
