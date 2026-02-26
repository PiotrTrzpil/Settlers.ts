import { BinaryReader } from '../file/binary-reader';
import { IndexFile } from './index-file';

/** interprets a .dil file -
 *    dil may stand for: "direction index list" file
 *    it indicates the different object directions in a gil file
 *        jil (job)    --> .dil (direction)--> gil (frames) --> gfx
 * */
export class DilFileReader extends IndexFile {
    constructor(resourceReader: BinaryReader) {
        super(resourceReader);
        Object.seal(this);
    }

    public override toString(): string {
        return 'dil: ' + super.toString();
    }
}
