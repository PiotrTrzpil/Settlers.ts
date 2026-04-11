/**
 * MapObjectType → XML object ID mapping table.
 *
 * Extracted from game-data-access.ts to keep the main module under the line limit.
 * This is purely a lookup table with no logic.
 */

import { MapObjectType } from '../types/map-object-types';

/**
 * MapObjectType → XML object ID from objectInfo.xml.
 *
 * NOTE: Tree→TREE## mapping is assumed (TREE01=Oak, TREE02=Beech, ...) and needs
 * verification against actual sprite data. "A" variant is used as primary.
 */
export const MAP_OBJECT_TYPE_TO_XML_ID: Partial<Record<MapObjectType, string>> = {
    // ---- Trees — assumed 1:1 with TREE## numbering (TODO: verify) ----
    [MapObjectType.TreeOak]: 'OBJECT_TREE01A',
    [MapObjectType.TreeBeech]: 'OBJECT_TREE02A',
    [MapObjectType.TreeAsh]: 'OBJECT_TREE03A',
    [MapObjectType.TreeLinden]: 'OBJECT_TREE04A',
    [MapObjectType.TreeBirch]: 'OBJECT_TREE05A',
    [MapObjectType.TreePoplar]: 'OBJECT_TREE06A',
    [MapObjectType.TreeChestnut]: 'OBJECT_TREE07A',
    [MapObjectType.TreeMaple]: 'OBJECT_TREE07B',
    [MapObjectType.TreeFir]: 'OBJECT_TREE08A',
    [MapObjectType.TreeSpruce]: 'OBJECT_TREE08B',
    [MapObjectType.TreeCoconut]: 'OBJECT_TREE09A',
    [MapObjectType.TreeDate]: 'OBJECT_TREE09B',
    [MapObjectType.TreeWalnut]: 'OBJECT_TREE10A',
    [MapObjectType.TreeCorkOak]: 'OBJECT_TREE10B',
    [MapObjectType.TreePine]: 'OBJECT_TREE11A',
    [MapObjectType.TreePine2]: 'OBJECT_TREE11B',
    [MapObjectType.TreeOliveLarge]: 'OBJECT_TREE06B', // TODO: verify — olives might be separate
    [MapObjectType.TreeOliveSmall]: 'OBJECT_TREE05B', // TODO: verify

    // ---- Dark Tribe trees ----
    [MapObjectType.DarkTree1A]: 'OBJECT_DARKTREE01A',
    [MapObjectType.DarkTree1B]: 'OBJECT_DARKTREE01B',
    [MapObjectType.DarkTree2A]: 'OBJECT_DARKTREE02A',
    [MapObjectType.DarkTree2B]: 'OBJECT_DARKTREE02B',
    [MapObjectType.DarkTree3A]: 'OBJECT_DARKTREE03A',
    [MapObjectType.DarkTree3B]: 'OBJECT_DARKTREE03B',
    [MapObjectType.DarkTree4A]: 'OBJECT_DARKTREE04A',
    [MapObjectType.DarkTree5A]: 'OBJECT_DARKTREE05A',

    // ---- Resources — harvestable stone (12 depletion levels, all blocking=2 in XML) ----
    [MapObjectType.ResourceStone1]: 'OBJECT_STONEMINE1_11',
    [MapObjectType.ResourceStone2]: 'OBJECT_STONEMINE1_10',
    [MapObjectType.ResourceStone3]: 'OBJECT_STONEMINE1_09',
    [MapObjectType.ResourceStone4]: 'OBJECT_STONEMINE1_08',
    [MapObjectType.ResourceStone5]: 'OBJECT_STONEMINE1_07',
    [MapObjectType.ResourceStone6]: 'OBJECT_STONEMINE1_06',
    [MapObjectType.ResourceStone7]: 'OBJECT_STONEMINE1_05',
    [MapObjectType.ResourceStone8]: 'OBJECT_STONEMINE1_04',
    [MapObjectType.ResourceStone9]: 'OBJECT_STONEMINE1_03',
    [MapObjectType.ResourceStone10]: 'OBJECT_STONEMINE1_02',
    [MapObjectType.ResourceStone11]: 'OBJECT_STONEMINE1_01',
    [MapObjectType.ResourceStone12]: 'OBJECT_STONEMINE1_00',
    [MapObjectType.ResourceDarkStone]: 'OBJECT_DARKSTONEMINE1_00',

    // ---- Crops ----
    [MapObjectType.Grain]: 'OBJECT_WHEAT1',
    [MapObjectType.Sunflower]: 'OBJECT_SUNFLOWER',
    [MapObjectType.Agave]: 'OBJECT_AGAVE',
    [MapObjectType.Beehive]: 'OBJECT_HIVE',
    [MapObjectType.Grape]: 'OBJECT_GRAPE',
    [MapObjectType.Wheat2]: 'OBJECT_WHEAT2',

    // ---- Bushes ----
    [MapObjectType.Bush1]: 'OBJECT_BUSH1',
    [MapObjectType.Bush2]: 'OBJECT_BUSH2',
    [MapObjectType.Bush3]: 'OBJECT_BUSH3',
    [MapObjectType.Bush4]: 'OBJECT_BUSH4',
    [MapObjectType.DarkBush1]: 'OBJECT_DARKBUSH1',
    [MapObjectType.DarkBush2]: 'OBJECT_DARKBUSH2',
    [MapObjectType.DarkBush3]: 'OBJECT_DARKBUSH3',
    [MapObjectType.DarkBush4]: 'OBJECT_DARKBUSH4',
    [MapObjectType.DesertBush1]: 'OBJECT_DESERTBUSH1',
    [MapObjectType.DesertBush2]: 'OBJECT_DESERTBUSH2',
    [MapObjectType.DesertBush3]: 'OBJECT_DESERTBUSH3',

    // ---- Ground cover — Flowers ----
    [MapObjectType.Flower3]: 'OBJECT_FLOWER3',
    [MapObjectType.Flower4]: 'OBJECT_FLOWER4',
    [MapObjectType.Flower5]: 'OBJECT_FLOWER5',
    [MapObjectType.SpecialFlower]: 'OBJECT_SPECIAL_FLOWER',

    // ---- Ground cover — Grass ----
    [MapObjectType.Grass1]: 'OBJECT_GRASS1',
    [MapObjectType.Grass2]: 'OBJECT_GRASS2',
    [MapObjectType.Grass3]: 'OBJECT_GRASS3',
    [MapObjectType.Grass4]: 'OBJECT_GRASS4',
    [MapObjectType.Grass5]: 'OBJECT_GRASS5',
    [MapObjectType.Grass6]: 'OBJECT_GRASS6',
    [MapObjectType.Grass7]: 'OBJECT_GRASS7',
    [MapObjectType.Grass8]: 'OBJECT_GRASS8',
    [MapObjectType.Grass9]: 'OBJECT_GRASS9',
    [MapObjectType.Grass10]: 'OBJECT_GRASS10',

    // ---- Ground cover — Foliage & Branches ----
    [MapObjectType.Foliage2]: 'OBJECT_FOLIAGE2',
    [MapObjectType.Foliage3]: 'OBJECT_FOLIAGE3',
    [MapObjectType.Branch1]: 'OBJECT_BRANCH1',
    [MapObjectType.Branch2]: 'OBJECT_BRANCH2',
    [MapObjectType.Branch3]: 'OBJECT_BRANCH3',
    [MapObjectType.Branch4]: 'OBJECT_BRANCH4',

    // ---- Desert plants ----
    [MapObjectType.Cactus1]: 'OBJECT_CACTUS1',
    [MapObjectType.Cactus2]: 'OBJECT_CACTUS2',
    [MapObjectType.Cactus3]: 'OBJECT_CACTUS3',
    [MapObjectType.Cactus4]: 'OBJECT_CACTUS4',

    // ---- Water vegetation ----
    [MapObjectType.Reed1]: 'OBJECT_REED1',
    [MapObjectType.Reed2]: 'OBJECT_REED2',
    [MapObjectType.Reed3]: 'OBJECT_REED3',
    [MapObjectType.Seaweed1]: 'OBJECT_SEEWEED1', // Note: XML spells it "SEEWEED"
    [MapObjectType.Seaweed2]: 'OBJECT_SEEWEED2',
    [MapObjectType.Seaweed3]: 'OBJECT_SEEWEED3',
    [MapObjectType.WaterLily1]: 'OBJECT_WATERLILY1',
    [MapObjectType.WaterLily2]: 'OBJECT_WATERLILY2',
    [MapObjectType.WaterLily3]: 'OBJECT_WATERLILY3',

    // ---- Mushrooms ----
    [MapObjectType.Mushroom1]: 'OBJECT_MUSHROOM1',
    [MapObjectType.Mushroom2]: 'OBJECT_MUSHROOM2',
    [MapObjectType.Mushroom3]: 'OBJECT_MUSHROOM3',
    [MapObjectType.MushroomDark1]: 'OBJECT_MUSHROOM_DARK1',
    [MapObjectType.MushroomDark2]: 'OBJECT_MUSHROOM_DARK2',
    [MapObjectType.MushroomDark3]: 'OBJECT_MUSHROOM_DARK3',
    [MapObjectType.EvilMushroom1]: 'OBJECT_EVILMUSHROOM1',
    [MapObjectType.EvilMushroom2]: 'OBJECT_EVILMUSHROOM2',
    [MapObjectType.EvilMushroom3]: 'OBJECT_EVILMUSHROOM3',
    [MapObjectType.MushroomCycle]: 'OBJECT_MUSHROOMCYCLE',

    // ---- Decorative stones — Brownish ----
    [MapObjectType.StoneBrownish1]: 'OBJECT_STONEBROWNISH1',
    [MapObjectType.StoneBrownish2]: 'OBJECT_STONEBROWNISH2',
    [MapObjectType.StoneBrownish3]: 'OBJECT_STONEBROWNISH3',
    [MapObjectType.StoneBrownish4]: 'OBJECT_STONEBROWNISH4',
    [MapObjectType.StoneBrownish5]: 'OBJECT_STONEBROWNISH5',
    [MapObjectType.StoneBrownish6]: 'OBJECT_STONEBROWNISH6',
    [MapObjectType.StoneBrownish7]: 'OBJECT_STONEBROWNISH7',
    [MapObjectType.StoneBrownish8]: 'OBJECT_STONEBROWNISH8',
    [MapObjectType.StoneBrownish9]: 'OBJECT_STONEBROWNISH9',
    [MapObjectType.StoneBrownish10]: 'OBJECT_STONEBROWNISH10',

    // ---- Decorative stones — Darkish ----
    [MapObjectType.StoneDarkish1]: 'OBJECT_STONEDARKISH1',
    [MapObjectType.StoneDarkish2]: 'OBJECT_STONEDARKISH2',
    [MapObjectType.StoneDarkish3]: 'OBJECT_STONEDARKISH3',
    [MapObjectType.StoneDarkish4]: 'OBJECT_STONEDARKISH4',
    [MapObjectType.StoneDarkish5]: 'OBJECT_STONEDARKISH5',
    [MapObjectType.StoneDarkish6]: 'OBJECT_STONEDARKISH6',
    [MapObjectType.StoneDarkish7]: 'OBJECT_STONEDARKISH7',
    [MapObjectType.StoneDarkish8]: 'OBJECT_STONEDARKISH8',
    [MapObjectType.StoneDarkish9]: 'OBJECT_STONEDARKISH9',
    [MapObjectType.StoneDarkish10]: 'OBJECT_STONEDARKISH10',

    // ---- Decorative stones — Darkish B ----
    [MapObjectType.StoneDarkishB1]: 'OBJECT_STONEDARKISH_B01',
    [MapObjectType.StoneDarkishB2]: 'OBJECT_STONEDARKISH_B02',
    [MapObjectType.StoneDarkishB3]: 'OBJECT_STONEDARKISH_B03',
    [MapObjectType.StoneDarkishB4]: 'OBJECT_STONEDARKISH_B04',
    [MapObjectType.StoneDarkishB5]: 'OBJECT_STONEDARKISH_B05',
    [MapObjectType.StoneDarkishB6]: 'OBJECT_STONEDARKISH_B06',
    [MapObjectType.StoneDarkishB7]: 'OBJECT_STONEDARKISH_B07',
    [MapObjectType.StoneDarkishB8]: 'OBJECT_STONEDARKISH_B08',
    [MapObjectType.StoneDarkishB9]: 'OBJECT_STONEDARKISH_B09',
    [MapObjectType.StoneDarkishB10]: 'OBJECT_STONEDARKISH_B10',

    // ---- Decorative stones — Darkish G ----
    [MapObjectType.StoneDarkishG1]: 'OBJECT_STONEDARKISH_G01',
    [MapObjectType.StoneDarkishG2]: 'OBJECT_STONEDARKISH_G02',
    [MapObjectType.StoneDarkishG3]: 'OBJECT_STONEDARKISH_G03',
    [MapObjectType.StoneDarkishG4]: 'OBJECT_STONEDARKISH_G04',
    [MapObjectType.StoneDarkishG5]: 'OBJECT_STONEDARKISH_G05',
    [MapObjectType.StoneDarkishG6]: 'OBJECT_STONEDARKISH_G06',
    [MapObjectType.StoneDarkishG7]: 'OBJECT_STONEDARKISH_G07',
    [MapObjectType.StoneDarkishG8]: 'OBJECT_STONEDARKISH_G08',
    [MapObjectType.StoneDarkishG9]: 'OBJECT_STONEDARKISH_G09',
    [MapObjectType.StoneDarkishG10]: 'OBJECT_STONEDARKISH_G10',

    // ---- Decorative stones — Greyish ----
    [MapObjectType.StoneGreyish1]: 'OBJECT_STONEGREYISH1',
    [MapObjectType.StoneGreyish2]: 'OBJECT_STONEGREYISH2',
    [MapObjectType.StoneGreyish3]: 'OBJECT_STONEGREYISH3',
    [MapObjectType.StoneGreyish4]: 'OBJECT_STONEGREYISH4',
    [MapObjectType.StoneGreyish5]: 'OBJECT_STONEGREYISH5',
    [MapObjectType.StoneGreyish6]: 'OBJECT_STONEGREYISH6',
    [MapObjectType.StoneGreyish7]: 'OBJECT_STONEGREYISH7',
    [MapObjectType.StoneGreyish8]: 'OBJECT_STONEGREYISH8',
    [MapObjectType.StoneGreyish9]: 'OBJECT_STONEGREYISH9',
    [MapObjectType.StoneGreyish10]: 'OBJECT_STONEGREYISH10',

    // ---- Water features ----
    [MapObjectType.Pond]: 'OBJECT_POND',
    [MapObjectType.DarkPond]: 'OBJECT_DARKPOND',

    // ---- Waves ----
    [MapObjectType.Wave]: 'OBJECT_WAVE96X63',
    [MapObjectType.WaveLake1]: 'OBJECT_WAVE_LAKE24X12',
    [MapObjectType.WaveLake2]: 'OBJECT_WAVE_LAKE28X22',
    [MapObjectType.WaveLake3]: 'OBJECT_WAVE_LAKE37X19',
    [MapObjectType.WaveLake4]: 'OBJECT_WAVE_LAKE40X24',
    [MapObjectType.WaveLake5]: 'OBJECT_WAVE_LAKE48X19',
    [MapObjectType.WaveLake6]: 'OBJECT_WAVE_LAKE49X18',
    [MapObjectType.WaveLake7]: 'OBJECT_WAVE_LAKE51X29',

    // ---- Misc objects ----
    [MapObjectType.Well]: 'OBJECT_WELL',
    [MapObjectType.Scarecrow]: 'OBJECT_SCARECROW',
    [MapObjectType.Snowman]: 'OBJECT_SNOWMAN',
    [MapObjectType.DarkSnowman]: 'OBJECT_DARKSNOWMAN',
    [MapObjectType.Flag]: 'OBJECT_FLAG',
    [MapObjectType.Grave1]: 'OBJECT_GRAVE1',
    [MapObjectType.Grave2]: 'OBJECT_GRAVE2',
    [MapObjectType.RuneStone]: 'OBJECT_RUNESTONE',
    [MapObjectType.CelticCross]: 'OBJECT_CELTICCROSS',
    [MapObjectType.PalmPlant]: 'OBJECT_PALMPLANT',
    [MapObjectType.ShadowHerb]: 'OBJECT_SHADOWHERB',
    [MapObjectType.Wreck]: 'OBJECT_WRECK1',
    [MapObjectType.DarkRope]: 'OBJECT_DARKROPE1',
    [MapObjectType.DarkSpitter]: 'OBJECT_DARKSPITTER',
    [MapObjectType.Boundary]: 'OBJECT_BOUNDARY',
    [MapObjectType.BaseMorbus]: 'OBJECT_BASE_MORBUS',
    [MapObjectType.WaggonDestroyed]: 'OBJECT_WAGGONDESTR',
    [MapObjectType.Reeve1]: 'OBJECT_REEVE1',
    [MapObjectType.Reeve2]: 'OBJECT_REEVE2',
    [MapObjectType.Reeve3]: 'OBJECT_REEVE3',
    [MapObjectType.Reeve4]: 'OBJECT_REEVE4',
    [MapObjectType.SkeletonDesert1]: 'OBJECT_SKELETONDESERT1',
    [MapObjectType.SkeletonDesert2]: 'OBJECT_SKELETONDESERT2',
    [MapObjectType.Mussel1]: 'OBJECT_MUSSEL1',
    [MapObjectType.Mussel2]: 'OBJECT_MUSSEL2',

    // ---- Resource indicators ----
    [MapObjectType.ResCoal]: 'OBJECT_RESCOAL',
    [MapObjectType.ResFish]: 'OBJECT_RESFISH',
    [MapObjectType.ResGold]: 'OBJECT_RESGOLD',
    [MapObjectType.ResIron]: 'OBJECT_RESIRON',
    [MapObjectType.ResStone]: 'OBJECT_RESSTONE',
    [MapObjectType.ResSulfur]: 'OBJECT_RESSULFUR',

    // ---- Mine decorations ----
    [MapObjectType.MineSet1]: 'OBJECT_MINESET1',
    [MapObjectType.MineSet2]: 'OBJECT_MINESET2',
    [MapObjectType.DarkMineSet1]: 'OBJECT_DARKMINESET1',
    [MapObjectType.DarkMineSet2]: 'OBJECT_DARKMINESET2',

    // ---- Wonders / Large structures ----
    [MapObjectType.WonderCastle]: 'OBJECT_CASTLE',
    [MapObjectType.WonderColossus]: 'OBJECT_COLOSSUS',
    [MapObjectType.WonderGate]: 'OBJECT_GATE',
    [MapObjectType.WonderPharos]: 'OBJECT_PHAROS',
    [MapObjectType.Moai01]: 'OBJECT_MOAI01',
    [MapObjectType.Moai02]: 'OBJECT_MOAI02',
    [MapObjectType.WonderAlchemist]: 'OBJECT_ALCHEMIST',
    [MapObjectType.Ruin]: 'OBJECT_RUIN1',

    // ---- Trojan horse ----
    [MapObjectType.TrojanHorseBuild]: 'OBJECT_TROJANHORSE_BUILD',
    [MapObjectType.TrojanHorseStandard]: 'OBJECT_TROJANHORSE_STANDARD',
    [MapObjectType.TrojanHorseDestroyed]: 'OBJECT_TROJANHORSEDESTR',

    // ---- Column ruins ----
    [MapObjectType.ColumnRuinsA1]: 'OBJECT_COLUMNRUINS_A1',
    [MapObjectType.ColumnRuinsA2]: 'OBJECT_COLUMNRUINS_A2',
    [MapObjectType.ColumnRuinsE1]: 'OBJECT_COLUMNRUINS_E1',
    [MapObjectType.ColumnRuinsE2]: 'OBJECT_COLUMNRUINS_E2',
    [MapObjectType.ColumnRuinsE3]: 'OBJECT_COLUMNRUINS_E3',
    [MapObjectType.ColumnRuinsE4]: 'OBJECT_COLUMNRUINS_E4',
    [MapObjectType.ColumnRuinsS1]: 'OBJECT_COLUMNRUINS_S1',
    [MapObjectType.ColumnRuinsS2]: 'OBJECT_COLUMNRUINS_S2',
    [MapObjectType.ColumnRuinsS3]: 'OBJECT_COLUMNRUINS_S3',
    [MapObjectType.ColumnRuinsW1]: 'OBJECT_COLUMNRUINS_W1',
    [MapObjectType.ColumnRuinsW2]: 'OBJECT_COLUMNRUINS_W2',
    [MapObjectType.ColumnRuinsW3]: 'OBJECT_COLUMNRUINS_W3',
    [MapObjectType.ColumnRuinsW4]: 'OBJECT_COLUMNRUINS_W4',
};
