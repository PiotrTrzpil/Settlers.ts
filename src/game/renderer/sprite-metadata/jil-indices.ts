/**
 * JIL job index constants for GFX files.
 *
 * JIL (Job Index List) indices identify animation jobs that go through
 * the JIL→DIL→GIL pipeline: JIL maps job IDs to DIL entries,
 * DIL maps directions to GIL frame sequences, GIL maps to actual GFX images.
 *
 * @module renderer/sprite-metadata/jil-indices
 */

import { BuildingType, UnitType, getLevelVariants } from '../../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { EMaterialType } from '../../economy';

// ============================================================
// Unit job indices — settler files (20-24.jil)
// ============================================================

/**
 * Settler job indices for various professions and their animation states.
 * These are in settler files (20-24.jil).
 *
 * All values are plain numbers (JIL job indices). Field naming uses balanced specificity:
 * - Single value → generic name (walk, carry, work, fight, pickup, idle)
 * - Multiple values of same type → numbered (work_1, work_2, carry_1, carry_2)
 * - Semantically distinct actions → named (work_chop, work_cut, work_shoot_1)
 *
 * Consumers use prefix matching to collect related fields:
 * e.g. all fields starting with "work" are work animations.
 */
export const SETTLER_JOB_INDICES = {
    carrier: {
        walk: 1,
        idle_1: 44,
        idle_2: 45,
        idle_3: 46,
        idle_4: 47,
        work_strike: 48,
        work_strik_walk: 49,
    },
    digger: {
        walk: 50,
        work: 51,
    },
    builder: {
        walk: 52, // Walk cycle (same animation also at job 53)
        work: 53,
    },
    woodcutter: {
        walk: 54,
        carry: 55, // carrying log
        work_chop: 56, // chopping standing tree
        work_cut: 57, // cutting fallen log
    },
    stonecutter: {
        walk: 58,
        work: 59,
        pickup: 60,
        carry: 61,
    },
    forester: {
        walk: 62,
        carry: 63,
        work: 64,
    },
    // Farmer (grain, agave farmer, beekeeper share same sprites)
    farmer: {
        walk: 65,
        carry: 66,
        work_walk_with_seed: 67,
        work_seed: 68,
        work_scythe: 69,
        pickup: 70,
    },
    // FA_ = FarmerAnimals (SETTLER_FARMERANIMALS) — animal rancher (AnimalRanch + DonkeyRanch)
    animal_farmer: {
        walk: 72,
        carry_water: 73,
        carry_grain: 74,
        pickup_water: 75,
        pickup_grain: 76,
        carry_empty: 78,
        work: 79,
    },
    fisher: {
        walk: 80,
        carry_fish: 81,
        work_1: 82,
        work_2: 83,
        work_3: 84,
        work_4: 85,
    },
    water_worker: {
        walk: 86,
        carry_empty: 87,
        carry_water: 88,
        pickup_water: 89,
        work: 90,
    },
    hunter: {
        walk: 91,
        carry: 92,
        pickup_meat: 93,
        pickup_animal: 94,
        work: 95,
    },
    sawmill_worker: {
        walk: 96,
        carry_log: 97,
        carry_board: 98,
        work: 99,
        pickup_log: 100,
        pickup_board: 101,
    },
    smelter: {
        walk: 102,
        carry_coal: 103,
        carry_goldbar: 104,
        carry_goldore: 105,
        carry_ironbar: 106,
        carry_ironore: 107,
        work_iron: 108,
        pickup_goldbar: 109,
        work_gold: 110,
        pickup_ironbar: 111,
        pickup_coal: 112,
        pickup_ironore: 113,
    },
    miner: {
        walk: 114, // M_WALK
        walk_1: 115, // M_PUSHIN — empty cart back (coal)
        walk_2: 116, // M_PUSHIN — empty cart back (ironore)
        walk_3: 117, // M_PUSHIN — empty cart back (goldore)
        walk_4: 118, // M_PUSHIN — empty cart back (stone)
        walk_5: 119, // M_PUSHIN — empty cart back (sulfur)
        carry_coal: 120, // M_PUSHOUT_COAL — full cart out
        carry_ironore: 121, // M_PUSHOUT_IRONORE
        carry_goldore: 122, // M_PUSHOUT_GOLDORE
        carry_stone: 123, // M_PUSHOUT_STONE
        carry_sulfur: 124, // M_PUSHOUT_SULFUR
        work_coal: 125, // M_TIP_COAL — dump cart
        work_ironore: 126, // M_TIP_IRONORE
        work_goldore: 127, // M_TIP_GOLDORE
        work_stone: 128, // M_TIP_STONE
        work_sulfur: 129, // M_TIP_SULFUR
    },
    smith: {
        walk: 130,
        work_1: 130,
        work_2: 131,
        work_3: 132,
        work_4: 133,
        work_5: 134,
        work_6: 135,
        work_7: 136,
        pickup_1: 137,
        pickup_2: 138,
        pickup_3: 139,
    },
    miller: {
        walk: 140,
        carry_grain: 141,
        carry_flour: 142,
        pickup_grain: 143,
        pickup_flour: 144,
    },
    baker: {
        walk: 145,
        carry_flour: 146,
        carry_bread: 147,
        carry_empty: 148,
        carry_unbaked_bread: 149,
        carry_water: 150,
        work_bread: 151,
        work_unbaked_bread: 152,
        work_empty: 153,
        pickup_water: 154,
        pickup_flour: 155,
    },
    butcher: {
        walk: 156,
        carry_meat: 157,
        carry_animal: 158,
        pickup_meat: 159,
        pickup_animal: 160,
    },
    unknown_worker: {
        walk: 161,
        carry_board: 162,
        carry_stone: 163,
        pickup_board: 164,
        pickup_stone: 165,
        work: 166,
    },
    healer: {
        walk: 167,
        work: 168,
    },
    ammunition_maker: {
        walk: 174,
        carry_coal: 175,
        carry_sulfur: 176,
        carry_ammo: 178,
        pickup_coal: 179,
        pickup_sulfur: 180,
        pickup_ammo: 182,
        work: 166,
    },
    shipyard_worker: {
        walk: 183,
        carry_stone: 184,
        carry_stone2: 185,
        carry_board: 186,
        work: 187,
        pickup_stone: 188,
        pickup_stone2: 190,
        pickup_board: 189,
    },
    wine_maker: {
        walk: 191,
        carry_1: 192,
        carry_2: 193,
        carry_3: 194,
        carry_4: 195,
        work_1: 196,
        work_2: 197,
        pickup: 198,
    },
    beekeeper: {
        walk: 199,
        carry_1: 200,
        carry_2: 201,
        work_1: 202,
        work_2: 203,
        work_3: 204,
        work_4: 205,
    },
    mead_maker: {
        walk: 206,
        carry_1: 207,
        carry_2: 208,
        carry_3: 209,
        pickup_1: 210,
        pickup_2: 211,
        pickup_3: 212,
    },
    agave_farmer: {
        walk: 213,
        carry: 214,
        work_1: 215,
        work_2: 216,
        work_3: 217,
        work_4: 218,
        work_5: 219,
    },
    tequila_maker: {
        walk: 220,
        carry_1: 221,
        carry_2: 222,
        carry_3: 223,
        pickup_1: 224,
        pickup_2: 225,
        pickup_3: 226,
    },
    swordsman_1: {
        walk: 227,
        fight: 228,
    },
    swordsman_2: {
        walk: 230,
        fight: 231,
    },
    swordsman_3: {
        walk: 233,
        fight: 234,
    },
    // Bowman levels (work entries are shooting animations; fight reuses shooting)
    bowman_1: {
        walk: 236,
        work_shoot_1: 237,
        work_shoot_2: 238,
        work_shoot_3: 239,
        work_shoot_4: 240,
        fight: 237, // shooting = fighting
    },
    bowman_2: {
        walk: 242,
        work_shoot_1: 243,
        work_shoot_2: 244,
        work_shoot_3: 245,
        work_shoot_4: 246,
        fight: 243,
    },
    bowman_3: {
        walk: 248,
        work_shoot_1: 249,
        work_shoot_2: 250,
        work_shoot_3: 251,
        work_shoot_4: 252,
        fight: 249,
    },
    // Specialists for romans and vikings
    // NOTE: mayans and trojans have their specialist under separate indices
    specialist_1: {
        walk: 254,
        work: 255,
        fight: 256,
    },
    specialist_2: {
        walk: 258,
        work: 259,
        fight: 260,
    },
    specialist_3: {
        walk: 262,
        work: 263,
        fight: 264,
    },

    // Mayan specialist
    blowgun_warrior_1: {
        walk: 275,
        fight: 276,
    },
    blowgun_warrior_2: {
        walk: 278,
        fight: 279,
    },
    blowgun_warrior_3: {
        walk: 281,
        fight: 282,
    },

    // Trojan specialist
    catapultist_1: {
        walk: 341,
        fight: 342,
    },
    catapultist_2: {
        walk: 344,
        fight: 345,
    },
    catapultist_3: {
        walk: 346,
        fight: 347,
    },

    squad_leader: {
        walk: 284,
        fight: 285,
    },
    priest: {
        walk: 287,
        work: 288,
    },

    saboteur: {
        walk: 290,
        work_1: 291,
        work_2: 292,
        work_3: 293,
        work_4: 294,
        work_5: 295,
        work_6: 296,
        work_7: 297,
    },
    pioneer: {
        walk: 298,
        work_1: 299,
        work_2: 300,
    },
    thief: {
        walk: 301,
        carry: 302,
        work_1: 303,
        work_2: 304,
    },
    geologist: {
        walk: 305,
        work_1: 306,
        work_2: 307,
    },
    gardener: {
        walk: 308,
        work_1: 309,
        work_2: 310,
    },
    temple_servant: {
        walk: 328,
        carry: 329,
        pickup: 330,
        work: 331,
    },
    angel_1: {
        idle: 333,
    },
    angel_2: {
        idle: 334,
    },
    angel_3: {
        idle: 335,
    },

    // All races have the same donkey (duplicates).
    // But file 24 has additional donkey fight animation
    donkey: {
        walk: 336,
        idle: 337,
        carry_1: 338,
        carry_2: 339,
        fight: 340,
    },

    // trojan only
    sunflower_farmer: {
        walk: 350,
        carry_sunflower: 351,
        carry_plant: 352,
        carry_waterer: 353,

        work_plant: 354,
        work_sunflower: 355,
        work_water: 356,
        pickup_sunflower: 357,
    },
    oil_maker: {
        walk: 358,
        carry_sunfloweroil: 359,
        carry_sunflower: 360,
        pickup_sunflower: 361,
    },

    // Mushroom farmer (Dark Tribe specific, file 23.jil)
    mushroom_farmer: {
        walk: 313,
        work: 314,
    },
    dark_carrier: {
        walk: 315,
        carry: 316,
        work_1: 317,
        work_2: 318,
        work_3: 319,
        work_4: 320,
        work_5: 321,
        work_6: 322,
    },
    shaman: {
        walk: 323,
        work: 324,
    },
    slaved_settler: {
        walk: 325,
        work_1: 326,
        work_2: 327,
    },
    manacopter_master: {
        walk: 363,
        fight: 364,
        work: 365,
    },
} as const;

/**
 * Mapping from SETTLER_JOB_INDICES keys to UnitType.
 * Each level maps to a distinct UnitType (e.g. swordsman_2 → UnitType.Swordsman2).
 * specialist_1/2/3 map to Medic (Roman) and are reused for AxeWarrior (Viking) via
 * UNIT_BASE_JOB_INDICES. Other race specialists have their own keys:
 * blowgun_warrior_* (Mayan), catapultist_* (Trojan).
 */
export const SETTLER_KEY_TO_UNIT_TYPE: Readonly<Record<string, UnitType>> = {
    carrier: UnitType.Carrier,
    digger: UnitType.Digger,
    smith: UnitType.Smith,
    builder: UnitType.Builder,
    woodcutter: UnitType.Woodcutter,
    miner: UnitType.Miner,
    forester: UnitType.Forester,
    farmer: UnitType.Farmer,
    agave_farmer: UnitType.AgaveFarmer,
    beekeeper: UnitType.Beekeeper,
    priest: UnitType.Priest,
    geologist: UnitType.Geologist,
    pioneer: UnitType.Pioneer,
    swordsman_1: UnitType.Swordsman,
    swordsman_2: UnitType.Swordsman2,
    swordsman_3: UnitType.Swordsman3,
    bowman_1: UnitType.Bowman,
    bowman_2: UnitType.Bowman2,
    bowman_3: UnitType.Bowman3,
    sawmill_worker: UnitType.SawmillWorker,
    miller: UnitType.Miller,
    baker: UnitType.Baker,
    butcher: UnitType.Butcher,
    animal_farmer: UnitType.AnimalFarmer,
    water_worker: UnitType.Waterworker,
    healer: UnitType.Healer,
    sunflower_farmer: UnitType.SunflowerFarmer,
    mushroom_farmer: UnitType.MushroomFarmer,
    thief: UnitType.Thief,
    squad_leader: UnitType.SquadLeader,
    specialist_1: UnitType.Medic,
    specialist_2: UnitType.Medic2,
    specialist_3: UnitType.Medic3,
    catapultist_1: UnitType.BackpackCatapultist,
    catapultist_2: UnitType.BackpackCatapultist2,
    catapultist_3: UnitType.BackpackCatapultist3,
    angel_1: UnitType.Angel,
    angel_2: UnitType.Angel2,
    angel_3: UnitType.Angel3,
    shaman: UnitType.Shaman,
    dark_carrier: UnitType.Carrier, // Dark Tribe carrier — same UnitType, different race GFX file
    gardener: UnitType.DarkGardener,
    hunter: UnitType.Hunter,
    stonecutter: UnitType.Stonecutter,
    smelter: UnitType.Smelter,
    donkey: UnitType.Donkey,
    blowgun_warrior_1: UnitType.BlowgunWarrior,
    blowgun_warrior_2: UnitType.BlowgunWarrior2,
    blowgun_warrior_3: UnitType.BlowgunWarrior3,
    wine_maker: UnitType.Winemaker,
    mead_maker: UnitType.Meadmaker,
    tequila_maker: UnitType.Tequilamaker,
    saboteur: UnitType.Saboteur,
    temple_servant: UnitType.TempleServant,
    manacopter_master: UnitType.ManacopterMaster,
    slaved_settler: UnitType.SlavedSettler,
};

/** Type alias for a settler's animation data — all fields are plain numbers. */
export type SettlerAnimData = Readonly<Record<string, number>>;

/** Extract the first numeric index from a walk or idle/idle_* field. */
function extractBaseIndex(data: SettlerAnimData): number | undefined {
    if ('walk' in data) return data['walk'];
    if ('idle' in data) return data['idle'];
    // Check for prefixed idle fields (e.g. idle_1)
    for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('idle_')) return value;
    }
    return undefined;
}

/**
 * Collect all JIL job indices from fields matching a prefix.
 * Matches exact name (e.g. "work") and underscore-suffixed variants (e.g. "work_chop", "work_1").
 * Returns values in Object.entries() order (insertion order).
 */
export function collectFieldsByPrefix(data: SettlerAnimData, prefix: string): number[] {
    const results: number[] = [];
    for (const [key, value] of Object.entries(data)) {
        if (key === prefix || key.startsWith(`${prefix}_`)) {
            results.push(value);
        }
    }
    return results;
}

/** A JIL field with its parsed suffix and job index. */
export interface SuffixedField {
    /** Material/variant suffix: 'coal', 'iron', '0' (generic), '1' (numbered). */
    suffix: string;
    /** JIL job index. */
    jobIndex: number;
}

/**
 * Collect all JIL fields matching a prefix, preserving the suffix for material-aware keying.
 *
 * Field name → suffix:
 *   'pickup'       → '0'       (generic — no material distinction)
 *   'pickup_coal'  → 'coal'    (material-specific)
 *   'pickup_1'     → '0','1'   (numbered — sequential index, not a material name)
 *   'carry_iron'   → 'iron'
 */
export function collectFieldsWithSuffix(data: SettlerAnimData, prefix: string): SuffixedField[] {
    const results: SuffixedField[] = [];
    let numberedCount = 0;
    for (const [key, value] of Object.entries(data)) {
        if (key === prefix) {
            results.push({ suffix: '0', jobIndex: value });
        } else if (key.startsWith(`${prefix}_`)) {
            const raw = key.slice(prefix.length + 1);
            // Numbered fields (pickup_1, carry_2) → sequential index
            const suffix = /^\d+$/.test(raw) ? String(numberedCount++) : raw;
            results.push({ suffix, jobIndex: value });
        }
    }
    return results;
}

/** Non-material carry/pickup suffixes — visual states, not transportable goods. */
const NON_MATERIAL_SUFFIXES: ReadonlySet<string> = new Set([
    'empty',
    'unbaked_bread',
    'plant',
    'waterer', // Visual carry states (no material being transported)
    'animal', // Hunter pickup / butcher carry (race-dependent animal, not a single material)
    'stone2', // Shipyard stone variant (second stone carry animation)
]);

/**
 * Parse a JIL field suffix as an EMaterialType.
 *
 * Suffixes must match EMaterialType names exactly (lowercased):
 *   'coal' → EMaterialType.COAL, 'ironore' → EMaterialType.IRONORE, etc.
 *
 * Returns null for numbered variants ('0', '1') and known non-material suffixes.
 * Throws for unrecognised suffixes — catches naming errors in jil-indices.ts.
 */
export function parseMaterialSuffix(suffix: string): EMaterialType | null {
    if (/^\d+$/.test(suffix)) return null;
    if (NON_MATERIAL_SUFFIXES.has(suffix)) return null;
    const value = EMaterialType[suffix.toUpperCase() as keyof typeof EMaterialType] as EMaterialType | undefined;
    if (value === undefined) {
        throw new Error(
            `JIL field suffix '${suffix}' does not match any EMaterialType. ` +
                `Rename the field in jil-indices.ts to use the exact EMaterialType name (lowercased).`
        );
    }
    return value;
}

/**
 * Get the first value matching a prefix, or undefined if no match.
 * Useful for fields like carry that may be "carry" or "carry_1".
 */
export function getFirstFieldByPrefix(data: SettlerAnimData, prefix: string): number | undefined {
    if (prefix in data) return data[prefix];
    for (const [key, value] of Object.entries(data)) {
        if (key.startsWith(`${prefix}_`)) return value;
    }
    return undefined;
}

/**
 * Derive the base JIL job index per UnitType from SETTLER_JOB_INDICES.
 * Prefers walk over idle-only. Each level variant gets its own entry.
 */
function computeUnitBaseJobIndices(): Partial<Record<UnitType, number>> {
    const result: Partial<Record<UnitType, number>> = {};
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        if (result[unitType] !== undefined) continue;

        const baseIdx = extractBaseIndex(workerData as Record<string, number>);
        if (baseIdx !== undefined && baseIdx >= 0) {
            result[unitType] = baseIdx;
        }
    }
    return result;
}

/**
 * Base JIL job index per UnitType, derived from SETTLER_JOB_INDICES.
 * Used by getUnitSpriteMap() and icon loading to find the default sprite for each unit.
 *
 * AxeWarrior (Viking) shares specialist_1/2/3 JIL indices with Medic —
 * each race's GFX file has different art at those slots.
 */
export const UNIT_BASE_JOB_INDICES: Partial<Record<UnitType, number>> = (() => {
    const base = computeUnitBaseJobIndices();
    // AxeWarrior (Viking) shares specialist_1/2/3 JIL indices with Medic
    const axeVariants = getLevelVariants(UnitType.AxeWarrior)!;
    const medicVariants = getLevelVariants(UnitType.Medic)!;
    for (let i = 0; i < 3; i++) {
        base[axeVariants[i]!] = base[medicVariants[i]!]!;
    }
    return base;
})();

// ============================================================
// Building job indices
// ============================================================

/**
 * Mapping from BuildingType to JIL job index.
 * The job index is the same across all race files - only the GFX file number differs.
 * These indices map to building sprites via JIL -> DIL -> GIL -> GFX.
 */
export const BUILDING_JOB_INDICES: Partial<Record<BuildingType, number>> = {
    // JIL indices match S4BuildingType values from s4-types.ts
    // Reference: src/resources/map/s4-types.ts S4BuildingType enum
    //
    // Full JIL index map for building files (10-14.gfx per race):
    //   0  = Construction phase placeholder ("BUILD PHASE" text)
    //   1-48 = Standard buildings (see S4BuildingType enum)
    //   49-51 = Race-specific buildings (MushroomFarm, DarkTemple, Fortress)
    //   52-57 = Port orientations (stone tower + large dock, 6 coastal directions)
    //   58-63 = Shipyard orientations (building with red door + dock, 6 coastal directions)
    //   64-65 = Decoration / Eyecatcher02 (mapped below)
    //   66 = Decoration: Roman eagle standard / banner pole
    //   67 = Decoration: Stone obelisk / monument
    //   68 = Decoration: Garden bench
    //   69 = Decoration: Green arch / gateway
    //   70 = Decoration: Eyecatcher07 on post
    //   71 = Decoration: Ivy-covered stone gate
    //   72 = Decoration: Ornate stone arch with ivy
    //   73 = Decoration: Fire basket / torch (animated, 10 frames)
    //   74 = Decoration: Horse rider statue
    //   75 = Decoration: Exotic plant on pedestal
    //   76-77 = Shipyard orientations (2 additional coastal directions)
    //   78-79 = Port orientations (2 additional coastal directions)

    [BuildingType.WoodcutterHut]: 1, // S4BuildingType.WOODCUTTERHUT
    [BuildingType.ForesterHut]: 2, // S4BuildingType.FORESTERHUT
    [BuildingType.Sawmill]: 3, // S4BuildingType.SAWMILL
    [BuildingType.StonecutterHut]: 4, // S4BuildingType.STONECUTTERHUT
    [BuildingType.WaterworkHut]: 5, // S4BuildingType.WATERWORKHUT
    [BuildingType.FisherHut]: 6, // S4BuildingType.FISHERHUT
    [BuildingType.HunterHut]: 7, // S4BuildingType.HUNTERHUT
    [BuildingType.Slaughterhouse]: 8, // S4BuildingType.SLAUGHTERHOUSE
    [BuildingType.Mill]: 9, // S4BuildingType.MILL
    [BuildingType.Bakery]: 10, // S4BuildingType.BAKERY
    [BuildingType.GrainFarm]: 11, // S4BuildingType.GRAINFARM
    [BuildingType.AnimalRanch]: 12, // S4BuildingType.ANIMALRANCH
    [BuildingType.DonkeyRanch]: 13, // S4BuildingType.DONKEYRANCH
    [BuildingType.StoneMine]: 14, // S4BuildingType.STONEMINE
    [BuildingType.IronMine]: 15, // S4BuildingType.IRONMINE
    [BuildingType.GoldMine]: 16, // S4BuildingType.GOLDMINE
    [BuildingType.CoalMine]: 17, // S4BuildingType.COALMINE
    [BuildingType.SulfurMine]: 18, // S4BuildingType.SULFURMINE
    [BuildingType.SmeltGold]: 19, // S4BuildingType.SMELTGOLD
    [BuildingType.IronSmelter]: 20, // S4BuildingType.SMELTIRON
    [BuildingType.ToolSmith]: 21, // S4BuildingType.TOOLSMITH
    [BuildingType.WeaponSmith]: 22, // S4BuildingType.WEAPONSMITH
    [BuildingType.SiegeWorkshop]: 23, // S4BuildingType.VEHICLEHALL
    [BuildingType.Barrack]: 24, // S4BuildingType.BARRACKS
    // 25 = CHARCOALMAKER (no JIL entry in Roman, race-specific?)
    [BuildingType.HealerHut]: 27, // S4BuildingType.HEALERHUT
    [BuildingType.AmmunitionMaker]: 28, // S4BuildingType.AMMOMAKERHUT
    // 29 = GUNPOWDERMAKERHUT (no JIL entry in Roman)
    // 30 = LANDSCAPEMAKERHUT — stone building with gate (not in BuildingType)
    [BuildingType.Shipyard]: 58, // S4BuildingType.SHIPYARD (base job 31 is empty; using first oriented variant)
    // 32 = PORT (base index; oriented variants at 52-57, 78-79; not in BuildingType)
    // 33 = MARKETPLACE — circular trading area with goods (not in BuildingType)
    [BuildingType.StorageArea]: 34, // S4BuildingType.STORAGEAREA
    [BuildingType.Vinyard]: 35, // S4BuildingType.VINYARD (Roman)
    [BuildingType.AgaveFarmerHut]: 36, // S4BuildingType.AGAVEFARMERHUT (Mayan)
    [BuildingType.TequilaMakerHut]: 37, // S4BuildingType.TEQUILAMAKERHUT (Mayan)
    [BuildingType.BeekeeperHut]: 38, // S4BuildingType.BEEKEEPERHUT (Viking)
    [BuildingType.MeadMakerHut]: 39, // S4BuildingType.MEADMAKERHUT (Viking)
    [BuildingType.ResidenceSmall]: 40, // S4BuildingType.RESIDENCESMALL
    [BuildingType.ResidenceMedium]: 41, // S4BuildingType.RESIDENCEMEDIUM
    [BuildingType.ResidenceBig]: 42, // S4BuildingType.RESIDENCEBIG
    [BuildingType.SmallTemple]: 43, // S4BuildingType.SMALLTEMPLE
    [BuildingType.LargeTemple]: 44, // S4BuildingType.BIGTEMPLE
    [BuildingType.LookoutTower]: 45, // S4BuildingType.LOOKOUTTOWER
    [BuildingType.GuardTowerSmall]: 46, // S4BuildingType.GUARDTOWERSMALL
    [BuildingType.GuardTowerBig]: 47, // S4BuildingType.GUARDTOWERBIG
    [BuildingType.Castle]: 48, // S4BuildingType.CASTLE
    // Dark Tribe unique buildings (file 13.jil reuses slots 40-42; DarkTribe has no residences)
    [BuildingType.MushroomFarm]: 40, // DarkTribe: slot 40 (RESIDENCESMALL in other races)
    [BuildingType.Fortress]: 41, // DarkTribe: slot 41 (RESIDENCEMEDIUM in other races)
    [BuildingType.DarkTemple]: 42, // DarkTribe: slot 42 (RESIDENCEBIG in other races)
    [BuildingType.ManaCopterHall]: 80, // DarkTribe: S4BuildingType.MANACOPTERHALL
    [BuildingType.Eyecatcher01]: 64, // EYECATCHER01: candelabra/torches
    [BuildingType.Eyecatcher02]: 65, // EYECATCHER02: tall column with statue
    [BuildingType.Eyecatcher03]: 66, // EYECATCHER03: Roman eagle standard / banner pole
    [BuildingType.Eyecatcher04]: 67, // EYECATCHER04: stone obelisk / monument
    [BuildingType.Eyecatcher05]: 68, // EYECATCHER05: garden bench
    [BuildingType.Eyecatcher06]: 69, // EYECATCHER06: green arch / gateway
    [BuildingType.Eyecatcher07]: 70, // EYECATCHER07: birdhouse on post
    [BuildingType.Eyecatcher08]: 71, // EYECATCHER08: ivy-covered stone gate
    [BuildingType.Eyecatcher09]: 72, // EYECATCHER09: ornate stone arch with ivy
    [BuildingType.Eyecatcher10]: 73, // EYECATCHER10: fire basket / torch (animated)
    [BuildingType.Eyecatcher11]: 74, // EYECATCHER11: horse rider statue
    [BuildingType.Eyecatcher12]: 75, // EYECATCHER12: exotic plant on pedestal
    // Trojan-specific (high S4BuildingType indices)
    [BuildingType.SunflowerOilMakerHut]: 81, // S4BuildingType.SUNFLOWEROILMAKERHUT (Trojan)
    [BuildingType.SunflowerFarmerHut]: 82, // S4BuildingType.SUNFLOWERFARMERHUT (Trojan)
};

// ============================================================
// Resource job indices — file 3.jil
// ============================================================

/**
 * Mapping from EMaterialType to JIL job index in file 3.jil (resources).
 * JIL indices match S4GoodType values (alphabetically ordered goods).
 * Reference: src/resources/map/s4-types.ts S4GoodType enum.
 */
export const RESOURCE_JOB_INDICES: Partial<Record<EMaterialType, number>> = {
    // S4GoodType values are the JIL job indices (alphabetically ordered)
    [EMaterialType.AGAVE]: 1, // S4GoodType.AGAVE
    [EMaterialType.AMMO]: 2, // S4GoodType.AMMO (crossbow bolts)
    [EMaterialType.ARMOR]: 3, // S4GoodType.ARMOR
    [EMaterialType.AXE]: 4, // S4GoodType.AXE
    [EMaterialType.BATTLEAXE]: 5, // S4GoodType.BATTLEAXE
    [EMaterialType.BLOWGUN]: 6, // S4GoodType.BLOWGUN
    [EMaterialType.BOARD]: 7, // S4GoodType.BOARD
    [EMaterialType.BOW]: 8, // S4GoodType.BOW
    [EMaterialType.BREAD]: 9, // S4GoodType.BREAD
    [EMaterialType.COAL]: 10, // S4GoodType.COAL
    [EMaterialType.FISH]: 11, // S4GoodType.FISH
    [EMaterialType.FLOUR]: 12, // S4GoodType.FLOUR
    [EMaterialType.GOAT]: 13, // S4GoodType.GOAT
    [EMaterialType.GOLDBAR]: 14, // S4GoodType.GOLDBAR
    [EMaterialType.GOLDORE]: 15, // S4GoodType.GOLDORE
    [EMaterialType.GRAIN]: 16, // S4GoodType.GRAIN
    [EMaterialType.GUNPOWDER]: 17, // S4GoodType.GUNPOWDER
    [EMaterialType.HAMMER]: 18, // S4GoodType.HAMMER
    [EMaterialType.HONEY]: 19, // S4GoodType.HONEY
    [EMaterialType.IRONBAR]: 20, // S4GoodType.IRONBAR
    [EMaterialType.IRONORE]: 21, // S4GoodType.IRONORE
    [EMaterialType.LOG]: 22, // S4GoodType.LOG
    [EMaterialType.MEAD]: 23, // S4GoodType.MEAD
    [EMaterialType.MEAT]: 24, // S4GoodType.MEAT
    [EMaterialType.PICKAXE]: 25, // S4GoodType.PICKAXE
    [EMaterialType.PIG]: 26, // S4GoodType.PIG
    [EMaterialType.ROD]: 27, // S4GoodType.ROD
    [EMaterialType.SAW]: 28, // S4GoodType.SAW
    [EMaterialType.SCYTHE]: 29, // S4GoodType.SCYTHE
    [EMaterialType.SHEEP]: 30, // S4GoodType.SHEEP
    [EMaterialType.SHOVEL]: 31, // S4GoodType.SHOVEL
    [EMaterialType.STONE]: 32, // S4GoodType.STONE
    [EMaterialType.SULFUR]: 33, // S4GoodType.SULFUR
    [EMaterialType.SWORD]: 34, // S4GoodType.SWORD
    [EMaterialType.TEQUILA]: 35, // S4GoodType.TEQUILA
    [EMaterialType.WATER]: 36, // S4GoodType.WATER
    [EMaterialType.WINE]: 37, // S4GoodType.WINE
    [EMaterialType.CATAPULT]: 38, // Siege ammunition
    [EMaterialType.GOOSE]: 39, // Livestock (geese)
    // 40 = EXPLOSIVEARROW (not in EMaterialType)
    [EMaterialType.SUNFLOWEROIL]: 41, // S4GoodType.SUNFLOWEROIL
    [EMaterialType.SUNFLOWER]: 42, // S4GoodType.SUNFLOWER
};

/**
 * JIL job indices for carriers carrying specific materials, in settler files (20-24.jil).
 * Each material a carrier can carry has its own set of 6-direction walk frames.
 *
 * Job 1 is the empty carrier (walk index in SETTLER_JOB_INDICES.carrier).
 * Carrier job indices follow the same pattern as resource JIL indices (3.jil) but +1.
 * E.g., AGAVE resource is job #1, carrier with AGAVE is job #2.
 */
export const CARRIER_MATERIAL_JOB_INDICES: Partial<Record<EMaterialType, number>> = Object.fromEntries(
    Object.entries(RESOURCE_JOB_INDICES).map(([type, idx]) => [Number(type), idx + 1])
) as Partial<Record<EMaterialType, number>>;

// ============================================================
// Building overlay job indices — same GFX file as the building
// ============================================================

/**
 * Entry in the overlay JIL index table.
 * `null` = not yet identified. Otherwise:
 * - `job`: JIL job index. Omit to reuse the parent building's job.
 * - `dir`: DIL direction index. Default: 0.
 */
export interface OverlayJilEntry {
    readonly job?: number;
    readonly dir?: number;
}

/**
 * Resolve an OverlayJilEntry to { jobIndex, directionIndex }.
 * Returns null for unmapped entries (null) or if parentJobIndex is missing for a parent-relative entry.
 */
export function resolveOverlayJilEntry(
    entry: OverlayJilEntry | null,
    parentJobIndex?: number
): { jobIndex: number; directionIndex: number } | null {
    if (!entry) return null;
    const jobIndex = entry.job ?? parentJobIndex;
    if (jobIndex === undefined) return null;
    return { jobIndex, directionIndex: entry.dir ?? 0 };
}

/**
 * JIL job index for building overlay animations (smoke, fire, wheels, etc.).
 * Overlays share the GFX file with their building (file = Race as number, e.g. 10 for Roman).
 *
 * Entries are `null` for overlays not yet identified — fill in after inspecting
 * the building GFX files. Names come from the <job> field in buildingInfo.xml.
 */
export const BUILDING_OVERLAY_JIL_INDICES: Readonly<Record<string, OverlayJilEntry | null>> = {
    // TODO: fill in actual JIL indices after inspecting the building GFX files
    BUILDING_AMMOMAKERHUT_EXPLOSION: null,
    BUILDING_ANIMALRANCH_ANIMAL1: { dir: 2 },
    BUILDING_ANIMALRANCH_ANIMAL2: { dir: 3 },
    BUILDING_ANIMALRANCH_ANIMAL3: { dir: 4 },
    BUILDING_ANIMALRANCH_ANIMAL4: { dir: 5 },
    BUILDING_ANIMALRANCH_ANIMAL5: { dir: 6 },
    BUILDING_ANIMALRANCH_ANIMAL6: { dir: 7 },
    BUILDING_BAKERY_DOOR: null,
    BUILDING_BAKERY_FIRE: null,
    BUILDING_BAKERY_OPENDOOR: null,
    BUILDING_BAKERY_OVEN: { dir: 4 },
    BUILDING_BAKERY_POLLER: { dir: 3 },
    BUILDING_BAKERY_SIGN: { dir: 2 },
    BUILDING_BARRACKS_ANIMPUPPET: null,
    BUILDING_BIGTEMPLE_ANIM: null,
    BUILDING_CASTLE_DOOR: null,
    BUILDING_CASTLE_FRONTWALL: null,
    BUILDING_CASTLE_TOWER1: null,
    BUILDING_CASTLE_TOWER1_FRONTWALL: null,
    BUILDING_CASTLE_TOWER2: null,
    BUILDING_CASTLE_TOWER2_FRONTWALL: null,
    BUILDING_CASTLE_TOWER3: null,
    BUILDING_CASTLE_TOWER3_FRONTWALL: null,
    BUILDING_COALMINE_MINEWHEEL: null,
    BUILDING_DONKEYRANCH_DONKEY1: { dir: 2 },
    BUILDING_DONKEYRANCH_DONKEY2: { dir: 3 },
    BUILDING_DONKEYRANCH_DONKEY3: { dir: 4 },
    BUILDING_EYECATCHER03_ANIM: null,
    BUILDING_EYECATCHER04_ANIM: null,
    BUILDING_EYECATCHER09_ANIM: null,
    BUILDING_EYECATCHER10_ANIM: null,
    BUILDING_EYECATCHER11_ANIM: null,
    BUILDING_EYECATCHER12_ANIM: null,
    BUILDING_FISHERHUT_DOOR: null,
    BUILDING_FISHERHUT_MOVENET: { dir: 2 },
    BUILDING_FISHERHUT_WATER: null,
    BUILDING_FORESTERHUT_ANIM: null,
    BUILDING_GOLDMINE_MINEWHEEL: null,
    BUILDING_GUARDTOWERBIG_DOOR: null,
    BUILDING_GUARDTOWERBIG_FRONTWALL: null,
    BUILDING_GUARDTOWERSMALL_DOOR: null,
    BUILDING_GUARDTOWERSMALL_FRONTWALL: null,
    BUILDING_HEALERHUT_WATER: null,
    BUILDING_IRONMINE_MINEWHEEL: null,
    BUILDING_LOOKOUTTOWER_HORN: null,
    BUILDING_LOOKOUTTOWER_MOVEBELL: null,
    BUILDING_MANACOPTERHALL_KOPTER: null,
    BUILDING_MANACOPTERHALL_MANA: null,
    BUILDING_MANACOPTERHALL_SDRIVE: null,
    BUILDING_MANACOPTERHALL_WORK: null,
    BUILDING_MARKETPLACE_JUMPBIRD: null,
    BUILDING_MARKETPLACE_SCALE: null,
    BUILDING_MILL_BACKWHEEL: { dir: 2 },
    BUILDING_MILL_MILLWHEEL: { dir: 2 },
    BUILDING_MUSHROOMFARM_FLOW: null,
    BUILDING_MUSHROOMFARM_GROW: null,
    BUILDING_MUSHROOMFARM_OPEN: null,
    BUILDING_PORTA_FOOTBRIDGE: null,
    BUILDING_PORTA_LIGHT: null,
    BUILDING_PORTB_FOOTBRIDGE: null,
    BUILDING_PORTB_LIGHT: null,
    BUILDING_PORTC_FOOTBRIDGE: null,
    BUILDING_PORTC_LIGHT: null,
    BUILDING_PORTD_FOOTBRIDGE: null,
    BUILDING_PORTD_LIGHT: null,
    BUILDING_PORTE_FOOTBRIDGE: null,
    BUILDING_PORTE_LIGHT: null,
    BUILDING_PORTF_FOOTBRIDGE: null,
    BUILDING_PORTF_LIGHT: null,
    BUILDING_PORTG_FOOTBRIDGE: null,
    BUILDING_PORTG_LIGHT: null,
    BUILDING_PORTH_FOOTBRIDGE: null,
    BUILDING_PORTH_LIGHT: null,
    BUILDING_RESIDENCEBIG_DOOR: null,
    BUILDING_RESIDENCEBIG_WEATHERCOCK: null,
    BUILDING_RESIDENCEMEDIUM_DOOR: null,
    BUILDING_RESIDENCESMALL_CLOTHLINE: null,
    BUILDING_RESIDENCESMALL_DOOR: null,
    BUILDING_SAWMILL_DOOR: null,
    BUILDING_SHIPYARDA_FOOTBRIDGE: null,
    BUILDING_SHIPYARDB_FOOTBRIDGE: null,
    BUILDING_SHIPYARDC_FOOTBRIDGE: null,
    BUILDING_SHIPYARDD_FOOTBRIDGE: null,
    BUILDING_SHIPYARDE_FOOTBRIDGE: null,
    BUILDING_SHIPYARDF_FOOTBRIDGE: null,
    BUILDING_SHIPYARDG_FOOTBRIDGE: null,
    BUILDING_SHIPYARDH_FOOTBRIDGE: null,
    BUILDING_SMALLTEMPLE_BOWL: null,
    BUILDING_SMALLTEMPLE_FRONTWALL: null,
    BUILDING_SMALLTEMPLE_MANA: null,
    BUILDING_SMELTGOLD_FIRE: null,
    BUILDING_SMELTGOLD_MELTED: { dir: 3 },
    BUILDING_SMELTGOLD_OPENDOOR: null,
    BUILDING_SMELTGOLD_PUMP: { dir: 2 },
    BUILDING_SMELTIRON_FIRE: null,
    BUILDING_SMELTIRON_MELTED: { dir: 3 },
    BUILDING_SMELTIRON_OPENDOOR: null,
    BUILDING_SMELTIRON_PUMP: { dir: 2 },
    BUILDING_STONEMINE_MINEWHEEL: null,
    BUILDING_SULFURMINE_MINEWHEEL: null,
    BUILDING_SUNFLOWEROILMAKERHUT_PRESS: null,
    BUILDING_TOOLSMITH_ANVIL: null,
    BUILDING_TOOLSMITH_DOOR: null,
    BUILDING_TOOLSMITH_FIRE: null,
    BUILDING_TOOLSMITH_WATER: null,
    BUILDING_TOOLSMITH_WIND: null,
    BUILDING_VEHICLEHALL_HAMMER: null,
    BUILDING_VEHICLEHALL_STONEWALL: null,
    BUILDING_VEHICLEHALL_WHEEL: null,
    BUILDING_WATERWORKHUT_LOOPWATER: null,
    BUILDING_WEAPONSMITH_ANVIL: null,
    BUILDING_WEAPONSMITH_FIRE: null,
    BUILDING_WEAPONSMITH_WATER: null,
    BUILDING_WEAPONSMITH_WIND: null,
};

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
 * Each entry is an array of variant base jobs — most trees have 1 variant,
 * some have multiple visual variants picked at random on creation.
 *
 * Each variant occupies TREE_JOBS_PER_TYPE consecutive jobs (see TREE_JOB_OFFSET).
 * Compound variation: variantIndex * TREE_JOBS_PER_TYPE + stageOffset.
 *
 * Example: Oak normal tree = [0] variant, offset NORMAL → 0 * 11 + 3 = variation 3
 */
export const TREE_JOB_INDICES: Partial<Record<MapObjectType, number[]>> = {
    [MapObjectType.TreeOak]: [TREE_BASE_JOB + 0 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeBeech]: [TREE_BASE_JOB + 1 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeAsh]: [TREE_BASE_JOB + 2 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeLinden]: [TREE_BASE_JOB + 3 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeBirch]: [TREE_BASE_JOB + 4 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreePoplar]: [TREE_BASE_JOB + 5 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeChestnut]: [TREE_BASE_JOB + 6 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeMaple]: [TREE_BASE_JOB + 7 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeFir]: [TREE_BASE_JOB + 8 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeSpruce]: [TREE_BASE_JOB + 9 * TREE_JOBS_PER_TYPE], // TODO: add 3 more variant jobs
    // [MapObjectType.TreeCoconut]: [TREE_BASE_JOB + 10 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeDate]: [TREE_BASE_JOB + 11 * TREE_JOBS_PER_TYPE, 111],
    [MapObjectType.TreeWalnut]: [TREE_BASE_JOB + 12 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeCorkOak]: [TREE_BASE_JOB + 13 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreePine]: [TREE_BASE_JOB + 14 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreePine2]: [TREE_BASE_JOB + 15 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeOliveLarge]: [TREE_BASE_JOB + 16 * TREE_JOBS_PER_TYPE],
    [MapObjectType.TreeOliveSmall]: [TREE_BASE_JOB + 17 * TREE_JOBS_PER_TYPE],

    [MapObjectType.TreeCoconut]: [
        TREE_BASE_JOB + 18 * TREE_JOBS_PER_TYPE,
        TREE_BASE_JOB + 19 * TREE_JOBS_PER_TYPE,
        TREE_BASE_JOB + 20 * TREE_JOBS_PER_TYPE,
        TREE_BASE_JOB + 21 * TREE_JOBS_PER_TYPE,
        //TREE_BASE_JOB + 22 * TREE_JOBS_PER_TYPE,
    ],
};
