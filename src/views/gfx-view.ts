import { Options, Vue } from 'vue-class-component';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages, loadGfxFileSet, parseGfxReaders } from '@/utilities/view-helpers';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

@Options({
    name: 'GfxView',
    props: {
        fileManager: Object
    },
    components: {
        FileBrowser,
        HexViewer
    }
})
export default class GfxView extends Vue {
    private static log = new LogHandler('GfxView');
    public readonly fileManager!: FileManager;
    public fileName: string | null = null;
    public gfxContent: IGfxImage[] = [];
    public selectedItem: IGfxImage | null = null;
    public gfxFile: GfxFileReader | null = null;

    public get imageSize(): number {
        let sum = 0;
        for (const i of this.gfxContent) {
            sum += i.height * i.width;
        }
        return sum;
    }

    public onFileSelect(file: IFileSource): void {
        this.fileName = file.name;
        void this.load(file);
    }

    public pad(value: string, size: number): string {
        return pad(value, size);
    }

    /** load a new gfx */
    public async load(file: IFileSource):Promise<void> {
        if (!this.fileManager) {
            return;
        }

        const fileId = Path.getFileNameWithoutExtension(file.name);

        void this.doLoad(fileId);
    }

    /** load a new image */
    public async doLoad(fileId: string): Promise<void> {
        const fileSet = await loadGfxFileSet(this.fileManager, fileId);
        const readers = parseGfxReaders(fileSet);

        const hasJil = fileSet.jil.length > 0;
        const directionIndexList = hasJil ? readers.dilFileReader : null;
        const jobIndexList = hasJil ? readers.jilFileReader : null;

        const gfxIndexList = new GilFileReader(fileSet.gil);
        this.gfxFile = new GfxFileReader(fileSet.gfx, gfxIndexList, jobIndexList, directionIndexList, readers.paletteCollection);

        const gfxFile = this.gfxFile;
        this.gfxContent = collectImages(
            () => gfxFile.getImageCount(),
            (i) => gfxFile.getImage(i)
        );

        GfxView.log.debug('File: ' + fileId);
        GfxView.log.debug(gfxIndexList.toString());
        GfxView.log.debug(gfxFile.toString());
    }

    public onSelectItem(): void {
        const img = this.selectedItem;
        if (!img) {
            return;
        }

        renderImageToCanvas(img, this.$refs.ghCav as HTMLCanvasElement);
    }
}
