import { ILandscapeTexture, TextureBlockSizeX, TextureBlockSizeY } from './i-landscape-texture';
import { LandscapeType } from '../landscape-type';
import { TexturePoint } from './texture-point';
import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { TextureMap16Bit } from '../../texture-map-16bit';
import { LandscapeTextureBase } from './landscape-texture-base';
import { AtlasLayout } from './atlas-layout';

/**
 * Defines a landscape texture with the size 64x64 that has only one LandscapeType
 */
export class SmallLandscapeTexture extends LandscapeTextureBase implements ILandscapeTexture {
    private readonly srcX: number;
    private readonly srcY: number;
    private type: LandscapeType;

    constructor(layout: AtlasLayout, type: LandscapeType, x: number, y: number) {
        super(layout);
        this.srcX = x * TextureBlockSizeX;
        this.srcY = y * TextureBlockSizeY;
        this.type = type;
    }

    public getTextureA(tp: TexturePoint, x: number, y: number): [number, number] {
        const { destX, destY } = this.layout.get(this.srcX, this.srcY);
        return [destX + (x % 2) * 2 + 1, destY + (y % 2)];
    }

    public getTextureB(tp: TexturePoint, x: number, y: number): [number, number] {
        const { destX, destY } = this.layout.get(this.srcX, this.srcY);
        return [destX + (x % 2) * 2, destY + (y % 2)];
    }

    public getPattern(): TexturePoint[] {
        return [new TexturePoint(this.type, this.type, this.type)];
    }

    public copyToTextureMap(srcImg: GfxImage16Bit, destTextureMap: TextureMap16Bit): void {
        this.copyImage(srcImg, destTextureMap, 64, this.srcX, this.srcY);
    }
}
