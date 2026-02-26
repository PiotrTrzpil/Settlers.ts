import { BinaryReader } from '../file/binary-reader';
import { IndexFile } from './index-file';

/** interprets a .jil file -
 *    jil may stand for: "job index list" file
 *    it indicates the different jobs in a .dil file
 *        jil (job)    --> .dil (direction)--> gil (frames) --> gfx
 * */
export class JilFileReader extends IndexFile {
    constructor(resourceReader: BinaryReader) {
        super(resourceReader);
        Object.seal(this);
    }

    public override toString(): string {
        return 'jil: ' + super.toString();
    }
}
