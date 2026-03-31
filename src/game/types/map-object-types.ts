/**
 * Map object type definitions.
 * These are natural objects that exist on the map independently of players.
 *
 * CRITICAL: Enum member names MUST correspond 1:1 to OBJECT_* names in objectInfo.xml.
 * Do NOT add entries with made-up names — if the XML identity of a raw byte is unknown,
 * leave it out of the enum (it will be an untyped raw decoration).
 *
 * Every OBJECT_* entry in objectInfo.xml should have a corresponding MapObjectType value.
 * The mapping from MapObjectType -> XML ID lives in map-object-xml-mapping.ts.
 *
 * Enum values 0-255 are RAW BYTE values from the map data (MapObjects chunk).
 * The enum IS the single source of truth: enum value = raw byte, no conversion needed.
 * Types without known raw bytes use values >255 to avoid conflicts.
 */

/**
 * Unified classification for all map objects -- both typed game entities
 * (trees, resources, crops) and raw decoration byte values from map files.
 *
 * Typed entities use: Trees, Resources, Crops
 * Decoration byte values use the terrain-context categories (Stone, Plants, River, etc.)
 * HarvestableStone is the raw-byte classification for ResourceStone entities.
 */
export const enum MapObjectCategory {
    // Typed game object categories
    Trees = 'trees',
    Goods = 'goods',
    Crops = 'crops',
    // Raw decoration / map-byte categories
    HarvestableStone = 'harvestable_stone',
    Stone = 'stone',
    StoneRare = 'stone_rare',
    Plants = 'plants',
    PlantsRare = 'plants_rare',
    River = 'river',
    Lake = 'lake',
    Desert = 'desert',
    DesertRare = 'desert_rare',
    Sea = 'sea',
    Beach = 'beach',
    BeachRare = 'beach_rare',
    Snow = 'snow',
    DarkGround = 'dark_ground',
    DarkGroundRare = 'dark_ground_rare',
    Unknown = 'unknown',
}

/* eslint-disable @typescript-eslint/no-duplicate-enum-values -- TreePalm/TreeCypress are intentional aliases */
export enum MapObjectType {
    // ==== Raw byte values (0-255) — enum value = raw byte from map data ====
    // Ordered by raw byte value. Gaps are untyped raw decorations.

    // ---- Trees (raw 1-18, S4ModApi S4_TREE_ENUM) ----
    TreeOak = 1,
    TreeBeech = 2,
    TreeAsh = 3,
    TreeLinden = 4,
    TreeBirch = 5,
    TreePoplar = 6,
    TreeChestnut = 7,
    TreeMaple = 8,
    TreeFir = 9,
    TreeCypress = 9, // Alias for Fir
    TreeSpruce = 10,
    TreeCoconut = 11,
    TreePalm = 11, // Alias for Coconut
    TreeDate = 12,
    TreeWalnut = 13,
    TreeCorkOak = 14,
    TreePine = 15,
    TreePine2 = 16,
    TreeOliveLarge = 17,
    TreeOliveSmall = 18,

    // ---- Bushes (raw 19-22, 0% dark) ----
    Bush1 = 19,
    Bush2 = 20,
    Bush3 = 21,
    Bush4 = 22,
    // ---- Dark Tribe trees (raw 23-31; 96-98% dark, most common dark objects) ----
    // 9 raw bytes: 6 animated sway types (23-28) + 2 static types (29-30: pine, palm) + 1 shared (31).
    DarkTree1A = 23,
    DarkTree1B = 24,
    DarkTree2A = 25,
    DarkTree2B = 26,
    DarkTree3A = 27,
    DarkTree3B = 28,
    DarkTree4A = 29,
    DarkTree4B = 30,
    DarkTree5A = 31,

    // ---- Reed (raw 43, 77, 78) ----
    Reed1 = 43,

    // ---- Grass (raw 44-49) ----
    Grass1 = 44,
    Grass2 = 45,
    Grass3 = 46,
    Grass4 = 47,
    Grass5 = 48,
    Grass6 = 49,

    // ---- Desert plants (raw 50-54) ----
    DesertBush1 = 50,
    DesertBush2 = 51,
    DesertBush3 = 52,
    Cactus1 = 53,
    SkeletonDesert1 = 54,
    // raw 56-75: mountain/stone decorations (untyped)

    // ---- Grass (raw 76, 81-82, 85) ----
    Grass7 = 76,
    Reed2 = 77,
    Reed3 = 78,
    // raw 79-80: untyped grass decorations
    Grass8 = 81,
    Grass9 = 82,
    Flower3 = 83, // guessed — common grass ground cover
    Flower4 = 84, // guessed — common grass ground cover
    Grass10 = 85,

    // ---- Rare objects (raw 87, 90-92) ----
    MushroomCycle = 87,
    Scarecrow = 90,
    ColumnRuinsA1 = 91,
    ColumnRuinsA2 = 92,

    // ---- Dark-land objects (raw 93, 99-100; guessed from frequency + neighbor analysis) ----
    MushroomDark1 = 93,
    MushroomDark2 = 99,
    MushroomDark3 = 100,
    // raw 101, 103-106, 113-114: untyped dark/plant decorations

    // ---- Sea (raw 107-110) ----
    Seaweed1 = 107,
    Seaweed2 = 108,
    Seaweed3 = 109,
    Wave = 110,

    // ---- Dark bushes (raw 111-112; guessed — most common dark objects) ----
    DarkBush3 = 111,
    DarkBush4 = 112,

    // ---- Rare objects (raw 116) ----
    CelticCross = 116,

    // ---- Cactus variants (raw 120-122) ----
    Cactus2 = 120,
    Cactus3 = 121,
    Cactus4 = 122,

    // ---- Harvestable stone (raw 124-135, 12 depletion levels) ----
    ResourceStone1 = 124, // Nearly depleted
    ResourceStone2 = 125,
    ResourceStone3 = 126,
    ResourceStone4 = 127,
    ResourceStone5 = 128,
    ResourceStone6 = 129,
    ResourceStone7 = 130,
    ResourceStone8 = 131,
    ResourceStone9 = 132,
    ResourceStone10 = 133,
    ResourceStone11 = 134,
    ResourceStone12 = 135, // Full stone
    // raw 136-149: untyped dark/stone/desert decorations

    // ---- Dark pond (raw 150; guessed — very rare, 12 total across 7 maps) ----
    DarkPond = 150,

    // ---- Rare objects (raw 152-159) ----
    Ruin = 152,
    RuneStone = 154,
    Grave1 = 156,
    WaggonDestroyed = 157,
    PalmPlant = 158,
    Mushroom1 = 159,
    // raw 160-163: untyped plant/river decorations

    // raw 163, 164, 165: sea-shore decorations (88% near sea). Untyped.
    // ---- Lake / freshwater (raw 166-168; 25% near river, 10% near pond) ----
    WaterLily1 = 166,
    WaterLily2 = 167,
    WaterLily3 = 168,

    // ---- Beach (raw 169-170) ----
    Mussel1 = 169,
    Mussel2 = 170,
    // raw 171-214: untyped beach/mountain/desert/dark decorations

    // ---- Snow (raw 215) ----
    Snowman = 215,

    // ---- Desert rare (raw 218) ----
    SkeletonDesert2 = 218,
    // raw 219: desert wreck (untyped, same visual as WaggonDestroyed)
    // raw 220-244: untyped plant/dark/desert decorations

    // ---- Dark bushes (raw 245, 254) ----
    DarkBush1 = 245,
    DarkBush2 = 254,

    // ==== Types without known raw bytes (>255 to avoid conflicts) ====

    // ---- Resources ----
    ResourceCoal = 256,
    ResourceGold = 257,
    ResourceIron = 258,
    ResourceSulfur = 259,
    ResourceDarkStone = 260,

    // ---- Crops (planted by workers, grow through stages) ----
    Grain = 270,
    Sunflower = 271,
    Agave = 272,
    Beehive = 273, // OBJECT_HIVE
    Grape = 274,
    Wheat2 = 275, // OBJECT_WHEAT2 -- distinct from Grain (WHEAT1)

    // ---- Flowers without raw bytes ----
    Flower5 = 284,
    SpecialFlower = 285,

    // ---- Foliage / Branches without raw bytes ----
    Foliage2 = 286,
    Foliage3 = 287,
    Branch1 = 288,
    Branch2 = 289,
    Branch3 = 290,
    Branch4 = 291,

    // ---- Mushrooms without raw bytes ----
    Mushroom2 = 292,
    Mushroom3 = 293,
    EvilMushroom1 = 297,
    EvilMushroom2 = 298,
    EvilMushroom3 = 299,

    // ---- Decorative stones -- Brownish ----
    StoneBrownish1 = 300,
    StoneBrownish2 = 301,
    StoneBrownish3 = 302,
    StoneBrownish4 = 303,
    StoneBrownish5 = 304,
    StoneBrownish6 = 305, // blocking=2 (large)
    StoneBrownish7 = 306,
    StoneBrownish8 = 307,
    StoneBrownish9 = 308, // blocking=0 (pebble)
    StoneBrownish10 = 309,

    // ---- Decorative stones -- Darkish ----
    StoneDarkish1 = 310,
    StoneDarkish2 = 311,
    StoneDarkish3 = 312,
    StoneDarkish4 = 313,
    StoneDarkish5 = 314,
    StoneDarkish6 = 315,
    StoneDarkish7 = 316,
    StoneDarkish8 = 317,
    StoneDarkish9 = 318, // blocking=2 (large)
    StoneDarkish10 = 319,

    // ---- Decorative stones -- Darkish B variant ----
    StoneDarkishB1 = 320,
    StoneDarkishB2 = 321,
    StoneDarkishB3 = 322,
    StoneDarkishB4 = 323,
    StoneDarkishB5 = 324,
    StoneDarkishB6 = 325, // blocking=2
    StoneDarkishB7 = 326,
    StoneDarkishB8 = 327,
    StoneDarkishB9 = 328, // blocking=0 (pebble)
    StoneDarkishB10 = 329, // blocking=0 (pebble)

    // ---- Decorative stones -- Darkish G variant ----
    StoneDarkishG1 = 330, // blocking=2
    StoneDarkishG2 = 331,
    StoneDarkishG3 = 332,
    StoneDarkishG4 = 333,
    StoneDarkishG5 = 334,
    StoneDarkishG6 = 335,
    StoneDarkishG7 = 336,
    StoneDarkishG8 = 337,
    StoneDarkishG9 = 338,
    StoneDarkishG10 = 339,

    // ---- Decorative stones -- Greyish ----
    StoneGreyish1 = 340, // blocking=2
    StoneGreyish2 = 341,
    StoneGreyish3 = 342,
    StoneGreyish4 = 343,
    StoneGreyish5 = 344,
    StoneGreyish6 = 345,
    StoneGreyish7 = 346,
    StoneGreyish8 = 347,
    StoneGreyish9 = 348,
    StoneGreyish10 = 349,

    // ---- Water features ----
    Pond = 350, // blocking=3, animated, pingPong

    // ---- Waves (pure visual, no gameplay) ----
    WaveLake1 = 352, // WAVE_LAKE24X12
    WaveLake2 = 353, // WAVE_LAKE28X22
    WaveLake3 = 354, // WAVE_LAKE37X19
    WaveLake4 = 355, // WAVE_LAKE40X24
    WaveLake5 = 356, // WAVE_LAKE48X19
    WaveLake6 = 357, // WAVE_LAKE49X18
    WaveLake7 = 358, // WAVE_LAKE51X29

    // ---- Misc placeable objects ----
    Well = 360, // blocking=2
    DarkSnowman = 361,
    Flag = 362,
    Grave2 = 363,
    ShadowHerb = 364, // blocking=0 but building=1 (unusual)
    Wreck = 365,
    DarkRope = 366,
    DarkSpitter = 367,
    Boundary = 368,
    BaseMorbus = 369, // Dark Tribe corruption source, version=10
    Reeve1 = 370, // blocking=1 (standing sheaf)
    Reeve2 = 371, // blocking=0 (flat)
    Reeve3 = 372, // blocking=1 (standing sheaf)
    Reeve4 = 373, // blocking=0 (flat)

    // ---- Resource indicators (underground markers, not mineable) ----
    ResCoal = 380,
    ResFish = 381,
    ResGold = 382,
    ResIron = 383,
    ResStone = 384,
    ResSulfur = 385,
    ResEmpty = 386,

    // ---- Mine decorations (entrance props) ----
    MineSet1 = 390,
    MineSet2 = 391,
    DarkMineSet1 = 392,
    DarkMineSet2 = 393,

    // ---- Wonders / Large structures ----
    WonderCastle = 400, // blocking=8, animated, pingPong
    WonderColossus = 401, // blocking=5, animated, pingPong
    WonderGate = 402, // blocking=5, animated, pingPong
    WonderPharos = 403, // blocking=5, animated, pingPong
    Moai01 = 404, // blocking=2, static
    Moai02 = 405, // blocking=4, animated, pingPong
    WonderAlchemist = 406, // blocking=3, animated, pingPong

    // ---- Trojan horse ----
    TrojanHorseBuild = 410, // blocking=6
    TrojanHorseStandard = 411, // blocking=5
    TrojanHorseDestroyed = 412, // blocking=3

    // ---- Column ruins without raw bytes (directional pieces: E/S/W) ----
    ColumnRuinsE1 = 420,
    ColumnRuinsE2 = 421,
    ColumnRuinsE3 = 422,
    ColumnRuinsE4 = 423,
    ColumnRuinsS1 = 424, // blocking=3 (largest ruin piece)
    ColumnRuinsS2 = 425,
    ColumnRuinsS3 = 426,
    ColumnRuinsW1 = 427,
    ColumnRuinsW2 = 428,
    ColumnRuinsW3 = 429,
    ColumnRuinsW4 = 430,

    // ---- Unplaced (no known raw byte, editor/script only) ----
    TreeDead = 708, // Placeholder until raw byte identified
}
/* eslint-enable @typescript-eslint/no-duplicate-enum-values -- end of enum with intentional alias values */

/** Check if a MapObjectType is a harvestable stone (raw 124-135). */
export function isHarvestableStone(type: number): boolean {
    return type >= MapObjectType.ResourceStone1 && type <= MapObjectType.ResourceStone12;
}

/** Get the depletion level of a harvestable stone subType (1=nearly depleted, 12=full). */
export function stoneDepletionLevel(type: number): number {
    return type - MapObjectType.ResourceStone1 + 1;
}

/** Get the harvestable stone subType for a depletion level (1-12). */
export function stoneTypeForLevel(level: number): MapObjectType {
    return (MapObjectType.ResourceStone1 + level - 1) as MapObjectType;
}

/** Full stone depletion level (12). */
export const STONE_FULL_LEVEL = 12;
