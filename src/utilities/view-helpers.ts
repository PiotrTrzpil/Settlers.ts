import { BinaryReader } from '@/resources/file/binary-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { JilFileReader } from '@/resources/gfx/jil-file-reader';
import { PaletteCollection } from '@/resources/gfx/palette-collection';
import { PilFileReader } from '@/resources/gfx/pil-file-reader';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { FileManager } from '@/utilities/file-manager';

/** Pad a display string with non-breaking spaces to a fixed width */
export function pad(value: string | number, size: number): string {
    const str = ('' + value + '').split(' ').join('\u00a0');
    const padSize = Math.max(0, size - str.length);
    return str + ('\u00a0'.repeat(padSize));
}

/** Render an IGfxImage to a canvas element */
export function renderImageToCanvas(img: IGfxImage, canvas: HTMLCanvasElement): void {
    if (!canvas || !canvas.getContext) {
        return;
    }

    canvas.height = img.height;
    const context = canvas.getContext('2d');

    if (!context) {
        return;
    }

    context.putImageData(img.getImageData(), 0, 0);
}

/** Collect all non-null images from a reader into a list */
export function collectImages(getImageCount: () => number, getImage: (i: number) => IGfxImage | null): IGfxImage[] {
    const list: IGfxImage[] = [];
    const count = getImageCount();

    for (let i = 0; i < count; i++) {
        const img = getImage(i);
        if (img) {
            list.push(img);
        }
    }

    return list;
}

/** Result of loading GFX-related files */
export interface GfxFileSet {
    gfx: BinaryReader;
    gil: BinaryReader;
    paletteIndex: BinaryReader;
    palette: BinaryReader;
    dil: BinaryReader;
    jil: BinaryReader;
}

/** Parsed GFX readers common to jil-view and gfx-view */
export interface ParsedGfxReaders {
    gilFileReader: GilFileReader;
    jilFileReader: JilFileReader | null;
    dilFileReader: DilFileReader | null;
    paletteCollection: PaletteCollection;
    files: GfxFileSet;
}

/** Load the common set of GFX-related files for a given file ID */
export async function loadGfxFileSet(fileManager: FileManager, fileId: string): Promise<GfxFileSet> {
    const fileNameList: { [key: string]: string } = {};

    fileNameList.gfx = fileId + '.gfx';
    fileNameList.gil = fileId + '.gil';

    const pilFileExists = fileManager.findFile(fileId + '.pil', false);

    if (pilFileExists) {
        fileNameList.paletteIndex = fileId + '.pil';
        fileNameList.palette = fileId + '.pa6';
    } else {
        fileNameList.paletteIndex = fileId + '.pi4';
        fileNameList.palette = fileId + '.p46';
    }

    fileNameList.dil = fileId + '.dil';
    fileNameList.jil = fileId + '.jil';

    const files = await fileManager.readFiles(fileNameList, true);
    return files as unknown as GfxFileSet;
}

/** Parse the common GFX readers from a loaded file set */
export function parseGfxReaders(files: GfxFileSet): ParsedGfxReaders {
    const paletteIndexList = new PilFileReader(files.paletteIndex);
    const paletteCollection = new PaletteCollection(files.palette, paletteIndexList);
    const gilFileReader = new GilFileReader(files.gil);

    // Only create dil/jil readers if the files exist (have content)
    const hasDil = files.dil.length > 0;
    const hasJil = files.jil.length > 0;
    const dilFileReader = hasDil ? new DilFileReader(files.dil) : null;
    const jilFileReader = hasJil ? new JilFileReader(files.jil) : null;

    return {
        gilFileReader,
        jilFileReader,
        dilFileReader,
        paletteCollection,
        files
    };
}
