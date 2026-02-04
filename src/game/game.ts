import { FileManager } from '@/utilities/file-manager';
import { IMapLoader } from '@/resources/map/imap-loader';
import { MapSize } from '@/utilities/map-size';
import { EntityType } from './entity';
import { GameState } from './game-state';
import { GameLoop } from './game-loop';
import { Command, executeCommand } from './commands/command';
import { TerritoryMap } from './systems/territory';
import { canPlaceBuildingWithTerritory, isBuildable } from './systems/placement';

/** contains the game state */
export class Game {
    public mapSize: MapSize;
    public groundHeight: Uint8Array;
    public groundType: Uint8Array;
    public fileManager: FileManager;
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

    public constructor(fileManager: FileManager, mapLoader: IMapLoader) {
        this.fileManager = fileManager;
        this.mapSize = mapLoader.mapSize;
        this.groundHeight = mapLoader.landscape.getGroundHeight();
        this.groundType = mapLoader.landscape.getGroundType();

        this.state = new GameState();
        this.gameLoop = new GameLoop(this.state);
        this.territory = new TerritoryMap(this.mapSize);
    }

    /** Execute a command against the game state, then update territory if needed */
    public execute(cmd: Command): boolean {
        // Enforce territory rules for building placement
        if (cmd.type === 'place_building') {
            const hasBuildings = this.state.entities.some(
                e => e.type === EntityType.Building && e.player === cmd.player
            );
            if (!canPlaceBuildingWithTerritory(
                this.groundType, this.groundHeight, this.mapSize,
                this.state.tileOccupancy, this.territory,
                cmd.x, cmd.y, cmd.player, hasBuildings
            )) {
                return false;
            }
        }

        const result = executeCommand(this.state, cmd, this.groundType, this.groundHeight, this.mapSize);

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

    /** Start the game loop */
    public start(): void {
        this.gameLoop.start();
    }

    /** Stop the game loop */
    public stop(): void {
        this.gameLoop.stop();
    }
}
