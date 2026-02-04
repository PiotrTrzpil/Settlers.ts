import { ILandscapeTexture, TextureBlockSizeY } from './i-landscape-texture';
import { LandscapeType } from '../landscape-type';
import { TexturePoint } from './texture-point';
import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { TextureMap16Bit } from '../../texture-map-16bit';
import { LandscapeTextureBase } from './landscape-texture-base';
import { AtlasLayout } from './atlas-layout';

/**
 * Defines a landscape texture with the size 256x256 that has only one LandscapeType
 */
export class BigLandscapeTexture extends LandscapeTextureBase implements ILandscapeTexture {
    private readonly srcX = 0;
    private readonly srcY: number;
    private type: LandscapeType;

    constructor(layout: AtlasLayout, type: LandscapeType, y: number) {
        super(layout);

        this.srcY = y * TextureBlockSizeY;
        this.type = type;
    }

    public getTextureA(tp: TexturePoint, x: number, y: number): [number, number] {
        const { destX, destY } = this.layout.get(this.srcX, this.srcY);
        return [destX + (x % 8) * 2 + 2, destY + (y % 8)];
    }

    public getTextureB(tp: TexturePoint, x: number, y: number): [number, number] {
        const { destX, destY } = this.layout.get(this.srcX, this.srcY);
        return [destX + (x % 8) * 2 + 2, destY + (y % 8)];
    }

    public getPattern(): TexturePoint[] {
        return [new TexturePoint(this.type, this.type, this.type)];
    }

    public copyToTextureMap(srcImg: GfxImage16Bit, destTextureMap: TextureMap16Bit): void {
        if (this.layout.has(this.srcX, this.srcY)) return;

        const repeatWidth = 32;
        const dest = destTextureMap.reserve(256 + repeatWidth, 256);

        if (dest == null) {
            this.layout.set(this.srcX, this.srcY, 0, 0);
            return;
        }

        dest.copyFrom(srcImg, this.srcX * 16, this.srcY * 32, 256, 256);

        // we also copy the front part of the texture to the end so we are able to
        //  fake GL_REPEAT when we address texture on the right part
        dest.copyFrom(srcImg, this.srcX * 16, this.srcY * 32, repeatWidth, 256, 256);

        this.layout.set(this.srcX, this.srcY, dest.x / 16, dest.y / 32);
    }
}
