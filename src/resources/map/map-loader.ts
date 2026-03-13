import { BinaryReader } from '../file/binary-reader';
import { IMapLoader } from './imap-loader';
import { OriginalMapLoader } from './original/original-map/game-map-loader';
import { SaveGameLoader } from './original/original-savegame/savegame-loader';

/** handel the loading of a map */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- utility namespace class with static members only
export class MapLoader {
    /** return the map content of a loaded game */
    public static getLoader(reader: BinaryReader): IMapLoader | null {
        switch (MapLoader.getFileExtension(reader.filename).toLowerCase()) {
            case 'exe':
                return new SaveGameLoader(reader);
            case 'map':
                return new OriginalMapLoader(reader);
            case 'edm':
                return new OriginalMapLoader(reader);
            default:
                return null;
        }
    }

    /** return the file extension e.g. "map" of "test.map" */
    private static getFileExtension(fileName: string): string {
        const pos = fileName.lastIndexOf('.');
        if (pos < 0) {
            return '';
        }

        return fileName.substring(pos + 1);
    }
}
