import { Options, Vue } from 'vue-class-component';
import { Path } from '@/utilities/path';
import { GfxFileReader } from '@/resources/gfx/gfx-file-reader';
import { GilFileReader } from '@/resources/gfx/gil-file-reader';
import { DilFileReader } from '@/resources/gfx/dil-file-reader';
import { LogHandler } from '@/utilities/log-handler';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { IndexFileItem } from '@/resources/gfx/index-file-item';
import { pad, loadGfxFileSet, parseGfxReaders } from '@/utilities/view-helpers';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

@Options({
    name: 'JilView',
    props: {
        fileManager: Object
    },
    components: {
        FileBrowser,
        HexViewer
    }
})
export default class JilView extends Vue {
    private static log = new LogHandler('JilView');
    public readonly fileManager!: FileManager;

    protected doAnimation = true;
    private animationTimer = 0;

    public fileName: string | null = null;
    public jilList: IndexFileItem[] = [];
    public dilList: IndexFileItem[] = [];
    public gilList: IndexFileItem[] = [];

    public selectedJil: IndexFileItem | null = null;
    public selectedDil: IndexFileItem | null = null;
    public selectedGil: IndexFileItem | null = null;

    public gfxFileReader: GfxFileReader | null = null;

    public dilFileReader: DilFileReader | null = null;
    public gilFileReader: GilFileReader | null = null;

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

        this.dilFileReader = readers.dilFileReader;
        this.gilFileReader = readers.gilFileReader;
        const jilFileReader = readers.jilFileReader;
        this.jilList = jilFileReader.getItems(0);

        this.gfxFileReader = new GfxFileReader(
            fileSet.gfx,
            this.gilFileReader,
            jilFileReader,
            this.dilFileReader,
            readers.paletteCollection);

        JilView.log.debug('File: ' + fileId);
    }

    public onSelectJil(): void {
        if ((!this.selectedJil) || (!this.dilFileReader)) {
            return;
        }

        this.dilList = this.dilFileReader.getItems(this.selectedJil.offset, this.selectedJil.lenght);
        this.selectedDil = this.dilList[0];
        this.onSelectDil();
    }

    public onSelectDil(): void {
        if ((!this.selectedDil) || (!this.gilFileReader)) {
            return;
        }

        this.gilList = this.gilFileReader.getItems(this.selectedDil.offset, this.selectedDil.lenght);
        this.selectedGil = this.gilList[0];
        this.onSelectGil();
    }

    public onSelectGil(): void {
        if ((!this.selectedGil) || (!this.gfxFileReader) || (!this.selectedJil) || (!this.gilFileReader)) {
            return;
        }

        const offset = this.gilFileReader.getImageOffset(this.selectedGil.index);
        const gfx = this.gfxFileReader.readImage(offset, this.selectedJil.index);
        if (!gfx) {
            return;
        }

        const img = gfx.getImageData();
        const cav = this.$refs.ghCav as HTMLCanvasElement;
        if ((!cav) || (!cav.getContext)) {
            return;
        }

        cav.height = img.height;
        const context = cav.getContext('2d');

        if (!context) {
            return;
        }

        context.putImageData(img, 0, 0);
    }

    private onAnimate() {
        if ((this.gilList == null) || (!this.gilList.length) || (!this.doAnimation)) {
            return;
        }

        const nextFrameIndex = (this.gilList.findIndex((f) => f === this.selectedGil) + 1) % this.gilList.length;
        this.selectedGil = this.gilList[nextFrameIndex];
        this.onSelectGil();
    }

    public mounted(): void {
        this.animationTimer = window.setInterval(() => this.onAnimate(), 100);
    }

    public unmounted(): void {
        window.clearInterval(this.animationTimer);
    }
}
