import { BinaryReader } from '@/resources/file/binary-reader';
import { LogHandler } from '@/utilities/log-handler';
import { MapSize } from '@/utilities/map-size';
import { GeneralMapInformation } from '../../general-map-information';
import { IMapLandscape } from '../../imap-landscape';
import { IMapLoader } from '../../imap-loader';
import type { MapEntityData } from '../../map-entity-data';
import { createEmptyEntityData } from '../../map-entity-data';
import { MapChunkType } from '../map-chunk-type';
import { OriginalLandscape } from '../original-landscape';
import { OriginalMapFile } from '../original-map-file';
import {
    parsePlayerInformation,
    parseBuildings,
    parseSettlers,
    parseStacks,
    parseMapObjects,
} from '../chunk-parsers';

/** load a .map or a .edm map */
export class OriginalMapLoader extends OriginalMapFile implements IMapLoader {
    private logLoader: LogHandler = new LogHandler('OriginalMapLoader');

    public general: GeneralMapInformation = new GeneralMapInformation();
    public mapSize : MapSize = new MapSize(0, 0);

    public unknown5 = 0;
    public unknown6 = 0;

    constructor(data: BinaryReader) {
        super(data);

        this.readGeneralInformation();

        this.logLoader.debug(this.general.toString());

        Object.seal(this);
    }

    private _landscape: OriginalLandscape | null = null;
    get landscape(): IMapLandscape {
        if (!this._landscape) {
            this._landscape = new OriginalLandscape(this, this.mapSize, MapChunkType.MapLandscape);
        }

        return this._landscape;
    }

    private _entityData: MapEntityData | null = null;
    get entityData(): MapEntityData {
        if (!this._entityData) {
            this._entityData = this.parseEntityData();
        }
        return this._entityData;
    }

    /**
     * Parse entity data from map chunks
     */
    private parseEntityData(): MapEntityData {
        const data = createEmptyEntityData();

        // Parse player information (chunk type 2)
        const playerReader = this.getChunkReader(MapChunkType.MapPlayerInformation);
        if (playerReader) {
            data.players = parsePlayerInformation(playerReader);
            this.logLoader.debug(`Parsed ${data.players.length} players`);
        }

        // Parse buildings (chunk type 8)
        const buildingReader = this.getChunkReader(MapChunkType.MapBuildings);
        if (buildingReader) {
            data.buildings = parseBuildings(buildingReader);
            this.logLoader.debug(`Parsed ${data.buildings.length} buildings`);
        }

        // Parse settlers (chunk type 7)
        const settlerReader = this.getChunkReader(MapChunkType.MapSettlers);
        if (settlerReader) {
            data.settlers = parseSettlers(settlerReader);
            this.logLoader.debug(`Parsed ${data.settlers.length} settlers`);
        }

        // Parse stacks (chunk type 9)
        const stackReader = this.getChunkReader(MapChunkType.MapStacks);
        if (stackReader) {
            data.stacks = parseStacks(stackReader);
            this.logLoader.debug(`Parsed ${data.stacks.length} stacks`);
        }

        // Parse map objects - trees, decorations (chunk type 6)
        // This is tile-based data, need to pass map dimensions
        const objectReader = this.getChunkReader(MapChunkType.MapObjects);
        if (objectReader) {
            data.objects = parseMapObjects(objectReader, this.mapSize.width, this.mapSize.height);
            this.logLoader.debug(`Parsed ${data.objects.length} map objects (trees)`);
        }

        return data;
    }

    public readGeneralInformation(): boolean {
        const reader = this.getChunkReader(MapChunkType.MapGeneralInformation, 24);

        if (!reader) {
            return false;
        }

        this.general = new GeneralMapInformation();
        this.general.gameType = reader.readIntBE();
        this.general.playerCount = reader.readIntBE();
        this.general.startResources = reader.readIntBE();

        const mapSize = reader.readIntBE();
        this.mapSize = new MapSize(mapSize, mapSize);

        this.unknown5 = reader.readIntBE();
        this.unknown6 = reader.readIntBE();

        return true;
    }

    public toString():string {
        return this.general.toString() + '; ' +
                        this.mapSize.toString() + '; ' +
                        'unk5: ' + this.unknown5 + '; ' +
                        'unk6: ' + this.unknown6 + '; ';
    }
}
