/**
 * Settlers 4 Map Type Definitions
 * Based on reverse engineering from S4ModApi
 * https://github.com/nyfrk/S4ModApi
 */

/** Ground/terrain type values (Byte 1 of WorldField) */
export enum S4GroundType {
    // Water types (0-7)
    WATER1 = 0,       // No waves (ignores pond flag)
    WATER2 = 1,       // Respects pond flag
    WATER3 = 2,
    WATER4 = 3,
    WATER5 = 4,
    WATER6 = 5,
    WATER7 = 6,
    WATER8 = 7,       // Deep sea

    // Grass types
    GRASS = 16,
    GRASS_ROCK = 17,        // Transition: grass-grass-rock
    GRASS_ISLE = 18,
    GRASS_DESERT = 20,      // Transition: grass-grass-desert
    GRASS_SWAMP = 21,       // Transition: grass-grass-swamp
    GRASS_MUD = 23,         // Transition: grass-grass-mud

    // Dark grass
    DARKGRASS = 24,
    DARKGRASS_GRASS = 25,   // Transition: darkgrass-darkgrass-grass

    // Roads
    SANDYROAD = 28,
    COBBLEDROAD = 29,

    // Rock
    ROCK = 32,
    ROCK_GRASS = 33,        // Transition: rock-rock-grass
    ROCK_SNOW = 35,         // Transition: rock-rock-snow

    // Beach
    BEACH = 48,

    // Desert
    DESERT = 64,
    DESERT_GRASS = 65,      // Transition: desert-desert-grass

    // Swamp
    SWAMP = 80,
    SWAMP_GRASS = 81,       // Transition: swamp-swamp-grass

    // River
    RIVER1 = 96,
    RIVER2 = 97,
    RIVER3 = 98,
    RIVER4 = 99,

    // Snow
    SNOW = 128,
    SNOW_ROCK = 129,        // Transition: snow-snow-rock

    // Mud
    MUD = 144,
    MUD_GRASS = 145,        // Transition: mud-mud-grass
}

/** Resource type values (stored in separate resource map layer) */
export enum S4ResourceType {
    NONE = 0,
    // Fish (1-16) - amount encoded in value
    FISH_1 = 1, FISH_2 = 2, FISH_3 = 3, FISH_4 = 4,
    FISH_5 = 5, FISH_6 = 6, FISH_7 = 7, FISH_8 = 8,
    FISH_9 = 9, FISH_10 = 10, FISH_11 = 11, FISH_12 = 12,
    FISH_13 = 13, FISH_14 = 14, FISH_15 = 15, FISH_16 = 16,

    // Coal (17-32)
    COAL_1 = 17, COAL_2 = 18, COAL_3 = 19, COAL_4 = 20,
    COAL_5 = 21, COAL_6 = 22, COAL_7 = 23, COAL_8 = 24,
    COAL_9 = 25, COAL_10 = 26, COAL_11 = 27, COAL_12 = 28,
    COAL_13 = 29, COAL_14 = 30, COAL_15 = 31, COAL_16 = 32,

    // Iron (33-48)
    IRON_1 = 33, IRON_2 = 34, IRON_3 = 35, IRON_4 = 36,
    IRON_5 = 37, IRON_6 = 38, IRON_7 = 39, IRON_8 = 40,
    IRON_9 = 41, IRON_10 = 42, IRON_11 = 43, IRON_12 = 44,
    IRON_13 = 45, IRON_14 = 46, IRON_15 = 47, IRON_16 = 48,

    // Gold (49-64)
    GOLD_1 = 49, GOLD_2 = 50, GOLD_3 = 51, GOLD_4 = 52,
    GOLD_5 = 53, GOLD_6 = 54, GOLD_7 = 55, GOLD_8 = 56,
    GOLD_9 = 57, GOLD_10 = 58, GOLD_11 = 59, GOLD_12 = 60,
    GOLD_13 = 61, GOLD_14 = 62, GOLD_15 = 63, GOLD_16 = 64,

    // Sulphur (65-80)
    SULPHUR_1 = 65, SULPHUR_2 = 66, SULPHUR_3 = 67, SULPHUR_4 = 68,
    SULPHUR_5 = 69, SULPHUR_6 = 70, SULPHUR_7 = 71, SULPHUR_8 = 72,
    SULPHUR_9 = 73, SULPHUR_10 = 74, SULPHUR_11 = 75, SULPHUR_12 = 76,
    SULPHUR_13 = 77, SULPHUR_14 = 78, SULPHUR_15 = 79, SULPHUR_16 = 80,

    // Stone Mine (81-96) - underground stone
    STONEMINE_1 = 81, STONEMINE_2 = 82, STONEMINE_3 = 83, STONEMINE_4 = 84,
    STONEMINE_5 = 85, STONEMINE_6 = 86, STONEMINE_7 = 87, STONEMINE_8 = 88,
    STONEMINE_9 = 89, STONEMINE_10 = 90, STONEMINE_11 = 91, STONEMINE_12 = 92,
    STONEMINE_13 = 93, STONEMINE_14 = 94, STONEMINE_15 = 95, STONEMINE_16 = 96,

    // Surface Stone (97-112)
    STONE_1 = 97, STONE_2 = 98, STONE_3 = 99, STONE_4 = 100,
    STONE_5 = 101, STONE_6 = 102, STONE_7 = 103, STONE_8 = 104,
    STONE_9 = 105, STONE_10 = 106, STONE_11 = 107, STONE_12 = 108,
    STONE_13 = 109, STONE_14 = 110, STONE_15 = 111, STONE_16 = 112,

    // Wood/Trees
    WOOD = 113,
}

/** Tree types */
export enum S4TreeType {
    NONE = 0,
    OAK = 1,
    BEECH = 2,
    ASH = 3,
    LINDEN = 4,
    BIRCH = 5,
    POPLAR = 6,
    CHESTNUT = 7,
    MAPLE = 8,
    FIR = 9,
    SPRUCE = 10,
    COCONUT = 11,
    DATE = 12,
    WALNUT = 13,
    CORKOAK = 14,
    PINE = 15,
    PINE2 = 16,
    OLIVE_LARGE = 17,
    OLIVE_SMALL = 18,
}

/** Tribe/race types */
export enum S4Tribe {
    ROMAN = 0,
    VIKING = 1,
    MAYA = 2,
    DARK = 3,
    TROJAN = 4,
}

/** Building types */
export enum S4BuildingType {
    NONE = 0,
    WOODCUTTERHUT = 1,
    FORESTERHUT = 2,
    SAWMILL = 3,
    STONECUTTERHUT = 4,
    WATERWORKHUT = 5,
    FISHERHUT = 6,
    HUNTERHUT = 7,
    SLAUGHTERHOUSE = 8,
    MILL = 9,
    BAKERY = 10,
    GRAINFARM = 11,
    ANIMALRANCH = 12,
    DONKEYRANCH = 13,
    STONEMINE = 14,
    IRONMINE = 15,
    GOLDMINE = 16,
    COALMINE = 17,
    SULFURMINE = 18,
    SMELTGOLD = 19,
    SMELTIRON = 20,
    TOOLSMITH = 21,
    WEAPONSMITH = 22,
    VEHICLEHALL = 23,
    BARRACKS = 24,
    CHARCOALMAKER = 25,
    TRAININGCENTER = 26,
    HEALERHUT = 27,
    AMMOMAKERHUT = 28,
    GUNPOWDERMAKERHUT = 29,
    LANDSCAPEMAKERHUT = 30,
    SHIPYARD = 31,
    PORT = 32,
    MARKETPLACE = 33,
    STORAGEAREA = 34,
    VINYARD = 35,
    AGAVEFARMERHUT = 36,
    TEQUILAMAKERHUT = 37,
    BEEKEEPERHUT = 38,
    MEADMAKERHUT = 39,
    RESIDENCESMALL = 40,
    RESIDENCEMEDIUM = 41,
    RESIDENCEBIG = 42,
    SMALLTEMPLE = 43,
    BIGTEMPLE = 44,
    LOOKOUTTOWER = 45,
    GUARDTOWERSMALL = 46,
    GUARDTOWERBIG = 47,
    CASTLE = 48,
    MUSHROOMFARM = 49,
    DARKTEMPLE = 50,
    FORTRESS = 51,
    // Ports and shipyards variants (52-63)
    // Eyecatchers/decorations (64-75)
    MANACOPTERHALL = 80,
    SUNFLOWEROILMAKERHUT = 81,
    SUNFLOWERFARMERHUT = 82,
}

/** Good/material types */
export enum S4GoodType {
    NONE = 0,
    AGAVE = 1,
    AMMO = 2,
    ARMOR = 3,
    AXE = 4,
    BATTLEAXE = 5,
    BLOWGUN = 6,
    BOARD = 7,
    BOW = 8,
    BREAD = 9,
    COAL = 10,
    FISH = 11,
    FLOUR = 12,
    GOAT = 13,
    GOLDBAR = 14,
    GOLDORE = 15,
    GRAIN = 16,
    GUNPOWDER = 17,
    HAMMER = 18,
    HONEY = 19,
    IRONBAR = 20,
    IRONORE = 21,
    LOG = 22,
    MEAD = 23,
    MEAT = 24,
    PICKAXE = 25,
    PIG = 26,
    ROD = 27,
    SAW = 28,
    SCYTHE = 29,
    SHEEP = 30,
    SHOVEL = 31,
    STONE = 32,
    SULFUR = 33,
    SWORD = 34,
    TEQUILA = 35,
    WATER = 36,
    WINE = 37,
    BACKPACKCATAPULT = 38,
    GOOSE = 39,
    EXPLOSIVEARROW = 40,
    SUNFLOWEROIL = 41,
    SUNFLOWER = 42,
}

/** Settler/unit types */
export enum S4SettlerType {
    NONE = 0,
    CARRIER = 1,
    DIGGER = 2,
    BUILDER = 3,
    WOODCUTTER = 4,
    STONECUTTER = 5,
    FORESTER = 6,
    FARMERGRAIN = 7,
    FARMERANIMALS = 8,
    FISHER = 9,
    WATERWORKER = 10,
    HUNTER = 11,
    SAWMILLWORKER = 12,
    SMELTER = 13,
    MINEWORKER = 14,
    SMITH = 15,
    MILLER = 16,
    BAKER = 17,
    BUTCHER = 18,
    SHIPYARDWORKER = 19,
    HEALER = 20,
    CHARCOALMAKER = 21,
    AMMOMAKER = 22,
    VEHICLEMAKER = 23,
    VINTNER = 24,
    BEEKEEPER = 25,
    MEADMAKER = 26,
    AGAVEFARMER = 27,
    TEQUILAMAKER = 28,
    SWORDSMAN_01 = 29,
    SWORDSMAN_02 = 30,
    SWORDSMAN_03 = 31,
    BOWMAN_01 = 32,
    BOWMAN_02 = 33,
    BOWMAN_03 = 34,
    MEDIC_01 = 35,
    MEDIC_02 = 36,
    MEDIC_03 = 37,
    AXEWARRIOR_01 = 38,
    AXEWARRIOR_02 = 39,
    AXEWARRIOR_03 = 40,
    BLOWGUNWARRIOR_01 = 41,
    BLOWGUNWARRIOR_02 = 42,
    BLOWGUNWARRIOR_03 = 43,
    SQUADLEADER = 44,
    PRIEST = 45,
    SABOTEUR = 46,
    PIONEER = 47,
    THIEF = 48,
    GEOLOGIST = 49,
    GARDENER = 50,
    LANDSCAPER = 51,
    DARKGARDENER = 52,
    MUSHROOMFARMER = 53,
    SHAMAN = 54,
    SLAVED_SETTLER = 55,
    TEMPLE_SERVANT = 56,
    ANGEL_01 = 57,
    ANGEL_02 = 58,
    ANGEL_03 = 59,
    DONKEY = 60,
    BACKPACKCATAPULTIST_01 = 61,
    BACKPACKCATAPULTIST_02 = 62,
    BACKPACKCATAPULTIST_03 = 63,
    SUNFLOWERFARMER = 64,
    SUNFLOWEROILMAKER = 65,
    MANACOPTERMASTER = 66,
}

/**
 * WorldField structure - 4 bytes per tile
 * Based on S4ModApi reverse engineering
 */
export interface WorldField {
    /** Byte 0: Terrain height (0-255) */
    terrainHeight: number;
    /** Byte 1: Ground type (S4GroundType enum) */
    terrainId: number;
    /** Byte 2: Terrain attributes (dark land, pond, sun level) */
    terrainAttributes: number;
    /** Byte 3: Gameplay attributes (fog of war, founding stone) */
    gameplayAttributes: number;
}

/** Parse terrain attributes byte */
export function parseTerrainAttributes(byte: number): {
    isDarkBorder: boolean;
    isDarkLand: boolean;
    isPond: boolean;
    sunLevel: number;
} {
    return {
        isDarkBorder: (byte & 0x80) !== 0,
        isDarkLand: (byte & 0x40) !== 0,
        isPond: (byte & 0x20) !== 0,
        sunLevel: byte & 0x1F,
    };
}

/** Parse gameplay attributes byte */
export function parseGameplayAttributes(byte: number): {
    isFoundingStone: boolean;
    fogOfWarLevel: number;
} {
    return {
        isFoundingStone: (byte & 0x80) !== 0,
        fogOfWarLevel: byte & 0x3F,
    };
}

/** Get human-readable ground type name */
export function getGroundTypeName(type: number): string {
    const names: Record<number, string> = {
        [S4GroundType.WATER1]: 'Water (Shallow)',
        [S4GroundType.WATER2]: 'Water 2',
        [S4GroundType.WATER3]: 'Water 3',
        [S4GroundType.WATER4]: 'Water 4',
        [S4GroundType.WATER5]: 'Water 5',
        [S4GroundType.WATER6]: 'Water 6',
        [S4GroundType.WATER7]: 'Water 7',
        [S4GroundType.WATER8]: 'Water (Deep)',
        [S4GroundType.GRASS]: 'Grass',
        [S4GroundType.GRASS_ROCK]: 'Grass/Rock',
        [S4GroundType.GRASS_ISLE]: 'Grass Isle',
        [S4GroundType.GRASS_DESERT]: 'Grass/Desert',
        [S4GroundType.GRASS_SWAMP]: 'Grass/Swamp',
        [S4GroundType.GRASS_MUD]: 'Grass/Mud',
        [S4GroundType.DARKGRASS]: 'Dark Grass',
        [S4GroundType.DARKGRASS_GRASS]: 'Dark Grass/Grass',
        [S4GroundType.SANDYROAD]: 'Sandy Road',
        [S4GroundType.COBBLEDROAD]: 'Cobbled Road',
        [S4GroundType.ROCK]: 'Rock',
        [S4GroundType.ROCK_GRASS]: 'Rock/Grass',
        [S4GroundType.ROCK_SNOW]: 'Rock/Snow',
        [S4GroundType.BEACH]: 'Beach',
        [S4GroundType.DESERT]: 'Desert',
        [S4GroundType.DESERT_GRASS]: 'Desert/Grass',
        [S4GroundType.SWAMP]: 'Swamp',
        [S4GroundType.SWAMP_GRASS]: 'Swamp/Grass',
        [S4GroundType.RIVER1]: 'River 1',
        [S4GroundType.RIVER2]: 'River 2',
        [S4GroundType.RIVER3]: 'River 3',
        [S4GroundType.RIVER4]: 'River 4',
        [S4GroundType.SNOW]: 'Snow',
        [S4GroundType.SNOW_ROCK]: 'Snow/Rock',
        [S4GroundType.MUD]: 'Mud',
        [S4GroundType.MUD_GRASS]: 'Mud/Grass',
    };
    return names[type] ?? `Unknown (${type})`;
}

type ResourceCategory = 'none' | 'fish' | 'coal' | 'iron' | 'gold' | 'sulphur' | 'stonemine' | 'stone' | 'wood';

/** Resource range definitions: [minValue, maxValue, type, displayName] */
const resourceRanges: [number, number, ResourceCategory, string][] = [
    [1, 16, 'fish', 'Fish'],
    [17, 32, 'coal', 'Coal'],
    [33, 48, 'iron', 'Iron'],
    [49, 64, 'gold', 'Gold'],
    [65, 80, 'sulphur', 'Sulphur'],
    [81, 96, 'stonemine', 'Stone Mine'],
    [97, 112, 'stone', 'Stone'],
    [113, 113, 'wood', 'Wood'],
];

/** Get resource type category and amount from value */
export function parseResourceValue(value: number): { type: ResourceCategory; amount: number; name: string } {
    if (value === 0) return { type: 'none', amount: 0, name: 'None' };
    for (const [min, max, type, displayName] of resourceRanges) {
        if (value >= min && value <= max) {
            const amount = value - min + 1;
            return { type, amount, name: `${displayName} (${amount})` };
        }
    }
    return { type: 'none', amount: 0, name: `Unknown (${value})` };
}

/** Ground type to color mapping */
const groundColorMap: Record<number, [number, number, number]> = {
    [S4GroundType.GRASS]: [80, 140, 60],
    [S4GroundType.GRASS_ROCK]: [100, 130, 70],
    [S4GroundType.GRASS_ISLE]: [90, 150, 70],
    [S4GroundType.GRASS_DESERT]: [130, 150, 80],
    [S4GroundType.GRASS_SWAMP]: [70, 120, 70],
    [S4GroundType.GRASS_MUD]: [90, 110, 60],
    [S4GroundType.DARKGRASS]: [50, 100, 40],
    [S4GroundType.DARKGRASS_GRASS]: [65, 120, 50],
    [S4GroundType.SANDYROAD]: [180, 160, 120],
    [S4GroundType.COBBLEDROAD]: [140, 130, 120],
    [S4GroundType.ROCK]: [130, 130, 140],
    [S4GroundType.ROCK_GRASS]: [110, 130, 100],
    [S4GroundType.ROCK_SNOW]: [160, 160, 170],
    [S4GroundType.BEACH]: [220, 200, 150],
    [S4GroundType.DESERT]: [200, 180, 120],
    [S4GroundType.DESERT_GRASS]: [170, 170, 100],
    [S4GroundType.SWAMP]: [60, 80, 50],
    [S4GroundType.SWAMP_GRASS]: [70, 100, 60],
    [S4GroundType.RIVER1]: [60, 120, 180],
    [S4GroundType.RIVER2]: [60, 120, 180],
    [S4GroundType.RIVER3]: [60, 120, 180],
    [S4GroundType.RIVER4]: [60, 120, 180],
    [S4GroundType.SNOW]: [240, 245, 250],
    [S4GroundType.SNOW_ROCK]: [200, 200, 210],
    [S4GroundType.MUD]: [100, 80, 60],
    [S4GroundType.MUD_GRASS]: [100, 100, 60],
};

/** Get terrain color for visualization */
export function getGroundTypeColor(type: number): [number, number, number] {
    // Water types (0-7) use gradient
    if (type >= 0 && type <= 7) {
        const depth = type / 7;
        return [
            Math.floor(40 - depth * 20),
            Math.floor(100 + depth * 20),
            Math.floor(160 + depth * 40),
        ];
    }
    return groundColorMap[type] ?? [100, 100, 100];
}
