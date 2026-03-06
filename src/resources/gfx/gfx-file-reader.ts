import { LogHandler } from '@/utilities/log-handler';
import { BinaryReader } from '../file/binary-reader';
import { DilFileReader } from './dil-file-reader';
import { GfxImage } from './gfx-image';
import { GilFileReader } from './gil-file-reader';
import { JilFileReader } from './jil-file-reader';
import { PaletteCollection } from './palette-collection';
import { ResourceFile } from './resource-file';

/**
 * reads a .gfx file that contains images
 * */
export class GfxFileReader extends ResourceFile {
    private static log: LogHandler = new LogHandler('GfxFileReader');
    private reader: BinaryReader;
    private gilFileReader: GilFileReader;
    private jilFileReader: JilFileReader | null;
    private dilFileReader: DilFileReader | null;
    private paletteCollection: PaletteCollection;

    // private images: GfxImage[] = []
    private isWordHeader = false;
    private lastGoodJobIndex = 0;

    /** return the number of images in this gfx file */
    public getImageCount(): number {
        return this.gilFileReader.length;
    }

    /** Return the raw GFX file buffer for batch worker decoding */
    public getBuffer(): ArrayBuffer {
        const buf = this.reader.getBuffer();
        return buf.buffer as ArrayBuffer;
    }

    /** return a Image by index */
    public getImage(index: number): GfxImage | null {
        if (index < 0 || index >= this.gilFileReader.length) {
            GfxFileReader.log.error('Image Index out of range: ' + index);
            return null;
        }

        const gfxOffset = this.gilFileReader.getImageOffset(index);

        let jobIndex = index;
        /// if we use a jil file or not?
        if (this.dilFileReader && this.jilFileReader) {
            const dirOffset = this.dilFileReader.reverseLookupIndex(index);
            jobIndex = this.jilFileReader.reverseLookupIndex(dirOffset);

            if (jobIndex === -1) {
                jobIndex = this.lastGoodJobIndex;
            } else {
                this.lastGoodJobIndex = jobIndex;
            }
        }

        return this.readImage(gfxOffset, jobIndex);
    }

    constructor(
        reader: BinaryReader,
        gilFileReader: GilFileReader,
        jilFileReader: JilFileReader | null,
        dilFileReader: DilFileReader | null,
        paletteCollection: PaletteCollection
    ) {
        super();

        this.reader = reader;
        this.gilFileReader = gilFileReader;
        this.jilFileReader = jilFileReader;
        this.dilFileReader = dilFileReader;
        this.paletteCollection = paletteCollection;

        super.readResource(reader);

        Object.seal(this);
    }

    public readImage(offset: number, paletteIndex: number): GfxImage {
        const reader = this.reader;
        const palette = this.paletteCollection.getPalette();
        const paletteOffset = this.paletteCollection.getOffset(paletteIndex);

        reader.setOffset(offset);

        const imgHeadType = reader.readWord();

        reader.setOffset(offset);

        const newImg = new GfxImage(reader, palette, paletteOffset);

        if (imgHeadType > 860) {
            this.isWordHeader = true;

            newImg.headType = true;
            newImg.width = reader.readByte();
            newImg.height = reader.readByte();
            newImg.left = reader.readByte();
            newImg.top = reader.readByte();

            newImg.imgType = 0;

            newImg.flag1 = reader.readWord();
            newImg.flag2 = reader.readWord();

            newImg.dataOffset = offset + 8;
        } else {
            this.isWordHeader = false;

            newImg.headType = false;
            newImg.width = reader.readWord();
            newImg.height = reader.readWord();
            newImg.left = reader.readWord();
            newImg.top = reader.readWord();

            newImg.imgType = reader.readByte();

            newImg.flag1 = reader.readByte();
            newImg.flag2 = reader.readInt(2);

            newImg.dataOffset = offset + 12;
        }

        return newImg;
    }

    public override toString(): string {
        return 'gfx: ' + super.toString() + ', --- ' + this.isWordHeader;
    }
}
