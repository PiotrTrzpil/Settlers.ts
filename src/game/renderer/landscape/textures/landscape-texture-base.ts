import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { TextureMap16Bit } from '../../texture-map-16bit';
import { AtlasLayout } from './atlas-layout';

export class LandscapeTextureBase {
    protected layout: AtlasLayout;

    constructor(layout: AtlasLayout) {
        this.layout = layout;
    }

    protected copyImage(srcImg: GfxImage16Bit, destTextureMap: TextureMap16Bit, width: number, srcX: number, srcY: number): void {
        // Skip if this source position was already copied (shared by multiple textures)
        if (this.layout.has(srcX, srcY)) return;

        const dest = destTextureMap.reserve(width, width);

        if (dest == null) {
            this.layout.set(srcX, srcY, 0, 0);
            return;
        }

        dest.copyFrom(srcImg, srcX * 16, srcY * 32, width, width);
        this.layout.set(srcX, srcY, dest.x / 16, dest.y / 32);
    }
}
