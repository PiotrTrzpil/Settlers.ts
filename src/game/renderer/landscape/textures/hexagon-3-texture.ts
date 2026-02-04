import { ILandscapeTexture, TextureBlockSizeX, TextureBlockSizeY } from './i-landscape-texture';
import { LandscapeType } from '../landscape-type';
import { TexturePoint } from './texture-point';
import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { TextureMap16Bit } from '../../texture-map-16bit';
import { LandscapeTextureBase } from './landscape-texture-base';
import { AtlasLayout } from './atlas-layout';

export class Hexagon3Texture extends LandscapeTextureBase implements ILandscapeTexture {
    private readonly srcX1: number;
    private readonly srcY1: number;
    private readonly srcX2: number;
    private readonly srcY2: number;
    private t1: LandscapeType;
    private t2: LandscapeType;
    private t3: LandscapeType;

    constructor(layout: AtlasLayout, t1: LandscapeType, t2: LandscapeType, t3: LandscapeType, x1: number, y1: number, x2: number, y2: number) {
        super(layout);

        this.srcX1 = x1 * TextureBlockSizeX;
        this.srcY1 = y1 * TextureBlockSizeY;
        this.srcX2 = x2 * TextureBlockSizeX;
        this.srcY2 = y2 * TextureBlockSizeY;

        this.t1 = t1;
        this.t2 = t2;
        this.t3 = t3;
    }

    public getTextureA(tp: TexturePoint, x: number, y: number): [number, number] {
        const use2 = ((x + y) % 2) === 0;
        const { destX, destY } = this.layout.get(
            use2 ? this.srcX2 : this.srcX1,
            use2 ? this.srcY2 : this.srcY1
        );

        // todo: add rotation-specific sub-tile offsets when the correct layout is known
        return [destX, destY];
    }

    public getTextureB(tp: TexturePoint, x: number, y: number): [number, number] {
        const use2 = ((x + y) % 2) === 0;
        const { destX, destY } = this.layout.get(
            use2 ? this.srcX2 : this.srcX1,
            use2 ? this.srcY2 : this.srcY1
        );

        // todo: add rotation-specific sub-tile offsets when the correct layout is known
        return [destX, destY];
    }

    public getPattern(): TexturePoint[] {
        return [
            new TexturePoint(this.t1, this.t2, this.t3),
            new TexturePoint(this.t3, this.t1, this.t2),
            new TexturePoint(this.t2, this.t3, this.t1)
        ];
    }

    public copyToTextureMap(srcImg: GfxImage16Bit, destTextureMap: TextureMap16Bit): void {
        this.copyImage(srcImg, destTextureMap, 64, this.srcX1, this.srcY1);
        this.copyImage(srcImg, destTextureMap, 64, this.srcX2, this.srcY2);
    }
}
