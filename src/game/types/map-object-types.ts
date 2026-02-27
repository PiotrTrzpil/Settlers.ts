/**
 * Map object type definitions.
 * These are natural objects that exist on the map independently of players.
 *
 * Every OBJECT_* entry in objectInfo.xml should have a corresponding MapObjectType value.
 * The mapping from MapObjectType → XML ID lives in game-data-access.ts.
 */

/**
 * Unified classification for all map objects — both typed game entities
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
}

export enum MapObjectType {
    // ---- Trees (S4ModApi S4_TREE_ENUM, raw bytes 1-18) ----
    TreeOak = 0, // 1
    TreeBeech = 1, // 2
    TreeAsh = 2, // 3
    TreeLinden = 3, // 4
    TreeBirch = 4, // 5
    TreePoplar = 5, // 6
    TreeChestnut = 6, // 7
    TreeMaple = 7, // 8
    TreeFir = 8, // 9
    TreeSpruce = 9, // 10
    TreeCoconut = 10, // 11
    TreeDate = 11, // 12
    TreeWalnut = 12, // 13
    TreeCorkOak = 13, // 14
    TreePine = 14, // 15
    TreePine2 = 15, // 16
    TreeOliveLarge = 16, // 17
    TreeOliveSmall = 17, // 18

    // Tree aliases for code compatibility or specific tribe variations
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values -- alias: TreePalm maps same sprite as generic palm
    TreePalm = 10, // Alias for Coconut/Date generic
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values -- alias: TreeCypress maps same sprite as generic fir/spruce
    TreeCypress = 8, // Alias for Fir/Spruce generic
    TreeDead = 18, // Placeholder for now

    // ---- Dark Tribe trees (DARKTREE* in objectInfo.xml) ----
    DarkTree1A = 19,
    DarkTree1B = 20,
    DarkTree2A = 21,
    DarkTree2B = 22,
    DarkTree3A = 23,
    DarkTree3B = 24,
    DarkTree4A = 25,
    DarkTree5A = 26,

    // ---- Resources ----
    ResourceCoal = 100,
    ResourceGold = 101,
    ResourceIron = 102,
    ResourceStone = 103, // STONEMINE1 series (variation = depletion stage)
    ResourceSulfur = 104,
    ResourceDarkStone = 105, // DARKSTONEMINE1 series (Dark Tribe equivalent)
    ResourceStone2 = 106, // STONEMINE2 series (only 3 stages in XML)

    // ---- Crops (planted by workers, grow through stages) ----
    Grain = 200,
    Sunflower = 201,
    Agave = 202,
    Beehive = 203, // OBJECT_HIVE
    Grape = 204,
    Wheat2 = 205, // OBJECT_WHEAT2 — distinct from Grain (WHEAT1)

    // ---- Bushes (BUSH*, DARKBUSH*, DESERTBUSH* in objectInfo.xml) ----
    Bush1 = 300,
    Bush2 = 301,
    Bush3 = 302,
    Bush4 = 303,
    Bush5 = 304,
    Bush6 = 305,
    Bush7 = 306,
    Bush8 = 307,
    Bush9 = 308,
    DarkBush1 = 310,
    DarkBush2 = 311,
    DarkBush3 = 312,
    DarkBush4 = 313,
    DesertBush1 = 316,
    DesertBush2 = 317,
    DesertBush3 = 318,

    // ---- Ground cover — Flowers ----
    Flower1 = 320,
    Flower2 = 321,
    Flower3 = 322,
    Flower4 = 323,
    Flower5 = 324,
    SpecialFlower = 325,

    // ---- Ground cover — Grass ----
    Grass1 = 330,
    Grass2 = 331,
    Grass3 = 332,
    Grass4 = 333,
    Grass5 = 334,
    Grass6 = 335,
    Grass7 = 336,
    Grass8 = 337,
    Grass9 = 338,
    Grass10 = 339,

    // ---- Ground cover — Foliage & Branches ----
    Foliage1 = 342,
    Foliage2 = 343,
    Foliage3 = 344,
    Branch1 = 346,
    Branch2 = 347,
    Branch3 = 348,
    Branch4 = 349,

    // ---- Desert plants ----
    Cactus1 = 350,
    Cactus2 = 351,
    Cactus3 = 352,
    Cactus4 = 353,

    // ---- Water vegetation ----
    Reed1 = 360,
    Reed2 = 361,
    Reed3 = 362,
    Seaweed1 = 365,
    Seaweed2 = 366,
    Seaweed3 = 367,
    WaterLily1 = 370,
    WaterLily2 = 371,
    WaterLily3 = 372,

    // ---- Mushrooms ----
    Mushroom1 = 380, // Non-blocking
    Mushroom2 = 381,
    Mushroom3 = 382,
    MushroomDark1 = 385, // Blocking (Dark Tribe)
    MushroomDark2 = 386,
    MushroomDark3 = 387,
    EvilMushroom1 = 390, // Blocking (Dark Tribe)
    EvilMushroom2 = 391,
    EvilMushroom3 = 392,
    MushroomCycle = 395, // Large mushroom ring, blocking=2

    // ---- Decorative stones — Brownish ----
    StoneBrownish1 = 400,
    StoneBrownish2 = 401,
    StoneBrownish3 = 402,
    StoneBrownish4 = 403,
    StoneBrownish5 = 404,
    StoneBrownish6 = 405, // blocking=2 (large)
    StoneBrownish7 = 406,
    StoneBrownish8 = 407,
    StoneBrownish9 = 408, // blocking=0 (pebble)
    StoneBrownish10 = 409,

    // ---- Decorative stones — Darkish ----
    StoneDarkish1 = 410,
    StoneDarkish2 = 411,
    StoneDarkish3 = 412,
    StoneDarkish4 = 413,
    StoneDarkish5 = 414,
    StoneDarkish6 = 415,
    StoneDarkish7 = 416,
    StoneDarkish8 = 417,
    StoneDarkish9 = 418, // blocking=2 (large)
    StoneDarkish10 = 419,

    // ---- Decorative stones — Darkish B variant ----
    StoneDarkishB1 = 420,
    StoneDarkishB2 = 421,
    StoneDarkishB3 = 422,
    StoneDarkishB4 = 423,
    StoneDarkishB5 = 424,
    StoneDarkishB6 = 425, // blocking=2
    StoneDarkishB7 = 426,
    StoneDarkishB8 = 427,
    StoneDarkishB9 = 428, // blocking=0 (pebble)
    StoneDarkishB10 = 429, // blocking=0 (pebble)

    // ---- Decorative stones — Darkish G variant ----
    StoneDarkishG1 = 430, // blocking=2
    StoneDarkishG2 = 431,
    StoneDarkishG3 = 432,
    StoneDarkishG4 = 433,
    StoneDarkishG5 = 434,
    StoneDarkishG6 = 435,
    StoneDarkishG7 = 436,
    StoneDarkishG8 = 437,
    StoneDarkishG9 = 438,
    StoneDarkishG10 = 439,

    // ---- Decorative stones — Greyish ----
    StoneGreyish1 = 440, // blocking=2
    StoneGreyish2 = 441,
    StoneGreyish3 = 442,
    StoneGreyish4 = 443,
    StoneGreyish5 = 444,
    StoneGreyish6 = 445,
    StoneGreyish7 = 446,
    StoneGreyish8 = 447,
    StoneGreyish9 = 448,
    StoneGreyish10 = 449,

    // ---- Water features ----
    Pond = 500, // blocking=3, animated, pingPong
    DarkPond = 501, // blocking=3, animated

    // ---- Waves (pure visual, no gameplay) ----
    Wave = 505, // WAVE96X63
    WaveLake1 = 506, // WAVE_LAKE24X12
    WaveLake2 = 507, // WAVE_LAKE28X22
    WaveLake3 = 508, // WAVE_LAKE37X19
    WaveLake4 = 509, // WAVE_LAKE40X24
    WaveLake5 = 510, // WAVE_LAKE48X19
    WaveLake6 = 511, // WAVE_LAKE49X18
    WaveLake7 = 512, // WAVE_LAKE51X29

    // ---- Misc placeable objects ----
    Well = 520, // blocking=2
    Scarecrow = 521,
    Snowman = 522,
    DarkSnowman = 523,
    Flag = 524,
    Grave1 = 525,
    Grave2 = 526,
    RuneStone = 527,
    CelticCross = 528, // blocking=2
    PalmPlant = 529,
    ShadowHerb = 530, // blocking=0 but building=1 (unusual)
    Wreck = 531,
    DarkRope = 532,
    DarkSpitter = 533,
    Boundary = 534,
    BaseMorbus = 535, // Dark Tribe corruption source, version=10
    WaggonDestroyed = 536, // blocking=2
    Reeve1 = 538, // blocking=1 (standing sheaf)
    Reeve2 = 539, // blocking=0 (flat)
    Reeve3 = 540, // blocking=1 (standing sheaf)
    Reeve4 = 541, // blocking=0 (flat)
    SkeletonDesert1 = 542,
    SkeletonDesert2 = 543,
    Mussel1 = 544,
    Mussel2 = 545,

    // ---- Resource indicators (underground markers, not mineable) ----
    ResCoal = 550,
    ResFish = 551,
    ResGold = 552,
    ResIron = 553,
    ResStone = 554,
    ResSulfur = 555,

    // ---- Mine decorations (entrance props) ----
    MineSet1 = 560,
    MineSet2 = 561,
    DarkMineSet1 = 562,
    DarkMineSet2 = 563,

    // ---- Wonders / Large structures ----
    WonderCastle = 600, // blocking=8, animated, pingPong
    WonderColossus = 601, // blocking=5, animated, pingPong
    WonderGate = 602, // blocking=5, animated, pingPong
    WonderPharos = 603, // blocking=5, animated, pingPong
    Moai01 = 604, // blocking=2, static
    Moai02 = 605, // blocking=4, animated, pingPong
    WonderAlchemist = 606, // blocking=3, animated, pingPong
    Ruin = 607, // blocking=3, building=3 (unique)

    // ---- Trojan horse ----
    TrojanHorseBuild = 610, // blocking=6
    TrojanHorseStandard = 611, // blocking=5
    TrojanHorseDestroyed = 612, // blocking=3

    // ---- Column ruins (directional pieces: A/E/S/W) ----
    ColumnRuinsA1 = 620,
    ColumnRuinsA2 = 621,
    ColumnRuinsE1 = 622,
    ColumnRuinsE2 = 623,
    ColumnRuinsE3 = 624,
    ColumnRuinsE4 = 625,
    ColumnRuinsS1 = 626, // blocking=3 (largest ruin piece)
    ColumnRuinsS2 = 627,
    ColumnRuinsS3 = 628,
    ColumnRuinsW1 = 629,
    ColumnRuinsW2 = 630,
    ColumnRuinsW3 = 631,
    ColumnRuinsW4 = 632,
}
