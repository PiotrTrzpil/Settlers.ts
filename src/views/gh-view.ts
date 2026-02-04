import { Options, Vue } from 'vue-class-component';
import { GhFileReader } from '@/resources/gfx/gh-file-reader';
import { IGfxImage } from '@/resources/gfx/igfx-image';
import { ImageType } from '@/resources/gfx/image-type';
import { FileManager, IFileSource } from '@/utilities/file-manager';
import { pad, renderImageToCanvas, collectImages } from '@/utilities/view-helpers';

import FileBrowser from '@/components/file-browser.vue';
import HexViewer from '@/components/hex-viewer.vue';

@Options({
    name: 'GhView',
    props: {
        fileManager: Object
    },
    components: {
        FileBrowser,
        HexViewer
    }
})
export default class GhView extends Vue {
    public fileName: string | null = null;
    public readonly fileManager!: FileManager;
    public ghInfo = '';
    public ghContent: IGfxImage[] = [];
    public selectedItem: IGfxImage | null = null;

    public onFileSelect(file: IFileSource): void {
        this.fileName = file.name;
        void this.load(file);
    }

    public pad(value: string, size: number): string {
        return pad(value, size);
    }

    /** load a new gh */
    public async load(file: IFileSource):Promise<void> {
        const content = await file.readBinary();

        const ghFile = new GhFileReader(content);

        this.ghContent = collectImages(
            () => ghFile.getImageCount(),
            (i) => ghFile.getImage(i)
        );
        this.ghInfo = ghFile.toString();
    }

    public toImageTypeStr(imgType: ImageType): string {
        return ImageType[imgType];
    }

    public onSelectItem(): void {
        const img = this.selectedItem;
        if (!img) {
            return;
        }

        renderImageToCanvas(img, this.$refs.ghCav as HTMLCanvasElement);
    }
}
