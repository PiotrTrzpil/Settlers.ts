import { LogHandler } from '@/utilities/log-handler';
import { ILandscapeTexture } from './i-landscape-texture';
import { LandscapeType } from '../landscape-type';
import { BigLandscapeTexture } from './big-landscape-texture';
import { Hexagon2Texture } from './hexagon-2-texture';
import { SmallLandscapeTexture } from './small-landscape-texture';
import { Hexagon3Texture } from './hexagon-3-texture';
import { TexturePoint } from './texture-point';
import { TextureMap16Bit } from '../../texture-map-16bit';
import { GfxImage16Bit } from '@/resources/gfx/gfx-image-16bit';
import { AtlasLayout } from './atlas-layout';

/** Labels for the 3 physical atlas texture slots used by river transitions. */
export type RiverSlotId = 'A' | 'B' | 'C';

/** All 6 ways to assign the 3 physical slots to the 3 transition roles.
 *  Roles: [0]=inner (River3↔River1), [1]=outer (Grass↔River4), [2]=middle (River4↔River3)
 *  With gradientReverse layout: A=(2,72)=inner, B=(0,74)=middle, C=(2,74)=outer */
export const RIVER_SLOT_PERMS: readonly [RiverSlotId, RiverSlotId, RiverSlotId][] = [
    ['A', 'C', 'B'],  // 0: identity - inner=A, outer=C, middle=B
    ['A', 'B', 'C'],  // 1: inner=A, outer=B, middle=C
    ['B', 'A', 'C'],  // 2: inner=B, outer=A, middle=C
    ['B', 'C', 'A'],  // 3: inner=B, outer=C, middle=A
    ['C', 'A', 'B'],  // 4: inner=C, outer=A, middle=B
    ['C', 'B', 'A'],  // 5: inner=C, outer=B, middle=A
];

export interface RiverConfig {
    /** Index into RIVER_SLOT_PERMS (0–5): which physical slot handles inner/outer/middle */
    slotPermutation: number;
    /** Swap left/right pair for the inner transition (River3 ↔ River1) */
    flipInner: boolean;
    /** Swap left/right pair for the outer transition (Grass ↔ River4) */
    flipOuter: boolean;
    /** Swap left/right pair for the middle transition (River4 ↔ River3) */
    flipMiddle: boolean;
}

export class LandscapeTextureMap {
    private static log = new LogHandler('LandscapeTextureMap');
    private lookup: {[key: number]: ILandscapeTexture} = {};
    private textures: ILandscapeTexture[] = [];
    private layout = new AtlasLayout();

    /** River atlas slot objects — source positions map to dest via the shared layout */
    private riverSlots: {
        slotALeft: Hexagon2Texture; slotARight: Hexagon2Texture;
        slotBLeft: Hexagon2Texture; slotBRight: Hexagon2Texture;
        slotCLeft: Hexagon2Texture; slotCRight: Hexagon2Texture;
    } | null = null;
    /** Lookup keys currently registered for river Hexagon2Textures */
    private riverHexKeys: number[] = [];

    private addTexture(text: ILandscapeTexture) {
        this.textures.push(text);

        const pattern = text.getPattern();

        for (const p of pattern) {
            const key = p.getKey();
            if (this.lookup[key]) {
                LandscapeTextureMap.log.error('Texture type (' + p.toString() + ') already defined');
                return;
            }

            this.lookup[key] = text;
        }
    }

    private addTextureGradient1(type1: LandscapeType, type2: LandscapeType, type3: LandscapeType, type4: LandscapeType, row: number) {
        const L = this.layout;
        // Using Hexagon2Texture for SmallLandscapeTexture!
        this.addTexture(new SmallLandscapeTexture(L, type2, 0, row));
        this.addTexture(new SmallLandscapeTexture(L, type3, 1, row));

        this.addTexture(new Hexagon2Texture(L, type1, type2, 2, row, 2, row + 1));
        this.addTexture(new Hexagon2Texture(L, type2, type1, 3, row, 3, row + 1));

        // empty: @ 0, row + 1
        // empty: @ 1, row + 1
        // variation: Hexagon2Texture(type1, type2, 2, row + 1)
        // variation: Hexagon2Texture(type2, type1, 3, row + 1)

        // next row
        this.addTexture(new Hexagon2Texture(L, type2, type3, 0, row + 2, 0, row + 3));
        this.addTexture(new Hexagon2Texture(L, type3, type2, 1, row + 2, 1, row + 3));
        this.addTexture(new Hexagon2Texture(L, type3, type4, 2, row + 2, 2, row + 3));
        this.addTexture(new Hexagon2Texture(L, type4, type3, 3, row + 2, 3, row + 3));

        // next row
        // variation: Hexagon2Texture(type2, type3, 0, row + 3)
        // variation: Hexagon2Texture(type3, type2, 1, row + 3)
        // variation: Hexagon2Texture(type3, type4, 2, row + 3)
        // variation: Hexagon2Texture(type4, type3, 3, row + 3)
    }

    /**
     * Shared gradient for types that differ only in the first-row pair order.
     * swapFirstPair=false: first pair is (type4,type3) then (type3,type4) (formerly addTextureGradient2)
     * swapFirstPair=true:  first pair is (type3,type4) then (type4,type3) (formerly addTextureGradient3)
     */
    private addTextureGradientReverse(type1: LandscapeType, type2: LandscapeType, type3: LandscapeType, type4: LandscapeType, row: number, swapFirstPair: boolean) {
        const L = this.layout;
        const firstA = swapFirstPair ? type3 : type4;
        const firstB = swapFirstPair ? type4 : type3;

        // Using Hexagon2Texture for SmallLandscapeTexture!
        this.addTexture(new SmallLandscapeTexture(L, type2, 0, row)); /// todo: add variation
        this.addTexture(new SmallLandscapeTexture(L, type3, 1, row)); /// todo: add variation

        this.addTexture(new Hexagon2Texture(L, firstA, firstB, 2, row, 2, row + 1));
        this.addTexture(new Hexagon2Texture(L, firstB, firstA, 3, row, 3, row + 1));

        // empty: @ 0, row + 1
        // empty: @ 1, row + 1
        // variation: Hexagon2Texture(firstA, firstB, 2, row + 1)
        // variation: Hexagon2Texture(firstB, firstA, 3, row + 1)

        // next row
        this.addTexture(new Hexagon2Texture(L, type2, type3, 0, row + 2, 0, row + 3));
        this.addTexture(new Hexagon2Texture(L, type3, type2, 1, row + 2, 1, row + 3));
        this.addTexture(new Hexagon2Texture(L, type1, type2, 2, row + 2, 2, row + 3));
        this.addTexture(new Hexagon2Texture(L, type2, type1, 3, row + 2, 3, row + 3));

        // next row
        // variation: Hexagon2Texture(type2, type3, 0, row + 3)
        // variation: Hexagon2Texture(type3, type2, 1, row + 3)
        // variation: Hexagon2Texture(type1, type2, 2, row + 3)
        // variation: Hexagon2Texture(type2, type1, 3, row + 3)
    }

    constructor() {
        const L = this.layout;

        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Grass, 0));
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.GrassDark, 4));
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.GrassDry, 8));

        // next row
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Grass, LandscapeType.GrassToGrassDry, 0, 12, 0, 13));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.GrassToGrassDry, LandscapeType.Grass, 1, 12, 1, 13));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Beach, LandscapeType.Grass, 2, 12, 2, 13));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Grass, LandscapeType.Beach, 3, 12, 3, 13));

        // variation: Hexagon2Texture(LandscapeType.Grass, LandscapeType.GrassToGrassDry, 0, 13)
        // variation: Hexagon2Texture(LandscapeType.GrassToGrassDry, LandscapeType.Grass, 1, 13)
        // variation: Hexagon2Texture(LandscapeType.Beach, LandscapeType.Grass, 2, 13)
        // variation: Hexagon2Texture(LandscapeType.Grass, LandscapeType.Beach, 3, 13)

        // next row
        this.addTexture(new Hexagon2Texture(L, LandscapeType.GrassToGrassDry, LandscapeType.GrassDry, 0, 14, 0, 15));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.GrassDry, LandscapeType.GrassToGrassDry, 1, 14, 1, 15));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.GrassDark, LandscapeType.Grass, 0, 14, 0, 15));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Grass, LandscapeType.GrassDark, 1, 14, 1, 15));

        // variation: Hexagon2Texture(LandscapeType.GrassToGrassDry, LandscapeType.GrassDry, 0, 15)
        // variation: Hexagon2Texture(LandscapeType.GrassDry, LandscapeType.GrassToGrassDry, 1, 15)
        // variation: Hexagon2Texture(LandscapeType.GrassDark, LandscapeType.Grass, 0, 15)
        // variation: Hexagon2Texture(LandscapeType.Grass, LandscapeType.GrassDark, 1, 15)

        // next row
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Water7, 16));

        // next row
        this.addTexture(new SmallLandscapeTexture(L, LandscapeType.Water0, 0, 20));
        this.addTexture(new SmallLandscapeTexture(L, LandscapeType.Water1, 1, 20));
        this.addTexture(new SmallLandscapeTexture(L, LandscapeType.Water2, 2, 20));
        this.addTexture(new SmallLandscapeTexture(L, LandscapeType.Water3, 3, 20));

        // next row
        this.addTexture(new SmallLandscapeTexture(L, LandscapeType.Water4, 0, 21));
        this.addTexture(new SmallLandscapeTexture(L, LandscapeType.Water5, 1, 21));
        this.addTexture(new SmallLandscapeTexture(L, LandscapeType.Water6, 2, 21));
        // variation: SmallLandscapeTexture(LandscapeType.Water7, 3, 21) // not sure why this exists

        // [beach] --> [water]
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Beach, LandscapeType.Water0, 0, 22, 0, 23));
        // variation: Hexagon2Texture(LandscapeType.Beach, LandscapeType.Water0, 0, 23)
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water0, LandscapeType.Beach, 1, 22, 1, 23));
        // variation: Hexagon2Texture(LandscapeType.Water0, LandscapeType.Beach, 1, 23)

        this.addTexture(new Hexagon3Texture(L, LandscapeType.Beach, LandscapeType.Grass, LandscapeType.Water0, 2, 22, 3, 22));
        // variation: Hexagon3Texture(LandscapeType.Beach, LandscapeType.Grass, LandscapeType.Water0, 3, 22)

        this.addTexture(new Hexagon3Texture(L, LandscapeType.Grass, LandscapeType.Beach, LandscapeType.Water0, 2, 23, 3, 23));
        // variation: Hexagon3Texture(LandscapeType.Grass, LandscapeType.Beach, LandscapeType.Water0, 3, 23)

        // next row
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water0, LandscapeType.Water1, 0, 24));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water1, LandscapeType.Water2, 1, 24));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water2, LandscapeType.Water3, 2, 24));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water3, LandscapeType.Water4, 3, 24));

        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water1, LandscapeType.Water0, 0, 25));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water2, LandscapeType.Water1, 1, 25));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water3, LandscapeType.Water2, 2, 25));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water4, LandscapeType.Water3, 3, 25));

        // next row
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water4, LandscapeType.Water5, 0, 26));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water5, LandscapeType.Water6, 1, 26));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water6, LandscapeType.Water7, 2, 26));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water7, LandscapeType.Water8, 3, 26));

        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water5, LandscapeType.Water4, 0, 27));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water6, LandscapeType.Water5, 1, 27));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water7, LandscapeType.Water6, 2, 27));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Water8, LandscapeType.Water7, 3, 27));

        // next row
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Beach, 28));
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Rock, 32));

        // next row
        // [grass] 16 -> 17 -> 33 -> 32 [rock] @ 36..39
        this.addTextureGradient1(LandscapeType.Grass, LandscapeType.RockToGras2, LandscapeType.RockToGras1, LandscapeType.Rock, 36);

        // next row
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Desert, 40));

        // https://github.com/tomsoftware/sied3/blob/master/src/clTexturesLoadHelper.cpp
        // [grass] 16 -> 20 -> 65 -> 64 [desert] @ 44..47
        this.addTextureGradientReverse(LandscapeType.Grass, LandscapeType.DesertToGras2, LandscapeType.DesertToGras1, LandscapeType.Desert, 44, true);

        // ///////
        // [mud] 80 -> 81 -> 21 -> 16 [gras] @ 48..51
        this.addTextureGradientReverse(LandscapeType.Grass, LandscapeType.MudToGras2, LandscapeType.MudToGras1, LandscapeType.Mud, 48, false);

        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Mud, 52));

        // ///////
        // [swamp] 80 -> 81 -> 21 -> 16 [gras] @ 56..59
        this.addTextureGradient1(LandscapeType.Grass, LandscapeType.SwampToGras2, LandscapeType.SwampToGras1, LandscapeType.Swamp, 56);

        // next row
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Swamp, 60));

        // ///////
        // [rock] 32 -> 35 -> 129 -> 128 [ice] @ 64..67
        this.addTextureGradient1(LandscapeType.Rock, LandscapeType.SnowToRock2, LandscapeType.SnowToRock1, LandscapeType.Snow, 64);

        // next row
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.Snow, 68));

        // [grass] 16 -> 99 -> 98 -> 96 [river] @ 72..75
        // 3 atlas slots: A=(2,72), B=(0,74), C=(2,74)
        {
            this.addTexture(new SmallLandscapeTexture(L, LandscapeType.River4, 0, 72));
            this.addTexture(new SmallLandscapeTexture(L, LandscapeType.River3, 1, 72));
            // River1 and River2 have no dedicated atlas slots in the texture
            // file — reuse River3's position so they render as river instead
            // of falling through to grass via findFallback.
            this.addTexture(new SmallLandscapeTexture(L, LandscapeType.River1, 1, 72));
            this.addTexture(new SmallLandscapeTexture(L, LandscapeType.River2, 1, 72));

            // Create Hexagon2Textures at fixed source positions (default config).
            // After copyTexture() the shared layout holds correct GPU atlas dest positions.
            // Layout matches addTextureGradientReverse(Grass, River4, River3, River1, 72):
            //   River4=99 (outermost, near grass), River1=96 (innermost, river center)
            // Slot A: cols 2-3, rows 72-73 → River3↔River1 (inner edge, water-heavy)
            const slotALeft = new Hexagon2Texture(L, LandscapeType.River3, LandscapeType.River1, 2, 72, 2, 73);
            const slotARight = new Hexagon2Texture(L, LandscapeType.River1, LandscapeType.River3, 3, 72, 3, 73);
            // Slot B: cols 0-1, rows 74-75 → River4↔River3 (middle)
            const slotBLeft = new Hexagon2Texture(L, LandscapeType.River4, LandscapeType.River3, 0, 74, 0, 75);
            const slotBRight = new Hexagon2Texture(L, LandscapeType.River3, LandscapeType.River4, 1, 74, 1, 75);
            // Slot C: cols 2-3, rows 74-75 → Grass↔River4 (outer edge, grass-heavy)
            const slotCLeft = new Hexagon2Texture(L, LandscapeType.Grass, LandscapeType.River4, 2, 74, 2, 75);
            const slotCRight = new Hexagon2Texture(L, LandscapeType.River4, LandscapeType.Grass, 3, 74, 3, 75);

            const allSlots = [slotALeft, slotARight, slotBLeft, slotBRight, slotCLeft, slotCRight];
            for (const tex of allSlots) {
                this.addTexture(tex);
            }

            // Store slot references for updateRiverConfig and track their lookup keys
            this.riverSlots = { slotALeft, slotARight, slotBLeft, slotBRight, slotCLeft, slotCRight };
            for (const tex of allSlots) {
                for (const p of tex.getPattern()) {
                    this.riverHexKeys.push(p.getKey());
                }
            }
        }

        // todo: next row (?? <-> gras) 76..79

        this.addTexture(new Hexagon2Texture(L, LandscapeType.DustyWay, LandscapeType.Grass, 0, 76, 0, 77));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Grass, LandscapeType.DustyWay, 1, 76, 1, 77));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.RockyWay, LandscapeType.Grass, 2, 76, 2, 77));
        this.addTexture(new Hexagon2Texture(L, LandscapeType.Grass, LandscapeType.RockyWay, 3, 76, 3, 77));

        // variation: Hexagon2Texture(LandscapeType.DustyWay, LandscapeType.Grass, 0, 77));
        // variation: Hexagon2Texture(LandscapeType.Grass, LandscapeType.DustyWay, 1, 77));
        // variation: Hexagon2Texture(LandscapeType.RockyWay, LandscapeType.Grass, 2, 77));
        // variation: Hexagon2Texture(LandscapeType.Grass, LandscapeType.RockyWay, 3, 77));
        // empty @ 78
        // empty @ 79

        this.addTexture(new BigLandscapeTexture(L, LandscapeType.DustyWay, 80));
        this.addTexture(new BigLandscapeTexture(L, LandscapeType.RockyWay, 84));

        Object.seal(this);
    }

    /** Update river transition lookup entries without creating a new map.
     *  New texture objects share the same AtlasLayout, so they resolve to
     *  the correct atlas dest positions automatically. */
    public updateRiverConfig(rc: RiverConfig): void {
        if (!this.riverSlots) return;

        // Remove old river Hex2 entries from lookup
        for (const key of this.riverHexKeys) {
            delete this.lookup[key];
        }
        this.riverHexKeys = [];

        // Resolve physical slot pairs by letter
        const slotPairs: Record<RiverSlotId, { left: Hexagon2Texture; right: Hexagon2Texture }> = {
            A: { left: this.riverSlots.slotALeft, right: this.riverSlots.slotARight },
            B: { left: this.riverSlots.slotBLeft, right: this.riverSlots.slotBRight },
            C: { left: this.riverSlots.slotCLeft, right: this.riverSlots.slotCRight },
        };

        const perm = RIVER_SLOT_PERMS[rc.slotPermutation % RIVER_SLOT_PERMS.length];
        const innerPair  = slotPairs[perm[0]];
        const outerPair  = slotPairs[perm[1]];
        const middlePair = slotPairs[perm[2]];

        // Apply left/right flips per role
        const iLeft  = rc.flipInner ? innerPair.right  : innerPair.left;
        const iRight = rc.flipInner ? innerPair.left   : innerPair.right;
        const oLeft  = rc.flipOuter ? outerPair.right  : outerPair.left;
        const oRight = rc.flipOuter ? outerPair.left   : outerPair.right;
        const mLeft  = rc.flipMiddle ? middlePair.right : middlePair.left;
        const mRight = rc.flipMiddle ? middlePair.left  : middlePair.right;

        // Create new Hex2 objects with correct type assignments.
        // The shared layout already maps their src positions → atlas dest positions.
        // Gradient: Grass(16) → River4(99) → River3(98) → River1(96)
        const newTextures = [
            iLeft.withTypes(LandscapeType.River3, LandscapeType.River1),
            iRight.withTypes(LandscapeType.River1, LandscapeType.River3),
            oLeft.withTypes(LandscapeType.Grass, LandscapeType.River4),
            oRight.withTypes(LandscapeType.River4, LandscapeType.Grass),
            mLeft.withTypes(LandscapeType.River4, LandscapeType.River3),
            mRight.withTypes(LandscapeType.River3, LandscapeType.River4),
        ];

        for (const tex of newTextures) {
            for (const p of tex.getPattern()) {
                const key = p.getKey();
                this.lookup[key] = tex;
                this.riverHexKeys.push(key);
            }
        }
    }

    /** Find a fallback texture by trying uniform types for each corner. */
    private findFallback(t1: LandscapeType, t2: LandscapeType, t3: LandscapeType): ILandscapeTexture | null {
        // For river transitions, try to find the closest available texture.
        // Map data often has Grass directly touching River3/River2/River1 without
        // the intermediate River4 step. Use Grass↔River4 as a visual approximation.
        const types = [t1, t2, t3];
        const hasGrass = types.includes(LandscapeType.Grass);
        const riverTypes = types.filter(t =>
            t === LandscapeType.River1 || t === LandscapeType.River2 ||
            t === LandscapeType.River3 || t === LandscapeType.River4
        );

        if (hasGrass && riverTypes.length > 0) {
            // Substitute any river type with River4 for lookup purposes
            const substituted = types.map(t =>
                (t === LandscapeType.River1 || t === LandscapeType.River2 || t === LandscapeType.River3)
                    ? LandscapeType.River4
                    : t
            ) as [LandscapeType, LandscapeType, LandscapeType];

            const subKey = new TexturePoint(substituted[0], substituted[1], substituted[2]).getKey();
            const subText = this.lookup[subKey];
            if (subText) {
                return subText;
            }
        }

        // Original fallback: try uniform textures for each corner
        for (const t of types) {
            const key = new TexturePoint(t, t, t).getKey();
            const text = this.lookup[key];
            if (text) {
                return text;
            }
        }
        return null;
    }

    public getTextureA(t1: LandscapeType, t2: LandscapeType, t3: LandscapeType, x: number, y: number): [number, number] {
        const tp = new TexturePoint(t1, t2, t3);
        const text = this.lookup[tp.getKey()] ?? this.findFallback(t1, t2, t3);
        if (!text) {
            return [0, 0];
        }

        return text.getTextureA(tp, x, y);
    }

    public getTextureB(t4: LandscapeType, t5: LandscapeType, t6: LandscapeType, x: number, y: number): [number, number] {
        const tp = new TexturePoint(t4, t5, t6);
        const text = this.lookup[tp.getKey()] ?? this.findFallback(t4, t5, t6);
        if (!text) {
            return [0, 0];
        }

        return text.getTextureB(tp, x, y);
    }

    /** copy all textures to the TextureMap */
    public copyTexture(srcImg: GfxImage16Bit, destTextureMap: TextureMap16Bit): void {
        for (const t of this.textures) {
            t.copyToTextureMap(srcImg, destTextureMap);
        }
    }
}
