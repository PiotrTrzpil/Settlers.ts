import { Options, Vue } from 'vue-class-component';
import { MapLoader } from '@/resources/map/map-loader';
import { Game } from '@/game/game';
import { Entity, TileCoord, UnitType } from '@/game/entity';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { LogHandler } from '@/utilities/log-handler';

import FileBrowser from '@/components/file-browser.vue';
import RendererViewer from '@/components/renderer-viewer.vue';

@Options({
    name: 'MapView',
    props: {
        fileManager: Object
    },
    components: {
        FileBrowser,
        RendererViewer
    }
})
export default class MapView extends Vue {
    private static log = new LogHandler('MapView');
    public readonly fileManager!: FileManager;

    public fileName: string | null = null;
    public mapInfo = '';
    public game: Game | null = null;
    protected showDebug = false;
    public activeTab: 'buildings' | 'units' = 'buildings';

    public hoveredTile: TileCoord | null = null;

    public mounted(): void {
        this.autoLoadFirstMap();
        this.$watch('fileManager', () => this.autoLoadFirstMap());
    }

    private autoLoadFirstMap(): void {
        if (this.game || !this.fileManager) return;
        const maps = this.fileManager.filter('.map');
        if (maps.length > 0) {
            this.onFileSelect(maps[0]);
        }
    }

    public get selectedEntity(): Entity | undefined {
        if (!this.game || this.game.state.selectedEntityId === null) return undefined;
        return this.game.state.getEntity(this.game.state.selectedEntityId);
    }

    public get selectionCount(): number {
        if (!this.game) return 0;
        return this.game.state.selectedEntityIds.size;
    }

    public onFileSelect(file: IFileSource): void {
        this.fileName = file.name;
        void this.load(file);
    }

    public onTileClick(tile: TileCoord): void {
        this.hoveredTile = tile;
    }

    public setPlaceMode(buildingType: number): void {
        if (!this.game) return;
        this.game.mode = 'place_building';
        this.game.placeBuildingType = buildingType;
    }

    public setSelectMode(): void {
        if (!this.game) return;
        this.game.mode = 'select';
    }

    public removeSelected(): void {
        if (!this.game || this.game.state.selectedEntityId === null) return;
        this.game.execute({
            type: 'remove_entity',
            entityId: this.game.state.selectedEntityId
        });
    }

    public togglePause(): void {
        if (!this.game) return;
        if (this.game.gameLoop.isRunning) {
            this.game.stop();
        } else {
            this.game.start();
        }
    }

    public get isPaused(): boolean {
        if (!this.game) return false;
        return !this.game.gameLoop.isRunning;
    }

    public spawnUnit(unitType: number): void {
        if (!this.game) return;

        // Spawn at selected entity location, last clicked tile, or first land tile
        let spawnX = -1;
        let spawnY = -1;

        if (this.game.state.selectedEntityId !== null) {
            const selected = this.game.state.getEntity(this.game.state.selectedEntityId);
            if (selected) {
                spawnX = selected.x;
                spawnY = selected.y;
            }
        } else if (this.hoveredTile) {
            spawnX = this.hoveredTile.x;
            spawnY = this.hoveredTile.y;
        }

        // If no valid position chosen, find buildable land
        if (spawnX < 0) {
            const land = this.game.findLandTile();
            if (land) {
                spawnX = land.x;
                spawnY = land.y;
            }
        }

        if (spawnX < 0) return; // no valid tile found

        this.game.execute({
            type: 'spawn_unit',
            unitType: unitType as UnitType,
            x: spawnX,
            y: spawnY,
            player: this.game.currentPlayer
        });
    }

    /** load a new game/level */
    public async load(file: IFileSource): Promise<void> {
        if (!this.fileManager) {
            return;
        }

        try {
            const fileData = await file.readBinary();
            if (!fileData) {
                MapView.log.error('Unable to load ' + file.name);
                return;
            }

            const mapContent = MapLoader.getLoader(fileData);
            if (!mapContent) {
                MapView.log.error('Unsupported map format: ' + file.name);
                return;
            }

            this.mapInfo = mapContent.toString();
            this.game = new Game(this.fileManager, mapContent);
        } catch (e) {
            MapView.log.error('Failed to load map: ' + file.name, e instanceof Error ? e : new Error(String(e)));
        }
    }
}
