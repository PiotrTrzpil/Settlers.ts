import { ILandscapeTexture, TextureBlockSizeX, TextureBlockSizeY } from './i-landscape-texture';
import { LandscapeType } from '../landscape-type';
import { TexturePoint } from './texture-point';
import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { TextureMap16Bit } from '../../texture-map-16bit';
import { LandscapeTextureBase } from './landscape-texture-base';
import { AtlasLayout } from './atlas-layout';

export class Hexagon2Texture extends LandscapeTextureBase implements ILandscapeTexture {
    readonly srcX1: number;
    readonly srcY1: number;
    readonly srcX2: number;
    readonly srcY2: number;
    private outerType: LandscapeType;
    private innerType: LandscapeType;
    private useTwo: boolean;

    constructor(layout: AtlasLayout, typeOut: LandscapeType, typeIn: LandscapeType, x1: number, y1: number, x2?: number, y2?: number) {
        super(layout);

        this.srcX1 = x1 * TextureBlockSizeX;
        this.srcY1 = y1 * TextureBlockSizeY;

        if ((x2 != null) && (y2 != null)) {
            this.useTwo = true;
            this.srcX2 = x2 * TextureBlockSizeX;
            this.srcY2 = y2 * TextureBlockSizeY;
        } else {
            this.useTwo = false;
            this.srcX2 = this.srcX1;
            this.srcY2 = this.srcY1;
        }

        this.outerType = typeOut;
        this.innerType = typeIn;
    }

    /** Create a new texture with the same source positions but different type
     *  assignments. Because both share the same AtlasLayout, the new object
     *  resolves to the same atlas dest positions. */
    public withTypes(outerType: LandscapeType, innerType: LandscapeType): Hexagon2Texture {
        return new Hexagon2Texture(
            this.layout, outerType, innerType,
            this.srcX1 / TextureBlockSizeX, this.srcY1 / TextureBlockSizeY,
            this.useTwo ? this.srcX2 / TextureBlockSizeX : undefined,
            this.useTwo ? this.srcY2 / TextureBlockSizeY : undefined
        );
    }

    public getTextureA(tp: TexturePoint, x: number, y: number): [number, number] {
        const use2 = ((x + y) % 2) === 0;
        const { destX, destY } = this.layout.get(
            use2 ? this.srcX2 : this.srcX1,
            use2 ? this.srcY2 : this.srcY1
        );

        if (tp.t0 === this.innerType) {
            return [destX + 2, destY + 1];
        } else if (tp.t1 === this.innerType) {
            return [destX + 3, destY];
        } else {
            return [destX + 1, destY];
        }
    }

    public getTextureB(tp: TexturePoint, x: number, y: number): [number, number] {
        const use2 = ((x + y) % 2) === 0;
        const { destX, destY } = this.layout.get(
            use2 ? this.srcX2 : this.srcX1,
            use2 ? this.srcY2 : this.srcY1
        );

        if (tp.t0 === this.innerType) {
            return [destX + 2, destY + 1];
        } else if (tp.t1 === this.innerType) {
            return [destX + 1, destY];
        } else {
            return [destX, destY + 1];
        }
    }

    public getPattern(): TexturePoint[] {
        return [
            new TexturePoint(this.outerType, this.outerType, this.innerType),
            new TexturePoint(this.innerType, this.outerType, this.outerType),
            new TexturePoint(this.outerType, this.innerType, this.outerType)
        ];
    }

    public copyToTextureMap(srcImg: GfxImage16Bit, destTextureMap: TextureMap16Bit): void {
        this.copyImage(srcImg, destTextureMap, 64, this.srcX1, this.srcY1);

        if (this.useTwo) {
            this.copyImage(srcImg, destTextureMap, 64, this.srcX2, this.srcY2);
        }
    }
}
