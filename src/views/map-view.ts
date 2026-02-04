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

    public hoveredTile: TileCoord | null = null;

    public get selectedEntity(): Entity | undefined {
        if (!this.game || this.game.state.selectedEntityId === null) return undefined;
        return this.game.state.getEntity(this.game.state.selectedEntityId);
    }

    public onFileSelect(file: IFileSource): void {
        this.fileName = file.name;
        this.load(file);
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

    public spawnUnit(unitType: number): void {
        if (!this.game) return;

        // Spawn at selected entity location, or at a default position
        let spawnX = 10;
        let spawnY = 10;

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
