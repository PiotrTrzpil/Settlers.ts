import { FileManager } from '@/utilities/file-manager';
import { IMapLoader } from '@/resources/map/imap-loader';
import { MapSize } from '@/utilities/map-size';
import { GameState } from './game-state';
import { GameLoop } from './game-loop';
import { Command, executeCommand } from './commands/command';

/** contains the game state */
export class Game {
    public mapSize: MapSize;
    public groundHeight: Uint8Array;
    public groundType: Uint8Array;
    public fileManager: FileManager;
    public state: GameState;
    public gameLoop: GameLoop;

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
    }

    /** Execute a command against the game state */
    public execute(cmd: Command): boolean {
        return executeCommand(this.state, cmd, this.groundType, this.groundHeight, this.mapSize);
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
