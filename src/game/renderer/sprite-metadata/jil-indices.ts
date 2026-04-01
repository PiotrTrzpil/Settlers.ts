/**
 * JIL job index constants for GFX files.
 *
 * JIL (Job Index List) indices identify animation jobs that go through
 * the JIL→DIL→GIL pipeline: JIL maps job IDs to DIL entries,
 * DIL maps directions to GIL frame sequences, GIL maps to actual GFX images.
 *
 * @module renderer/sprite-metadata/jil-indices
 */

import { BuildingType, UnitType } from '../../entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { EMaterialType } from '../../economy';

// ============================================================
// Unit job indices — settler files (20-24.jil)
// ============================================================

/**
 * Settler job indices for various professions and their animation states.
 * These are in settler files (20-24.jil).
 *
 * Field names are the actual XML jobPart names from jobInfo.xml (e.g., WC_WALK, WC_CUT_TREE).
 * This enables direct lookup: when the choreo system receives jobPart 'WC_CUT_TREE',
 * it finds the JIL index at SETTLER_JOB_INDICES.woodcutter.WC_CUT_TREE.
 *
 * The XML prefix encodes the unit type (WC_ = woodcutter, BA_ = baker, etc.).
 * The suffix encodes the action (WALK, WALK_LOG, CUT_TREE, PICKUP_LOG, FIGHT, etc.).
 */
export const SETTLER_JOB_INDICES = {
    carrier: {
        C_WALK: 1,
        C_DOWN_NONE: 44, // bend-down for picking up / dropping off goods
        C_IDLE1: 45,
        C_IDLE2: 46,
        C_IDLE3: 47,
        C_STRIKE1: 48,
        C_STRIKE2: 49,
    },
    digger: {
        D_WALK: 50,
        D_WORK: 51,
    },
    builder: {
        B_WALK: 52,
        B_WORK: 53,
    },
    woodcutter: {
        WC_WALK: 54,
        WC_WALK_LOG: 55, // carrying log
        WC_CUT_TREE: 56, // chopping standing tree
        WC_PICKUP_LOG: 57, // picking up fallen log
    },
    stonecutter: {
        ST_WALK: 58,
        ST_HACK: 59,
        ST_PICKUP: 60,
        ST_WALK_STONE: 61,
    },
    forester: {
        F_WALK: 62,
        F_WALK_TREE: 63,
        F_PLANT_SMALLTREE: 64,
    },
    // FG_ = SETTLER_FARMERGRAIN (grain farmer; agave farmer, beekeeper are separate)
    farmer: {
        FG_WALK: 65,
        FG_WALK_GRAIN: 66,
        FG_WALK_SEED: 67,
        FG_SEED_PLANTS: 68,
        FG_CUT_GRAIN: 69,
        FG_PICKUP_GRAIN: 70,
        // FG index 71 exists for Vikings only — animation purpose unknown
    },
    // FA_ = SETTLER_FARMERANIMALS — animal rancher (AnimalRanch + DonkeyRanch)
    animal_farmer: {
        FA_WALK: 72,
        FA_WALK_WATER: 73,
        FA_WALK_GRAIN: 74,
        FA_PICKUP_WATER: 75,
        FA_PICKUP_GRAIN: 76,
        FA_WALK_EMPTY_FOOD: 77,
        FA_WALK_FULL_FOOD: 78,
        FA_FEED: 79,
    },
    fisher: {
        FI_WALK: 80,
        FI_WALK_FISH: 81,
        FI_CATCH_FISH: 82,
        FI_PICKUP_FISH: 83,
        FI_THROW_ROD: 84,
        FI_WORK: 85,
    },
    water_worker: {
        W_WALK: 86,
        W_WALK_EMPTY_WATER: 87,
        W_WALK_FULL_WATER: 88,
        W_PICKUP_WATER: 89,
        W_GET_WATER: 90,
    },
    hunter: {
        H_WALK: 91,
        H_WALK_MEAT: 92,
        H_PICKUP_MEAT: 93,
        H_PICKUP_ANIMAL: 94, // (no XML match — unused in standard jobs)
        H_SHOOT: 95,
    },
    sawmill_worker: {
        SW_WALK: 96,
        SW_WALK_LOG: 97,
        SW_WALK_BOARD: 98,
        SW_WORK: 99,
        SW_PICKUP_LOG: 100,
        SW_PICKUP_BOARD: 101,
    },
    smelter: {
        SME_WALK: 102,
        SME_WALK_COAL: 103,
        SME_WALK_GOLDBAR: 104,
        SME_WALK_GOLDORE: 105,
        SME_WALK_IRONBAR: 106,
        SME_WALK_IRONORE: 107,
        SME_PICKUP_COAL: 108,
        SME_PICKUP_GOLDBAR: 109,
        SME_PICKUP_GOLDORE: 110,
        SME_PICKUP_IRONBAR: 111,
        SME_WORK: 112,
        SME_PICKUP_IRONORE: 113,
    },
    miner: {
        M_WALK: 114,
        M_PUSHIN_COAL: 115, // empty cart back
        M_PUSHIN_IRONORE: 116,
        M_PUSHIN_GOLDORE: 117,
        M_PUSHIN_STONE: 118,
        M_PUSHIN_SULFUR: 119,
        M_PUSHOUT_COAL: 120, // full cart out
        M_PUSHOUT_IRONORE: 121,
        M_PUSHOUT_GOLDORE: 122,
        M_PUSHOUT_STONE: 123,
        M_PUSHOUT_SULFUR: 124,
        M_TIP_COAL: 125, // dump cart
        M_TIP_IRONORE: 126,
        M_TIP_GOLDORE: 127,
        M_TIP_STONE: 128,
        M_TIP_SULFUR: 129,
    },
    smith: {
        S_WALK: 130,
        S_WALK_COAL: 131,
        S_WALK_GLOWSTEEL: 132,
        S_WALK_IRONBAR: 133,
        S_WALK_STEEL: 134,
        S_WORK: 135,
        S_COOL_STEEL: 136,
        S_PICKUP_COAL: 137,
        S_PICKUP_IRONBAR: 138,
        S_PICKUP_STEEL: 139,
    },
    miller: {
        MI_WALK: 140,
        MI_WALK_GRAIN: 141,
        MI_WALK_FLOUR: 142,
        MI_PICKUP_GRAIN: 143,
        MI_PICKUP_FLOUR: 144,
    },
    baker: {
        BA_WALK: 145,
        BA_WALK_FLOUR: 146,
        BA_WALK_BREAD: 147,
        BA_WALK_SHOVEL: 148,
        BA_WALK_DOUGH: 149,
        BA_WALK_WATER: 150,
        BA_WORK_BREAD: 151,
        BA_WORK_DOUGH: 152,
        BA_SHOVEL_UP: 153,
        BA_PICKUP_WATER: 154,
        BA_PICKUP_FLOUR: 155,
    },
    butcher: {
        BU_WALK: 156,
        BU_WALK_MEAT: 157,
        BU_WALK_ANIMAL: 158,
        BU_PICKUP_MEAT: 159,
        BU_PICKUP_ANIMAL: 160,
    },
    // VM_ = SETTLER_VEHICLEHALLWORKER (siege workshop)
    unknown_worker: {
        VM_WALK: 161,
        VM_WALK_BOARD: 162,
        VM_WALK_IRONBAR: 163,
        VM_PICKUP_BOARD: 164,
        VM_PICKUP_IRONBAR: 165,
        VM_WORK: 166,
    },
    healer: {
        HE_WALK: 167,
        HE_CONJURE: 168,
    },
    // CO_ = Charcoal burner
    charcoal_burner: {
        CO_WALK: 169,
        CO_WALK_LOG: 170,
        CO_WALK_COAL: 171,
        CO_PICKUP_COAL: 172,
        CO_PICKUP_LOG: 173,
    },
    // AM_ = SETTLER_AMMOMAKERHUTWORKER
    ammunition_maker: {
        AM_WALK: 174,
        AM_WALK_FIRSTGOOD: 175, // coal
        AM_WALK_SECONDGOOD: 176, // sulfur
        AM_WALK_THIRDGOOD: 177,
        AM_WALK_AMMO: 178,
        AM_PICKUP_FIRSTGOOD: 179, // coal
        AM_PICKUP_SECONDGOOD: 180, // sulfur
        AM_PICKUP_THIRDGOOD: 181,
        AM_PICKUP_AMMO: 182,
    },
    // SYW_ = SETTLER_SHIPYARDWORKER
    shipyard_worker: {
        SYW_WALK: 183,
        SYW_WALK_BOARD: 186,
        SYW_WALK_IRONBAR: 184,
        SYW_WALK_IRONBAR2: 185, // (second ironbar carry variant)
        SYW_WORK: 187,
        SYW_PICKUP_BOARD: 189,
        SYW_PICKUP_IRONBAR: 188,
        SYW_PICKUP_IRONBAR2: 190, // (second ironbar pickup variant)
    },
    // V_ = SETTLER_VINTNER (wine maker)
    wine_maker: {
        V_WALK: 191,
        V_WALK_GRAPE: 192,
        V_WALK_EMPTYGRAPE: 193,
        V_WALK_WINE: 194,
        V_WALK_PLANT: 195,
        V_FILL_GRAPE: 196,
        V_WORK_PLANT: 197,
        V_PICKUP_WINE: 198,
    },
    // BK_ = SETTLER_BEEKEEPER
    beekeeper: {
        BK_WALK: 199,
        BK_WALK_BEEHIVE: 200,
        BK_WALK_HONEY: 201,
        BK_PICKUP_BEEHIVE: 202,
        BK_PICKUP_HONEY: 203,
        BK_WORK_1: 204, // (extra animation — no XML match)
        BK_WORK_2: 205, // (extra animation — no XML match)
    },
    // MM_ = SETTLER_MEADMAKER
    mead_maker: {
        MM_WALK: 206,
        MM_WALK_HONEY: 207, // or water — first carry
        MM_WALK_WATER: 208,
        MM_WALK_MEAD: 209, // (mead carry)
        MM_PICKUP_HONEY: 210,
        MM_PICKUP_MEAD: 211,
        MM_PICKUP_WATER: 212,
    },
    // AF_ = SETTLER_AGAVEFARMER
    agave_farmer: {
        AF_WALK: 213,
        AF_WALK_AGAVE: 214,
        AF_WALK_MACHETE: 215,
        AF_WALK_SMALLAGAVE: 216,
        AF_PLANT_SMALLAGAVE: 217,
        AF_WORK_MACHETE: 218,
        AF_PICKUP_AGAVE: 219,
    },
    // TM_ = SETTLER_TEQUILAMAKER
    tequila_maker: {
        TM_WALK: 220,
        TM_WALK_AGAVE: 221,
        TM_WALK_TEQUILA: 222,
        TM_WALK_WATER: 223,
        TM_PICKUP_AGAVE: 224,
        TM_PICKUP_TEQUILA: 225,
        TM_PICKUP_WATER: 226,
    },
    swordsman_1: {
        SML01_WALK: 227,
        SML01_FIGHT: 228,
    },
    swordsman_2: {
        SML02_WALK: 230,
        SML02_FIGHT: 231,
    },
    swordsman_3: {
        SML03_WALK: 233,
        SML03_FIGHT: 234,
    },
    bowman_1: {
        BML01_WALK: 236,
        BML01_SHOOT: 237,
        BML01_STOW_BOW: 238,
        BML01_THROW_STONE: 239,
        BML01_FIGHT: 240,
    },
    bowman_2: {
        BML02_WALK: 242,
        BML02_SHOOT: 243,
        BML02_STOW_BOW: 244,
        BML02_THROW_STONE: 245,
        BML02_FIGHT: 246,
    },
    bowman_3: {
        BML03_WALK: 248,
        BML03_SHOOT: 249,
        BML03_STOW_BOW: 250,
        BML03_THROW_STONE: 251,
        BML03_FIGHT: 252,
    },
    // MEL_ = Roman specialist (Medic)
    specialist_1: {
        MEL01_WALK: 254,
        MEL01_HEAL: 255,
        MEL01_FIGHT: 256,
    },
    specialist_2: {
        MEL02_WALK: 258,
        MEL02_HEAL: 259,
        MEL02_FIGHT: 260,
    },
    specialist_3: {
        MEL03_WALK: 262,
        MEL03_HEAL: 263,
        MEL03_FIGHT: 264,
    },

    // AWL_ = Viking specialist (Axe Warrior)
    axe_warrior_1: {
        AWL01_WALK: 266,
        AWL01_FIGHT: 267,
    },
    axe_warrior_2: {
        AWL02_WALK: 269,
        AWL02_FIGHT: 270,
    },
    axe_warrior_3: {
        AWL03_WALK: 272,
        AWL03_FIGHT: 273,
    },

    // BGWL_ = Mayan specialist (Blowgun Warrior)
    blowgun_warrior_1: {
        BGWL01_WALK: 275,
        BGWL01_FIGHT: 276,
    },
    blowgun_warrior_2: {
        BGWL02_WALK: 278,
        BGWL02_FIGHT: 279,
    },
    blowgun_warrior_3: {
        BGWL03_WALK: 281,
        BGWL03_FIGHT: 282,
    },

    // BCL_ = Trojan specialist (Backpack Catapultist)
    catapultist_1: {
        BCL01_WALK: 341,
        BCL01_FIGHT: 342,
    },
    catapultist_2: {
        BCL02_WALK: 344,
        BCL02_FIGHT: 345,
    },
    catapultist_3: {
        BCL03_WALK: 347,
        BCL03_FIGHT: 348,
    },

    // SQL_ = Squad Leader
    squad_leader: {
        SQL_WALK: 284,
        SQL_FIGHT: 285,
    },
    // PR_ = Priest
    priest: {
        PR_WALK: 287,
        PR_CASTSPELL: 288,
    },

    // SA_ = Saboteur
    saboteur: {
        SA_WALK: 290,
        SA_WORK_PICKAXE: 291,
        SA_WORK_2: 292,
        SA_WORK_3: 293,
        SA_WORK_4: 294,
        SA_WORK_5: 295,
        SA_WORK_6: 296,
        SA_WORK_7: 297,
    },
    // P_ = Pioneer
    pioneer: {
        P_WALK: 298,
        P_SHOVEL: 299,
        P_WORK: 300,
    },
    // TH_ = Thief
    thief: {
        TH_WALK: 301,
        TH_WALK_GOOD: 302,
        TH_STEAL: 303,
        TH_DROP_GOOD: 304,
    },
    // G_ = Geologist
    geologist: {
        G_WALK: 305,
        G_SEARCH: 306, // walking search — treated as walk
        G_WORK: 307,
    },
    // GA_ = Gardener (landscape maker)
    gardener: {
        GA_WALK: 308,
        GA_WORK: 309,
        GA_BEAT_MUSHROOM: 310,
    },
    // TS_ = Temple Servant
    temple_servant: {
        TS_WALK: 328,
        TS_WALK_WINE: 329,
        TS_PICKUP_WINE: 330,
        TS_WORK: 331,
        TS_ANIM: 332,
    },
    angel_1: {
        ANGEL1_WALK: 333,
    },
    angel_2: {
        ANGEL2_WALK: 334,
    },
    angel_3: {
        ANGEL3_WALK: 335,
    },

    // DONKEY_ — all races have the same donkey (file 24 has additional fight animation)
    donkey: {
        DONKEY_WALK: 336,
        DONKEY_IDLE: 337,
        DONKEY_WALK_FULLBASKET: 338,
        DONKEY_WALK_EMPTYBASKET: 339,
        DONKEY_DROP_GOODS: 340, // fight in file 24
    },

    // SFF_ = Sunflower Farmer (Trojan only)
    sunflower_farmer: {
        SFF_WALK: 350,
        SFF_WALK_PLANT: 351,
        SFF_WALK_SMALL_PLANT: 352, // was carry_plant
        SFF_WALK_WATERER: 353, // (watering can carry)
        SFF_WORK_PLANT: 354,
        SFF_WORK: 355,
        SFF_PICKUP_PLANT: 356,
        SFF_PICKUP_SUNFLOWER: 357, // (pickup mature sunflower)
    },
    // SOM_ = Sunflower Oil Maker (Trojan only)
    oil_maker: {
        SOM_WALK: 358,
        SOM_WALK_OIL: 359,
        SOM_WALK_PLANT: 360,
        SOM_PICKUP_PLANT: 361,
        SOM_PICKUP_OIL: 362,
    },

    // DG_ = Dark Gardener (Dark Tribe)
    dark_gardener: {
        DG_WALK: 313,
        DG_SEED: 314,
    },
    // MF_ = Mushroom Farmer (Dark Tribe)
    mushroom_farmer: {
        MF_WALK: 315,
        MF_WALK_SMALLMUSHROOM: 316,
        MF_PLANT: 317,
        MF_FIGHT: 318,
        MF_WALK_MANA: 321,
    },
    // SHM_ = Shaman (Dark Tribe)
    shaman: {
        SHM_WALK: 323,
        SHM_ENSLAVE: 324,
    },
    // SS_ = Slaved Settler (Dark Tribe)
    slaved_settler: {
        SS_WALK: 325,
        SS_POLISH: 326,
        SS_POLISH_2: 327,
    },
    manacopter_master: {
        MC_WALK: 363,
        MC_FIGHT: 364,
        MC_WORK: 365,
    },
} as const;

/**
 * Mapping from SETTLER_JOB_INDICES keys to UnitType.
 * Each level maps to a distinct UnitType (e.g. swordsman_2 → UnitType.Swordsman2).
 * specialist_1/2/3 map to Medic (Roman). Each other race has its own specialist keys:
 * axe_warrior_* (Viking), blowgun_warrior_* (Mayan), catapultist_* (Trojan).
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
    swordsman_1: UnitType.Swordsman1,
    swordsman_2: UnitType.Swordsman2,
    swordsman_3: UnitType.Swordsman3,
    bowman_1: UnitType.Bowman1,
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
    specialist_1: UnitType.Medic1,
    specialist_2: UnitType.Medic2,
    specialist_3: UnitType.Medic3,
    axe_warrior_1: UnitType.AxeWarrior1,
    axe_warrior_2: UnitType.AxeWarrior2,
    axe_warrior_3: UnitType.AxeWarrior3,
    catapultist_1: UnitType.BackpackCatapultist1,
    catapultist_2: UnitType.BackpackCatapultist2,
    catapultist_3: UnitType.BackpackCatapultist3,
    angel_1: UnitType.Angel,
    angel_2: UnitType.Angel2,
    angel_3: UnitType.Angel3,
    shaman: UnitType.Shaman,
    dark_gardener: UnitType.DarkGardener,
    gardener: UnitType.Gardener,
    fisher: UnitType.Fisher,
    hunter: UnitType.Hunter,
    stonecutter: UnitType.Stonecutter,
    smelter: UnitType.Smelter,
    donkey: UnitType.Donkey,
    blowgun_warrior_1: UnitType.BlowgunWarrior1,
    blowgun_warrior_2: UnitType.BlowgunWarrior2,
    blowgun_warrior_3: UnitType.BlowgunWarrior3,
    wine_maker: UnitType.Winemaker,
    mead_maker: UnitType.Meadmaker,
    tequila_maker: UnitType.Tequilamaker,
    saboteur: UnitType.Saboteur,
    temple_servant: UnitType.TempleServant,
    manacopter_master: UnitType.ManacopterMaster,
    slaved_settler: UnitType.SlavedSettler,
    oil_maker: UnitType.SunflowerOilMaker,
};

/** Type alias for a settler's animation data — all fields are plain numbers. */
export type SettlerAnimData = Readonly<Record<string, number>>;

// ============================================================
// XML field name utilities
// ============================================================

/**
 * Strip the XML prefix from a field name, returning the action suffix.
 * E.g., 'WC_CUT_TREE' → 'CUT_TREE', 'BML01_WALK' → 'WALK', 'C_DOWN_LOG' → 'DOWN_LOG'.
 *
 * The prefix is everything up to and including the first underscore, UNLESS the
 * second segment is a level number like '01', '02', '03' — then strip two segments.
 */
export function stripXmlPrefix(key: string): string {
    const first = key.indexOf('_');
    if (first === -1) {
        return key;
    }
    const rest = key.slice(first + 1);
    // Check if next segment is a level number (e.g., SML01_WALK → strip 'SML01_')
    const levelMatch = /^(\d{2})_(.+)$/.exec(rest);
    if (levelMatch) {
        return levelMatch[2]!;
    }
    return rest;
}

/**
 * Extract the XML prefix from a field name.
 * E.g., 'WC_CUT_TREE' → 'WC', 'BML01_WALK' → 'BML01', 'C_DOWN_LOG' → 'C'.
 */
function extractXmlPrefix(key: string): string {
    const first = key.indexOf('_');
    if (first === -1) {
        return key;
    }
    const prefix = key.slice(0, first);
    const rest = key.slice(first + 1);
    const levelMatch = /^(\d{2})_/.exec(rest);
    if (levelMatch) {
        return `${prefix}${levelMatch[1]}`;
    }
    return prefix;
}

/** Test whether a field's action suffix is WALK (base walk, no cargo). */
function isWalkField(key: string): boolean {
    return stripXmlPrefix(key) === 'WALK';
}

/** Test whether a field's action suffix starts with IDLE. */
function isIdleField(key: string): boolean {
    const action = stripXmlPrefix(key);
    return action === 'IDLE' || action.startsWith('IDLE');
}

/** Extract the first walk or idle job index — used for base JIL index. */
function extractBaseIndex(data: SettlerAnimData): number | undefined {
    for (const [key, value] of Object.entries(data)) {
        if (isWalkField(key)) {
            return value;
        }
    }
    for (const [key, value] of Object.entries(data)) {
        if (isIdleField(key)) {
            return value;
        }
    }
    return undefined;
}

/**
 * Precomputed UnitType → XML prefix mapping.
 * Derived from SETTLER_JOB_INDICES: takes the prefix of the first field of each unit type.
 * E.g., UnitType.Woodcutter → 'WC', UnitType.Swordsman1 → 'SML01'.
 */
export const UNIT_XML_PREFIX: Readonly<Partial<Record<UnitType, string>>> = (() => {
    const result: Partial<Record<UnitType, string>> = {};
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) {
            continue;
        }
        const firstField = Object.keys(workerData)[0];
        if (firstField) {
            result[unitType] = extractXmlPrefix(firstField);
        }
    }
    return result;
})();

/**
 * Derive the base JIL job index per UnitType from SETTLER_JOB_INDICES.
 * Prefers walk over idle-only. Each level variant gets its own entry.
 */
function computeUnitBaseJobIndices(): Partial<Record<UnitType, number>> {
    const result: Partial<Record<UnitType, number>> = {};
    for (const [workerKey, workerData] of Object.entries(SETTLER_JOB_INDICES)) {
        const unitType = SETTLER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) {
            continue;
        }
        if (result[unitType] !== undefined) {
            continue;
        }

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
 */
export const UNIT_BASE_JOB_INDICES: Partial<Record<UnitType, number>> = (() => {
    return computeUnitBaseJobIndices();
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
    [BuildingType.Marketplace]: 33, // S4BuildingType.MARKETPLACE
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
    Object.entries(RESOURCE_JOB_INDICES).map(([type, idx]) => [type, idx + 1])
) as Partial<Record<EMaterialType, number>>;

// Building overlay JIL indices are in jil-overlay-indices.ts
export { type OverlayJilEntry, resolveOverlayJilEntry, BUILDING_OVERLAY_JIL_INDICES } from './jil-overlay-indices';

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
    [MapObjectType.TreeOak]: [TREE_BASE_JOB],
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

// ============================================================
// Dark tree job indices — file 5.jil
// ============================================================

/**
 * JIL job indices for dark trees in 5.jil.
 * Unlike normal trees, dark trees have NO growth stages or cut variants —
 * each animated type is a single job with 16 sway frames, and static types have 1 frame.
 *
 * Animated: jobs 243-248 (6 types, 16 frames each)
 * Static:  job 249 (dark pine), job 251 (dark palm)
 *
 * Note: DARK_TREE_6 (job 248) has a 2px horizontal glitch in frames 0-1 —
 * the loader skips those frames at runtime.
 */
export const DARK_TREE_JOB_INDICES: ReadonlyArray<{ types: MapObjectType[]; job: number }> = [
    { types: [MapObjectType.DarkTree1A], job: 243 },
    { types: [MapObjectType.DarkTree1B], job: 244 },
    { types: [MapObjectType.DarkTree2A], job: 245 },
    { types: [MapObjectType.DarkTree2B], job: 246 },
    { types: [MapObjectType.DarkTree3A], job: 247 },
    { types: [MapObjectType.DarkTree3B], job: 248 },
];

export const DARK_TREE_STATIC_JOB_INDICES: ReadonlyArray<{ types: MapObjectType[]; job: number }> = [
    { types: [MapObjectType.DarkTree4A, MapObjectType.DarkTree5A], job: 249 },
    { types: [MapObjectType.DarkTree4B], job: 251 },
];

// ============================================================
// Dark tribe tree job indices — file 5.jil
// ============================================================

/** JIL jobs for dark tribe mushroom trees (static, 1 frame each). */
export const DARK_TRIBE_TREE_JOBS = {
    /** Dark tribe mushroom tree A (138x122) */
    A: 324,
    /** Dark tribe mushroom tree B (139x104) */
    B: 325,
    /** Dark tribe mushroom tree C, purple (134x120) */
    C: 326,
} as const;

// ============================================================
// Sea rock job indices — file 5.jil
// ============================================================

/** JIL jobs for animated sea rocks (10 frames each). */
export const SEA_ROCK_JOBS = {
    A: 327,
    B: 328,
    C: 329,
    D: 330,
} as const;

// ============================================================
// Territory dot job index — file 5.jil
// ============================================================

/** JIL job for territory dots — 8 frames (one per player color) in direction 0. */
export const TERRITORY_DOT_JOB = 533;

// ============================================================
// Resource sign job indices — file 5.jil
// ============================================================

/**
 * JIL jobs for geologist resource signs (1 frame each).
 * Order: empty, then coal/gold/iron/stone/sulfur × low/med/rich.
 */
export const RESOURCE_SIGN_JOBS = {
    EMPTY: 417,
    COAL: { LOW: 418, MED: 419, RICH: 420 },
    GOLD: { LOW: 421, MED: 422, RICH: 423 },
    IRON: { LOW: 424, MED: 425, RICH: 426 },
    STONE: { LOW: 427, MED: 428, RICH: 429 },
    SULFUR: { LOW: 430, MED: 431, RICH: 432 },
} as const;
