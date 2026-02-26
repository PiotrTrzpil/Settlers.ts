/**
 * Direct GIL (sprite) index constants for GFX files.
 *
 * GIL indices are direct offsets into GFX image tables —
 * they reference specific pre-rendered sprites without going through
 * the JIL→DIL→GIL pipeline that animated entities use.
 *
 * @module renderer/sprite-metadata/gil-indices
 */

import { BuildingType, MapObjectType } from '../../entity';
import { Race } from '../../race';

// ============================================================
// Building UI Icons — GIL indices per race
// ============================================================

/**
 * Direct GIL indices for building icons in the UI palette, per race.
 * Each entry has [unselected, selected] indices.
 * Mapped from the icon GFX files (9.gfx for Roman, 19.gfx for Viking, etc.)
 */
export const BUILDING_ICON_INDICES: Record<Race, Partial<Record<BuildingType, [number, number]>>> = {
    [Race.Roman]: {
        // Residential
        [BuildingType.ResidenceBig]: [747, 748],
        [BuildingType.ResidenceMedium]: [749, 750],
        [BuildingType.ResidenceSmall]: [751, 752],
        // Food Production
        [BuildingType.Bakery]: [755, 756],
        [BuildingType.DonkeyRanch]: [757, 758],
        [BuildingType.AnimalRanch]: [759, 766],
        [BuildingType.FisherHut]: [760, 761],
        [BuildingType.GrainFarm]: [762, 763],
        [BuildingType.HunterHut]: [764, 765],
        [BuildingType.Slaughterhouse]: [767, 768],
        [BuildingType.Mill]: [771, 772],
        [BuildingType.LivingHouse]: [753, 754],
        // Wood & Stone
        [BuildingType.ForesterHut]: [812, 813],
        [BuildingType.Sawmill]: [769, 770],
        [BuildingType.WaterworkHut]: [779, 780],
        [BuildingType.Vinyard]: [781, 782],
        [BuildingType.WoodcutterHut]: [828, 833],
        [BuildingType.StonecutterHut]: [826, 827],
        // Mining
        [BuildingType.StoneMine]: [745, 746],
        [BuildingType.GoldMine]: [787, 788],
        [BuildingType.SulfurMine]: [789, 790],
        [BuildingType.IronMine]: [791, 792],
        [BuildingType.CoalMine]: [793, 794],
        // Industry
        [BuildingType.SmeltGold]: [773, 774],
        [BuildingType.IronSmelter]: [775, 776],
        [BuildingType.ToolSmith]: [777, 778],
        [BuildingType.WeaponSmith]: [783, 784],
        [BuildingType.SiegeWorkshop]: [785, 786],
        [BuildingType.AmmunitionMaker]: [814, 815],
        // Religious & Towers
        [BuildingType.SmallTemple]: [799, 800],
        [BuildingType.LargeTemple]: [805, 806],
        [BuildingType.HealerHut]: [795, 796],
        [BuildingType.LookoutTower]: [797, 798],
        [BuildingType.Castle]: [810, 811],
        // Storage & Military
        [BuildingType.StorageArea]: [820, 821],
        [BuildingType.Barrack]: [818, 819],
        [BuildingType.GuardTowerSmall]: [803, 804],
        [BuildingType.GuardTowerBig]: [808, 809],
    },
    [Race.Viking]: {
        [BuildingType.WoodcutterHut]: [772, 773],
    },
    [Race.Mayan]: {
        [BuildingType.WoodcutterHut]: [776, 806],
    },
    [Race.DarkTribe]: {},
    [Race.Trojan]: {},
};

// ============================================================
// Map Object Sprites — GIL indices in file 5.gfx
// ============================================================

/**
 * File 5.gfx (MAP_OBJECTS) — sprite index assignments.
 *
 * GIL indices for decoration/object sprites.
 */
export const MAP_OBJECT_SPRITES = {
    // ── Harvestable stone variant A (784-796) ─────────────────
    /**
     * Harvestable stone — standard gray/green variant (GIL 784-796).
     * 13 depletion stages: index 0 = most depleted, index 12 = full.
     * Variants: A (784), B (1080), A_DARK (1543), B_DARK (1093).
     */
    STONE_STAGES_A: { start: 784, end: 796, count: 13 },
    /** Harvestable stone variant B — standard style, 13 stages (varying sizes) */
    STONE_STAGES_B: { start: 1080, end: 1092, count: 13 },
    /** Harvestable stone variant A dark/polluted, 13 stages (121x105) */
    STONE_STAGES_A_DARK: { start: 1543, end: 1555, count: 13 },
    /** Harvestable stone variant B dark/polluted — 13 stages (varying sizes) */
    STONE_STAGES_B_DARK: { start: 1093, end: 1105, count: 13 },

    // ── Single-frame special decorations (797, 854-879, 960) ─
    /** Abandoned overgrown Trojan horse decoration (403x294) */
    TROJAN_HORSE_RUIN: 797,
    /** Desert cactus (103x87) */
    CACTUS: 854,
    /** Stone cross ruins with moss (117x107) */
    STONE_CROSS_RUIN: 855,
    /** Animal skeleton lying on ground (108x56) */
    SKELETON_LARGE: 856,
    /** Smaller bones/skeleton remains (77x70) */
    SKELETON_SMALL: 857,
    /** Broken wagon/cart wreckage with wheels (118x88) */
    WAGON_WRECK: 858,
    /** Wrecked boat hull on rocks (118x106) */
    BOAT_WRECK: 859,
    /** Small wood debris pile (56x39) */
    DEBRIS_SMALL: 860,
    /** Rubble/ruin pile (82x53) */
    RUBBLE_MEDIUM: 861,
    /** Broken building rubble (71x50) */
    RUBBLE_SMALL: 862,
    /** Tall ruined column/pillar (80x82) */
    RUINED_COLUMN: 863,
    /** Small animal decoration (38x37) */
    SMALL_ANIMAL: 864,
    /** Tall rock formation (89x99) */
    ROCK_TALL_A: 865,
    /** Scattered rock debris (61x38) */
    ROCK_DEBRIS: 866,
    /** Tall desert rock spire (97x110) */
    ROCK_SPIRE: 867,
    /** Small rock pile (46x32) */
    ROCK_PILE_SMALL: 868,
    /** Medium boulder (61x49) */
    BOULDER_MEDIUM: 869,
    /** Mossy rock cluster (80x59) */
    ROCK_MOSSY_A: 870,
    /** Rocky outcrop (58x38) */
    ROCK_OUTCROP: 871,
    /** Tall rock with cave opening (96x92) */
    ROCK_CAVE: 872,
    /** Medium rounded boulder (75x49) */
    BOULDER_ROUND: 873,
    /** Flat mossy boulder A (68x49) */
    BOULDER_FLAT_A: 874,
    /** Flat mossy boulder B (73x46) */
    BOULDER_FLAT_B: 875,
    /** Tall pointed rock spire (87x94) */
    ROCK_POINTED: 876,
    /** Large mossy cliff rock (81x76) */
    ROCK_CLIFF: 877,
    /** Small pebble/rock (31x30) */
    PEBBLE: 878,
    /** Stone statue/ruined totem (74x88) */
    STONE_STATUE: 879,
    /** Shipwreck with barrels (114x75) */
    SHIPWRECK: 960,

    // ── Animated bushes (798-853): 7 groups of 8 frames ──────
    /** Small yellow-green bush, 8 anim frames (54x42) */
    BUSH_SMALL_YELLOW: { start: 798, end: 805, count: 8 },
    /** Larger dark-green bush/plant, 8 anim frames (88x76) */
    BUSH_LARGE_DARK: { start: 806, end: 813, count: 8 },
    /** Medium green bush with berries, 8 frames (80x62) */
    BUSH_MEDIUM_BERRY: { start: 814, end: 821, count: 8 },
    /** Bush variant C (59x51) */
    BUSH_VARIANT_C: { start: 822, end: 829, count: 8 },
    /** Bush variant D (70x57) */
    BUSH_VARIANT_D: { start: 830, end: 837, count: 8 },
    /** Bush variant E, low/wide (70x41) */
    BUSH_VARIANT_E: { start: 838, end: 845, count: 8 },
    /** Bush with red berries (58x51) */
    BUSH_RED_BERRY: { start: 846, end: 853, count: 8 },

    // ── Animated grass/reeds (880-959): 10 groups of 8 frames ─
    /** Large grass reeds (117x71) */
    GRASS_REEDS_LARGE_A: { start: 880, end: 887, count: 8 },
    /** Medium-large grass reeds (103x67) */
    GRASS_REEDS_MEDIUM_A: { start: 888, end: 895, count: 8 },
    /** Medium grass with orange flowers (66x57) */
    GRASS_FLOWERS_ORANGE: { start: 896, end: 903, count: 8 },
    /** Small green weeds (43x39) */
    GRASS_WEEDS_SMALL: { start: 904, end: 911, count: 8 },
    /** Small grass with orange bits (45x32) */
    GRASS_SMALL_ORANGE: { start: 912, end: 919, count: 8 },
    /** Wide grass reeds spread (130x83) */
    GRASS_REEDS_WIDE: { start: 920, end: 927, count: 8 },
    /** Medium grass reeds B (99x57) */
    GRASS_REEDS_MEDIUM_B: { start: 928, end: 935, count: 8 },
    /** Large grass reeds B (111x69) */
    GRASS_REEDS_LARGE_B: { start: 936, end: 943, count: 8 },
    /** Medium grass with yellow flowers (100x65) */
    GRASS_FLOWERS_YELLOW: { start: 944, end: 951, count: 8 },
    /** Small grass plant (70x44) */
    GRASS_PLANT_SMALL: { start: 952, end: 959, count: 8 },

    // ── Animated pond (961-976): 16 frames ─────────────────
    /** Decorative pond with fish (147x88) */
    POND: { start: 961, end: 976, count: 16 },

    // ── Animated ruined building (977-987): 11 frames ────
    /** Overgrown stone building ruins with beams (128x124) */
    BUILDING_RUIN_ANIM: { start: 977, end: 987, count: 11 },

    // ── Single-frame misc decorations (988-1003) ─────────
    /** Scarecrow (83x75) */
    SCARECROW: 988,
    /** Mushroom fairy ring on grass (112x80) */
    MUSHROOM_RING: 989,
    /** Dark ore/rock deposit (54x54) */
    ORE_ROCK_A: 990,
    /** Dark brown boulder (55x45) */
    ORE_ROCK_B: 991,
    /** Red crystal/mineral formation (54x57) */
    RED_CRYSTAL_A: 992,
    /** Tall red/lava rock spire (87x109) */
    LAVA_ROCK_TALL: 993,
    /** Red/lava rock formation (68x80) */
    LAVA_ROCK_MEDIUM: 994,
    /** Small red lava rock (49x50) */
    LAVA_ROCK_SMALL: 995,
    /** Dark volcanic rock formation (102x87) */
    VOLCANIC_ROCK_LARGE: 996,
    /** Dark volcanic rock cluster (79x58) */
    VOLCANIC_ROCK_MEDIUM: 997,
    /** Tall dark volcanic rock pillar (114x116) */
    VOLCANIC_ROCK_PILLAR: 998,
    /** Dark volcanic rock (66x66) */
    VOLCANIC_ROCK_SMALL: 999,
    /** Colorful vine/creeper ground cover (123x81) */
    VINE_GROUND_COVER: 1000,
    /** Dark tribe mushroom tree A (138x122) */
    DARK_TRIBE_TREE_A: 1001,
    /** Dark tribe mushroom tree B (139x104) */
    DARK_TRIBE_TREE_B: 1002,
    /** Dark tribe mushroom tree C, purple (134x120) */
    DARK_TRIBE_TREE_C: 1003,

    // ── Animated sea rocks (1004-1043): 4 groups of 10 frames ─
    /** Sea rock island with waves A (75x79) */
    SEA_ROCK_A: { start: 1004, end: 1013, count: 10 },
    /** Sea rock island smaller B (61x67) */
    SEA_ROCK_B: { start: 1014, end: 1023, count: 10 },
    /** Tall sea rock with waves C (54x71) */
    SEA_ROCK_C: { start: 1024, end: 1033, count: 10 },
    /** Sea cliff with waterfall D (48x64) */
    SEA_ROCK_D: { start: 1034, end: 1043, count: 10 },

    // ── Dark tribe single decorations (1044-1048) ────────
    /** Dark tribe purple flower plant (77x62) */
    DARK_TRIBE_FLOWER: 1044,
    /** Dark tribe spooky dead tree (72x69) */
    DARK_TRIBE_DEAD_TREE: 1045,
    /** Dark tribe dark bush (70x57) */
    DARK_TRIBE_BUSH_A: 1046,
    /** Dark tribe red bush (58x51) */
    DARK_TRIBE_BUSH_B: 1047,
    /** Dark stone block/pedestal (66x55) */
    DARK_STONE_BLOCK: 1048,

    // ── Ancient column pillar (1049) ─────────────────────
    /** Ancient Roman column pillar (82x106) */
    ANCIENT_COLUMN: 1049,

    // ── Trojan horse construction (1050-1058) ────────────
    /** Trojan horse being built with scaffolding, 8 anim frames (415x318) */
    TROJAN_HORSE_CONSTRUCTION: { start: 1050, end: 1057, count: 8 },
    /** Completed Trojan horse on wheels (375x228) */
    TROJAN_HORSE_COMPLETE: 1058,

    // ── Magic portal (1059-1075): 17 anim frames ─────────
    /** Animated magic portal with green swirling energy (190x240) */
    MAGIC_PORTAL: { start: 1059, end: 1075, count: 17 },

    // ── Desert cactus stages (1076-1079): large → tiny ───
    /** Desert cactus large (92x84) */
    DESERT_CACTUS_LARGE: 1076,
    /** Desert cactus medium (72x60) */
    DESERT_CACTUS_MEDIUM: 1077,
    /** Desert cactus small (55x41) */
    DESERT_CACTUS_SMALL: 1078,
    /** Desert cactus sprout (27x18) */
    DESERT_CACTUS_SPROUT: 1079,

    // ── Mayan decorations (1106-1107) ────────────────────
    /** Mayan garden/terrain patch with rocks (134x83) */
    MAYAN_GARDEN: 1106,
    /** Snowman variant B */
    SNOWMAN_B: 1107,

    // ── Roman pillars (1108-1112): various shapes ────────
    /** Roman pillar — small */
    ROMAN_PILLAR_SMALL: 1108,
    /** Roman pillar — medium A */
    ROMAN_PILLAR_MEDIUM_A: 1109,
    /** Roman pillar — medium B */
    ROMAN_PILLAR_MEDIUM_B: 1110,
    /** Roman pillar — large A */
    ROMAN_PILLAR_LARGE_A: 1111,
    /** Roman pillar — large B */
    ROMAN_PILLAR_LARGE_B: 1112,

    // ── Overgrown Roman columns (1376-1378): columns with plants ─
    /** Roman column with plants A */
    ROMAN_COLUMN_OVERGROWN_A: 1376,
    /** Roman column with plants B */
    ROMAN_COLUMN_OVERGROWN_B: 1377,
    /** Roman column with plants C */
    ROMAN_COLUMN_OVERGROWN_C: 1378,

    // ── Broken pillars (1113-1115) ────────────────────────
    /** Broken pillar A */
    BROKEN_PILLAR_A: 1113,
    /** Broken pillar B */
    BROKEN_PILLAR_B: 1114,
    /** Broken pillar C */
    BROKEN_PILLAR_C: 1115,

    // ── Animated dark green bush (1116-1123): 8 frames ───
    /** Animated dark green bush (59x54) */
    BUSH_DARK_GREEN: { start: 1116, end: 1123, count: 8 },

    // ── Single decoration (1124) ─────────────────────────
    /** Grave/tombstone */
    GRAVE_A: 1124,

    // ── Vine/wine growth stages (1125-1129): varying sizes ─
    /** Vine growth stage 1 — sprout */
    VINE_STAGE_1: 1125,
    /** Vine growth stage 2 — small */
    VINE_STAGE_2: 1126,
    /** Vine growth stage 3 — medium */
    VINE_STAGE_3: 1127,
    /** Vine growth stage 4 — large */
    VINE_STAGE_4: 1128,
    /** Vine growth stage 5 — full grown */
    VINE_STAGE_5: 1129,

    // ── Animated river reeds/cattails (1130-1183): 6 groups of 9 frames ─
    /** Tall river reeds/cattails (123x132) */
    RIVER_REEDS_TALL: { start: 1130, end: 1138, count: 9 },
    /** River/swamp ferns (129x85) */
    RIVER_FERNS: { start: 1139, end: 1147, count: 9 },
    /** Large flowering river plants (217x168) */
    RIVER_FLOWERS_LARGE: { start: 1148, end: 1156, count: 9 },
    /** Single cattail/bulrush (113x112) */
    CATTAIL_SINGLE: { start: 1157, end: 1165, count: 9 },
    /** Double cattails (134x118) */
    CATTAIL_DOUBLE: { start: 1166, end: 1174, count: 9 },
    /** Triple cattails (125x130) */
    CATTAIL_TRIPLE: { start: 1175, end: 1183, count: 9 },

    // ── Beach/shore decorations (1184-1199) ──────────────
    /** Seashell/clam (71x47) */
    SEASHELL: 1184,
    /** Seashells/starfish cluster (70x58) */
    STARFISH: 1185,
    /** Lake decoration A */
    LAKE_DECO_A: 1186,
    /** Lake decoration B */
    LAKE_DECO_B: 1187,
    /** Lake decoration C */
    LAKE_DECO_C: 1188,
    // ── Dry spiky plants (1189-1195): desert vegetation ───
    /** Dry spiky plant A */
    DESERT_PLANT_A: 1189,
    /** Dry spiky plant B */
    DESERT_PLANT_B: 1190,
    /** Dry spiky plant C */
    DESERT_PLANT_C: 1191,
    /** Dry spiky plant D */
    DESERT_PLANT_D: 1192,
    /** Dry spiky plant E */
    DESERT_PLANT_E: 1193,
    /** Dry spiky plant F */
    DESERT_PLANT_F: 1194,
    /** Dry spiky plant G */
    DESERT_PLANT_G: 1195,
    /** Amanita mushroom */
    AMANITA_MUSHROOM: 1196,
    BEACH_DECO_J: 1197,
    BEACH_DECO_K: 1198,
    BEACH_DECO_L: 1199,
    /** Small daisies/flowers on grass (81x51) */
    DAISIES: 1200,

    /**
     * Resource signs (1208-1223): wooden signs placed by geologists on mountains.
     * 1208 = empty/no resource. Then groups of 3 (low, medium, rich) per resource type.
     */
    RESOURCE_SIGNS: {
        EMPTY: 1208,
        COAL: { LOW: 1209, MED: 1210, RICH: 1211 },
        GOLD: { LOW: 1212, MED: 1213, RICH: 1214 },
        IRON: { LOW: 1215, MED: 1216, RICH: 1217 },
        STONE: { LOW: 1218, MED: 1219, RICH: 1220 },
        SULFUR: { LOW: 1221, MED: 1222, RICH: 1223 },
    },

    // ── Grain growth stages (1224-1243) ───────────────────
    /** Grain seed — just planted */
    GRAIN_SEED: 1224,
    /** Grain growing stages 1-3 */
    GRAIN_GROWING: { start: 1225, end: 1227, count: 3 },
    /** Grain fully grown — animated, 7 frames */
    GRAIN_GROWN: { start: 1228, end: 1234, count: 7 },
    /** Grain cut/harvested */
    GRAIN_CUT: 1235,
    /** Grain fully grown dry variant — 8 frames */
    GRAIN_GROWN_DRY: { start: 1236, end: 1243, count: 8 },

    // ── Grain visual variant 2 (1244-1263) ──────────────────
    /** Grain variant 2 seed — just planted */
    GRAIN_V2_SEED: 1244,
    /** Grain variant 2 growing stages 1-3 */
    GRAIN_V2_GROWING: { start: 1245, end: 1247, count: 3 },
    /** Grain variant 2 fully grown — animated, 7 frames */
    GRAIN_V2_GROWN: { start: 1248, end: 1254, count: 7 },
    /** Grain variant 2 cut/harvested */
    GRAIN_V2_CUT: 1255,
    /** Grain variant 2 fully grown dry variant — 8 frames */
    GRAIN_V2_GROWN_DRY: { start: 1256, end: 1263, count: 8 },

    // ── Agave growth stages (1264-1282) ─────────────────────
    /** Agave seedling */
    AGAVE_SEEDLING: 1264,
    /** Agave growing stages 1-2 */
    AGAVE_GROWING: { start: 1265, end: 1266, count: 2 },
    /** Agave fully grown — animated, 15 frames */
    AGAVE_GROWN: { start: 1267, end: 1281, count: 15 },
    /** Agave cut/harvested */
    AGAVE_CUT: 1282,

    // ── Snow decorations ──────────────────────────────────
    /** Snowman decoration */
    SNOWMAN: 1299,

    // ── Beehive (1361-1375) ─────────────────────────────────
    /** Beehive active — animated, 12 frames */
    BEEHIVE_GROWN: { start: 1361, end: 1372, count: 12 },
    /** Beehive empty/used */
    BEEHIVE_EMPTY: 1373,
    /** Beehive destroyed — 2 frames */
    BEEHIVE_DESTROYED: { start: 1374, end: 1375, count: 2 },

    // ── Misc decorations (1521-1522) ──────────────────────
    /** Grave/tombstone variant B */
    GRAVE_B: 1521,
    /** Magic pillar/obelisk */
    MAGIC_PILLAR: 1522,

    // ── Sunflower growth stages (1620-1631) ──────────────────
    /** Sunflower growth stage 1 — small sprout */
    SUNFLOWER_STAGE_1: 1620,
    /** Sunflower growth stage 2 — medium sprout */
    SUNFLOWER_STAGE_2: 1621,
    /** Sunflower growth stage 3 — tall sprout */
    SUNFLOWER_STAGE_3: 1622,
    /** Sunflower fully grown — animated, 8 frames */
    SUNFLOWER_GROWN: { start: 1623, end: 1630, count: 8 },
    /** Sunflower cut/harvested */
    SUNFLOWER_CUT: 1631,

    // ── Sea wave patches (1640-1849) ────────────────────────
    // Groups of 15 animation frames — small wave patches
    /** Tiny sea wave patch (31x17) */
    SEA_WAVE_TINY: { start: 1640, end: 1654, count: 15 },
    /** Small sea wave patch (41x28) */
    SEA_WAVE_SMALL_A: { start: 1655, end: 1669, count: 15 },
    /** Small-medium sea wave patch (47x29) */
    SEA_WAVE_SMALL_B: { start: 1670, end: 1684, count: 15 },
    /** Medium sea wave patch (59x38) */
    SEA_WAVE_MEDIUM: { start: 1685, end: 1699, count: 15 },
    /** Wide sea wave patch (78x27) */
    SEA_WAVE_WIDE: { start: 1700, end: 1714, count: 15 },
    /** Large sea wave patch (76x53) */
    SEA_WAVE_LARGE_A: { start: 1715, end: 1729, count: 15 },

    // Groups of 12 animation frames — larger wave patches
    /** Medium wave patch B (49x27) */
    SEA_WAVE_MEDIUM_B: { start: 1730, end: 1741, count: 12 },
    /** Large wave patch (118x64) */
    SEA_WAVE_LARGE_B: { start: 1742, end: 1753, count: 12 },
    /** Extra-large wave patch (211x96) */
    SEA_WAVE_XLARGE: { start: 1754, end: 1765, count: 12 },
    /** Tiny wave patch B (26x11) */
    SEA_WAVE_TINY_B: { start: 1766, end: 1777, count: 12 },
    /** Small wave patch C (50x20) */
    SEA_WAVE_SMALL_C: { start: 1778, end: 1789, count: 12 },
    /** Large wave patch C (98x56) */
    SEA_WAVE_LARGE_C: { start: 1790, end: 1801, count: 12 },
    /** Large wave patch D (97x60) */
    SEA_WAVE_LARGE_D: { start: 1802, end: 1813, count: 12 },
    /** Small wave patch D (50x20) */
    SEA_WAVE_SMALL_D: { start: 1814, end: 1825, count: 12 },
    /** Small wave patch E (50x20) */
    SEA_WAVE_SMALL_E: { start: 1826, end: 1837, count: 12 },
    /** Small wave patch F (50x20) */
    SEA_WAVE_SMALL_F: { start: 1838, end: 1849, count: 12 },

    // ── Territory dots (1850-1857): 8 team colors ───────────
    /** Territory marker dot — red / player 1 (14x16) */
    TERRITORY_DOT_RED: 1850,
    /** Territory marker dot — blue / player 2 (14x16) */
    TERRITORY_DOT_BLUE: 1851,
    /** Territory marker dot — green / player 3 (14x16) */
    TERRITORY_DOT_GREEN: 1852,
    /** Territory marker dot — yellow / player 4 (14x16) */
    TERRITORY_DOT_YELLOW: 1853,
    /** Territory marker dot — purple / player 5 (14x16) */
    TERRITORY_DOT_PURPLE: 1854,
    /** Territory marker dot — orange / player 6 (14x16) */
    TERRITORY_DOT_ORANGE: 1855,
    /** Territory marker dot — teal / player 7 (14x16) */
    TERRITORY_DOT_TEAL: 1856,
    /** Territory marker dot — gray / player 8 (14x16) */
    TERRITORY_DOT_GRAY: 1857,

    // ── Ground resource icons (1858-1863) ───────────────────
    /** Gold ore ground icon — yellow (20x16) */
    RESOURCE_ICON_GOLD: 1858,
    /** Iron ore ground icon — silver/gray (19x16) */
    RESOURCE_ICON_IRON: 1859,
    /** Coal ground icon — dark red/brown (13x18) */
    RESOURCE_ICON_COAL: 1860,
    /** Stone ground icon — gray rock (22x23) */
    RESOURCE_ICON_STONE: 1861,
    /** Sulfur ground icon — gold/yellow (29x20) */
    RESOURCE_ICON_SULFUR: 1862,
    /** Gem/crystal ground icon — green (28x20) */
    RESOURCE_ICON_GEM: 1863,

    // ── Large flags (1864-1871): 8 team colors, static ──────
    /** Large flag — red / player 1 (94x106) */
    FLAG_LARGE_RED: 1864,
    /** Large flag — blue / player 2 (94x106) */
    FLAG_LARGE_BLUE: 1865,
    /** Large flag — green / player 3 (94x106) */
    FLAG_LARGE_GREEN: 1866,
    /** Large flag — yellow / player 4 (94x106) */
    FLAG_LARGE_YELLOW: 1867,
    /** Large flag — purple / player 5 (94x106) */
    FLAG_LARGE_PURPLE: 1868,
    /** Large flag — orange / player 6 (94x106) */
    FLAG_LARGE_ORANGE: 1869,
    /** Large flag — teal / player 7 (94x106) */
    FLAG_LARGE_TEAL: 1870,
    /** Large flag — white / player 8 (94x106) */
    FLAG_LARGE_WHITE: 1871,

    // ── Sign posts (1872-1874) ──────────────────────────────
    /** Wooden sign post A (45x63) */
    SIGN_POST_A: 1872,
    /** Wooden sign post B (45x63) */
    SIGN_POST_B: 1873,
    /** Wooden sign post C (45x63) */
    SIGN_POST_C: 1874,

    // ── Small animated flags (1875-2066): 8 colors × 24 frames ─
    /** Small waving flag — red / player 1, 24 anim frames (43x29) */
    FLAG_SMALL_RED: { start: 1875, end: 1898, count: 24 },
    /** Small waving flag — blue / player 2, 24 anim frames (43x29) */
    FLAG_SMALL_BLUE: { start: 1899, end: 1922, count: 24 },
    /** Small waving flag — green / player 3, 24 anim frames (43x29) */
    FLAG_SMALL_GREEN: { start: 1923, end: 1946, count: 24 },
    /** Small waving flag — yellow / player 4, 24 anim frames (43x29) */
    FLAG_SMALL_YELLOW: { start: 1947, end: 1970, count: 24 },
    /** Small waving flag — purple / player 5, 24 anim frames (43x29) */
    FLAG_SMALL_PURPLE: { start: 1971, end: 1994, count: 24 },
    /** Small waving flag — orange / player 6, 24 anim frames (43x29) */
    FLAG_SMALL_ORANGE: { start: 1995, end: 2018, count: 24 },
    /** Small waving flag — teal / player 7, 24 anim frames (43x29) */
    FLAG_SMALL_TEAL: { start: 2019, end: 2042, count: 24 },
    /** Small waving flag — white / player 8, 24 anim frames (43x29) */
    FLAG_SMALL_WHITE: { start: 2043, end: 2066, count: 24 },
} as const;

// ============================================================
// Tree job indices — file 5.jil
// ============================================================

/**
 * Tree job offsets within 5.jil.
 * Each tree type has 11 consecutive jobs for different states.
 * Each job has 1 direction (D0) with 1 or more frames.
 *
 * Structure per tree type (base job + offset):
 * - +0: Sapling (smallest) - static
 * - +1: Small tree - static
 * - +2: Medium tree - static
 * - +3: Normal (full grown) - animated or static
 * - +4: Falling tree - animated
 * - +5 to +9: Being cut phases (5 phases) - animated
 * - +10: Canopy disappearing on ground (last frame = trunk only) - animated
 */
export const TREE_JOB_OFFSET = {
    /** Sapling - smallest growth stage */
    SAPLING: 0,
    /** Small tree */
    SMALL: 1,
    /** Medium tree */
    MEDIUM: 2,
    /** Normal full-grown tree */
    NORMAL: 3,
    /** Falling tree - animated */
    FALLING: 4,
    /** Being cut phase 1 */
    CUTTING_1: 5,
    /** Being cut phase 2 */
    CUTTING_2: 6,
    /** Being cut phase 3 */
    CUTTING_3: 7,
    /** Being cut phase 4 */
    CUTTING_4: 8,
    /** Being cut phase 5 */
    CUTTING_5: 9,
    /** Canopy disappearing on ground - animated (last frame = trunk only) */
    CANOPY_DISAPPEARING: 10,
} as const;

/** Number of jobs per tree type */
export const TREE_JOBS_PER_TYPE = 11;

/** First tree job index in 5.jil */
const TREE_BASE_JOB = 1;

/**
 * Base JIL job indices for each tree type in 5.jil.
 * Each tree type has TREE_JOBS_PER_TYPE consecutive jobs (see TREE_JOB_OFFSET).
 * Actual job = baseIndex + TREE_JOB_OFFSET.X
 *
 * Example: Oak normal tree = 1 + TREE_JOB_OFFSET.NORMAL = 1 + 3 = job 4
 */
export const TREE_JOB_INDICES: Partial<Record<MapObjectType, number>> = {
    [MapObjectType.TreeOak]: TREE_BASE_JOB + 0 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeBeech]: TREE_BASE_JOB + 1 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeAsh]: TREE_BASE_JOB + 2 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeLinden]: TREE_BASE_JOB + 3 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeBirch]: TREE_BASE_JOB + 4 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreePoplar]: TREE_BASE_JOB + 5 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeChestnut]: TREE_BASE_JOB + 6 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeMaple]: TREE_BASE_JOB + 7 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeFir]: TREE_BASE_JOB + 8 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeSpruce]: TREE_BASE_JOB + 9 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeCoconut]: TREE_BASE_JOB + 10 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeDate]: TREE_BASE_JOB + 11 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeWalnut]: TREE_BASE_JOB + 12 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeCorkOak]: TREE_BASE_JOB + 13 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreePine]: TREE_BASE_JOB + 14 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreePine2]: TREE_BASE_JOB + 15 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeOliveLarge]: TREE_BASE_JOB + 16 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeOliveSmall]: TREE_BASE_JOB + 17 * TREE_JOBS_PER_TYPE,
    [MapObjectType.TreeDead]: TREE_BASE_JOB + 18 * TREE_JOBS_PER_TYPE,
};
