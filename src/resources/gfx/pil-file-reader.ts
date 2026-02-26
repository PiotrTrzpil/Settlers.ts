import { LogHandler } from '@/utilities/log-handler';
import { BinaryReader } from '../file/binary-reader';
import { ResourceFile } from './resource-file';

/** interprets a .pil file -
 *    pil may stand for: "palette index list" file"
 *    it is a list of file indexes used to read a .pa5 or .pa6 file
 * */
export class PilFileReader extends ResourceFile {
    private static log: LogHandler = new LogHandler('PilFileReader');

    private offsetTable: Int32Array;

    public getOffset(gfxImageIndex: number): number {
        return this.offsetTable[gfxImageIndex]!;
    }

    public get length(): number {
        return this.offsetTable.length;
    }

    constructor(source: BinaryReader | Int32Array) {
        super();

        if (source instanceof Int32Array) {
            this.offsetTable = source;
        } else {
            const reader = this.readResource(source);

            /// read the palette offsets
            const imageCount = reader.length / 4;

            this.offsetTable = new Int32Array(imageCount);

            for (let i = 0; i < imageCount; i++) {
                this.offsetTable[i] = reader.readInt();
            }
        }

        Object.seal(this);
    }

    public override toString(): string {
        return 'pil: ' + super.toString();
    }
}
