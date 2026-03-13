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
    parseTeamInformation,
    parseQuestText,
} from '../chunk-parsers';

/** load a .map or a .edm map */
export class OriginalMapLoader extends OriginalMapFile implements IMapLoader {
    private logLoader: LogHandler = new LogHandler('Map:Loader');

    public general: GeneralMapInformation = new GeneralMapInformation();
    public mapSize: MapSize = new MapSize(0, 0);

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

        const playerReader = this.getChunkReader(MapChunkType.MapPlayerInformation);
        if (playerReader) {
            data.players = parsePlayerInformation(playerReader);
        }

        const buildingReader = this.getChunkReader(MapChunkType.MapBuildings);
        if (buildingReader) {
            data.buildings = parseBuildings(buildingReader);
        }

        const settlerReader = this.getChunkReader(MapChunkType.MapSettlers);
        if (settlerReader) {
            data.settlers = parseSettlers(settlerReader);
        }

        const stackReader = this.getChunkReader(MapChunkType.MapStacks);
        if (stackReader) {
            data.stacks = parseStacks(stackReader);
        }

        const objectReader = this.getChunkReader(MapChunkType.MapObjects);
        if (objectReader) {
            data.objects = parseMapObjects(objectReader, this.mapSize.width, this.mapSize.height);
        }

        const teamReader = this.getChunkReader(MapChunkType.MapTeamInformation);
        if (teamReader) {
            data.teams = parseTeamInformation(teamReader);
        }

        const questTextReader = this.getChunkReader(MapChunkType.MapQuestText);
        if (questTextReader) {
            data.quest.questText = parseQuestText(questTextReader);
        }

        const questTipReader = this.getChunkReader(MapChunkType.MapQuestTip);
        if (questTipReader) {
            data.quest.questTip = parseQuestText(questTipReader);
        }

        this.logLoader.debug(
            `Parsed: ${data.players.length} players, ${data.buildings.length} buildings, ` +
                `${data.settlers.length} settlers, ${data.stacks.length} stacks, ${data.objects.length} objects`
        );

        return data;
    }

    public readGeneralInformation(): boolean {
        const reader = this.getChunkReader(MapChunkType.MapGeneralInformation, 24);

        if (!reader) {
            return false;
        }

        this.general = new GeneralMapInformation();
        this.general.gameType = reader.readInt();
        this.general.playerCount = reader.readInt();
        this.general.startResources = reader.readInt();

        const mapSize = reader.readInt();
        this.mapSize = new MapSize(mapSize, mapSize);

        this.unknown5 = reader.readInt();
        this.unknown6 = reader.readInt();

        return true;
    }

    public override toString(): string {
        return (
            this.general.toString() +
            '; ' +
            this.mapSize.toString() +
            '; ' +
            'unk5: ' +
            this.unknown5 +
            '; ' +
            'unk6: ' +
            this.unknown6 +
            '; '
        );
    }
}
