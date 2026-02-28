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
 * Worker job indices for various professions and their animation states.
 * These are in settler files (20-24.jil).
 *
 * Generic keys:
 * - idle: standing still (number or array for variants)
 * - walk: walking animation
 * - carry: walking while carrying something
 * - work: array of work animation job indices (maps to work.0, work.1, etc.)
 *
 */
export const WORKER_JOB_INDICES = {
    carrier: {
        idle: [44, 45, 46, 47, 48], // idle animation variants
        walk: 1,
        work: [49], // striking/protesting
    },
    digger: {
        walk: 50,
        work: [51],
    },
    builder: {
        walk: 52, // Walk cycle (same animation also at job 53)
        work: 53,
    },
    woodcutter: {
        walk: 54,
        carry: 55, // carrying log
        work: [56, 57], // [chopping standing tree, cutting fallen log]
    },
    stonecutter: {
        walk: 58,
        work: [59],
        pickup: [60],
        carry: [61],
    },
    forester: {
        walk: 62,
        carry: 63,
        work: [64],
    },
    // Farmer (grain, agave farmer, beekeeper share same sprites)
    farmer: {
        walk: 65,
        carry: 66,
        work: [67, 68, 69], // [seeding phase 1, phase 2, phase 3]
        pickup: 70,
    },
    hunter: {
        walk: 91,
        carry: 92,
        pickup: [93, 94],
        work: [95],
    },
    sawmill_worker: {
        walk: 96,
        carry: [97, 98],
        work: [99],
        pickup: [100, 101],
    },
    miner: {
        walk: 114,
        work: [115, /* different resources in between */ 129],
    },
    smith: {
        walk: 130,
        work: [130, 131, 132, 133, 134, 135, 136],
        pickup: [137, 138, 139],
    },
    wine_maker: {
        walk: 191,
        carry: [192, 193, 194, 195],
        work: [196, 197],
        pickup: 198,
    },
    beekeeper: {
        walk: 199,
        carry: [200, 201],
        work: [202, 203, 204, 205],
    },
    mead_maker: {
        walk: 206,
        carry: [207, 208, 209],
        pickup: [210, 211, 212],
    },
    agave_farmer: {
        walk: 213,
        carry: [214],
        work: [215, 216, 217, 218, 219],
    },
    tequila_maker: {
        walk: 220,
        carry: [221, 222, 223],
        pickup: [224, 225, 226],
    },
    swordsman_1: {
        walk: 227,
        fight: [228],
    },
    swordsman_2: {
        walk: 230,
        fight: [231],
    },
    swordsman_3: {
        walk: 233,
        fight: [234],
    },
    // Bowman levels (work entries are shooting animations; fight reuses shooting)
    bowman_1: {
        walk: 236,
        work: [237, 238, 239, 240], // shooting variants
        fight: [237], // shooting = fighting
    },
    bowman_2: {
        walk: 242,
        work: [243, 244, 245, 246],
        fight: [243],
    },
    bowman_3: {
        walk: 248,
        work: [249, 250, 251, 252],
        fight: [249],
    },
    // specialists for romans and vikings
    // NOTE: mayans and trojans have their specialist under separate indices
    specialist_1: {
        walk: 254,
        work: [255],
        fight: [256],
    },
    specialist_2: {
        walk: 258,
        work: [259],
        fight: [260],
    },
    specialist_3: {
        walk: 262,
        work: [263],
        fight: [264],
    },

    // mayan specialist
    blowgun_warrior_1: {
        walk: 275,
        fight: [276],
    },
    blowgun_warrior_2: {
        walk: 278,
        fight: [279],
    },
    blowgun_warrior_3: {
        walk: 281,
        fight: [282],
    },

    // trojan specialist
    catapultist_1: {
        walk: 341,
        fight: [342],
    },
    catapultist_2: {
        walk: 344,
        fight: [345],
    },
    catapultist_3: {
        walk: 346,
        fight: [347],
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
        work: [291, 292, 293, 294, 295, 296, 297],
    },
    pioneer: {
        walk: 298,
        work: [299, 300],
    },
    thief: {
        walk: 301,
        work: [303, 304],
        carry: 302,
    },
    geologist: {
        walk: 305,
        work: [306, 307],
    },
    gardener: {
        walk: 308,
        work: [309, 310],
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

    // all races have the same donkey (duplicates).
    // but file 24 has additional donkey fight animation
    donkey: {
        walk: 336,
        idle: 337,
        carry: [338, 339],
        fight: 340,
    },

    // Mushroom farmer (Dark Tribe specific, file 23.jil)
    mushroom_farmer: {
        walk: 313,
        work: 314,
    },
    dark_carrier: {
        walk: 315,
        carry: 316,
        work: [317, 318, 319, 320, 321, 322],
    },
    shaman: {
        walk: 323,
        work: [324],
    },
    slaved_settler: {
        walk: 325,
        work: [326, 327],
    },
    manacopter_master: {
        walk: 363,
        fight: 364,
        work: [365],
    },
} as const;

/**
 * Mapping from WORKER_JOB_INDICES keys to UnitType.
 * Each level maps to a distinct UnitType (e.g. swordsman_2 → UnitType.Swordsman2).
 * specialist_1/2/3 map to Medic (Roman) and are reused for AxeWarrior (Viking) via
 * UNIT_BASE_JOB_INDICES. Other race specialists have their own keys:
 * blowgun_warrior_* (Mayan), catapultist_* (Trojan).
 */
export const WORKER_KEY_TO_UNIT_TYPE: Readonly<Record<string, UnitType>> = {
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

/** Extract the first numeric index from a walk or idle field. */
function extractBaseIndex(
    workerData: (typeof WORKER_JOB_INDICES)[keyof typeof WORKER_JOB_INDICES]
): number | undefined {
    if ('walk' in workerData && typeof workerData.walk === 'number') return workerData.walk;
    if (!('idle' in workerData)) return undefined;
    const idle = workerData.idle;
    if (typeof idle === 'number') return idle;
    if (Array.isArray(idle)) return idle[0];
    return undefined;
}

/**
 * Derive the base JIL job index per UnitType from WORKER_JOB_INDICES.
 * Prefers walk over idle-only. Each level variant gets its own entry.
 */
function computeUnitBaseJobIndices(): Partial<Record<UnitType, number>> {
    const result: Partial<Record<UnitType, number>> = {};
    for (const [workerKey, workerData] of Object.entries(WORKER_JOB_INDICES)) {
        const unitType = WORKER_KEY_TO_UNIT_TYPE[workerKey];
        if (unitType === undefined) continue;
        if (result[unitType] !== undefined) continue;

        const baseIdx = extractBaseIndex(workerData);
        if (baseIdx !== undefined && baseIdx >= 0) {
            result[unitType] = baseIdx;
        }
    }
    return result;
}

/**
 * Base JIL job index per UnitType, derived from WORKER_JOB_INDICES.
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
    [BuildingType.LivingHouse]: 26, // S4BuildingType.TRAININGCENTER
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
    // SunflowerFarmerHut is stored in 13.gfx (DarkTribe file) as separate jobs: #109 construction, #110 completed
    // Handled via constructionIndex override in getBuildingSpriteMap()
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
 * Job 1 is the empty carrier (walk index in WORKER_JOB_INDICES.carrier).
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
 * JIL job index for building overlay animations (smoke, fire, wheels, etc.).
 * Overlays share the GFX file with their building (file = Race as number, e.g. 10 for Roman).
 *
 * Values are -1 for overlays not yet identified — fill in the actual JIL index
 * by inspecting the building GFX files (entries beyond the main building range).
 *
 * Names come from the <job> field of <patch> elements in buildingInfo.xml.
 */
export const BUILDING_OVERLAY_JIL_INDICES: Readonly<Record<string, number>> = {
    // TODO: fill in actual JIL indices after inspecting the building GFX files
    BUILDING_AMMOMAKERHUT_EXPLOSION: -1,
    BUILDING_ANIMALRANCH_ANIMAL1: -1,
    BUILDING_ANIMALRANCH_ANIMAL2: -1,
    BUILDING_ANIMALRANCH_ANIMAL3: -1,
    BUILDING_ANIMALRANCH_ANIMAL4: -1,
    BUILDING_ANIMALRANCH_ANIMAL5: -1,
    BUILDING_ANIMALRANCH_ANIMAL6: -1,
    BUILDING_BAKERY_DOOR: -1,
    BUILDING_BAKERY_FIRE: -1,
    BUILDING_BAKERY_OPENDOOR: -1,
    BUILDING_BAKERY_OVEN: -1,
    BUILDING_BAKERY_POLLER: -1,
    BUILDING_BAKERY_SIGN: -1,
    BUILDING_BARRACKS_ANIMPUPPET: -1,
    BUILDING_BIGTEMPLE_ANIM: -1,
    BUILDING_CASTLE_DOOR: -1,
    BUILDING_CASTLE_FRONTWALL: -1,
    BUILDING_CASTLE_TOWER1: -1,
    BUILDING_CASTLE_TOWER1_FRONTWALL: -1,
    BUILDING_CASTLE_TOWER2: -1,
    BUILDING_CASTLE_TOWER2_FRONTWALL: -1,
    BUILDING_CASTLE_TOWER3: -1,
    BUILDING_CASTLE_TOWER3_FRONTWALL: -1,
    BUILDING_COALMINE_MINEWHEEL: -1,
    BUILDING_DONKEYRANCH_DONKEY1: -1,
    BUILDING_DONKEYRANCH_DONKEY2: -1,
    BUILDING_DONKEYRANCH_DONKEY3: -1,
    BUILDING_EYECATCHER03_ANIM: -1,
    BUILDING_EYECATCHER04_ANIM: -1,
    BUILDING_EYECATCHER09_ANIM: -1,
    BUILDING_EYECATCHER10_ANIM: -1,
    BUILDING_EYECATCHER11_ANIM: -1,
    BUILDING_EYECATCHER12_ANIM: -1,
    BUILDING_FISHERHUT_DOOR: -1,
    BUILDING_FISHERHUT_MOVENET: -1,
    BUILDING_FISHERHUT_WATER: -1,
    BUILDING_FORESTERHUT_ANIM: -1,
    BUILDING_GOLDMINE_MINEWHEEL: -1,
    BUILDING_GUARDTOWERBIG_DOOR: -1,
    BUILDING_GUARDTOWERBIG_FRONTWALL: -1,
    BUILDING_GUARDTOWERSMALL_DOOR: -1,
    BUILDING_GUARDTOWERSMALL_FRONTWALL: -1,
    BUILDING_HEALERHUT_WATER: -1,
    BUILDING_IRONMINE_MINEWHEEL: -1,
    BUILDING_LOOKOUTTOWER_HORN: -1,
    BUILDING_LOOKOUTTOWER_MOVEBELL: -1,
    BUILDING_MANACOPTERHALL_KOPTER: -1,
    BUILDING_MANACOPTERHALL_MANA: -1,
    BUILDING_MANACOPTERHALL_SDRIVE: -1,
    BUILDING_MANACOPTERHALL_WORK: -1,
    BUILDING_MARKETPLACE_JUMPBIRD: -1,
    BUILDING_MARKETPLACE_SCALE: -1,
    BUILDING_MILL_BACKWHEEL: -1,
    BUILDING_MILL_MILLWHEEL: -1,
    BUILDING_MUSHROOMFARM_FLOW: -1,
    BUILDING_MUSHROOMFARM_GROW: -1,
    BUILDING_MUSHROOMFARM_OPEN: -1,
    BUILDING_PORTA_FOOTBRIDGE: -1,
    BUILDING_PORTA_LIGHT: -1,
    BUILDING_PORTB_FOOTBRIDGE: -1,
    BUILDING_PORTB_LIGHT: -1,
    BUILDING_PORTC_FOOTBRIDGE: -1,
    BUILDING_PORTC_LIGHT: -1,
    BUILDING_PORTD_FOOTBRIDGE: -1,
    BUILDING_PORTD_LIGHT: -1,
    BUILDING_PORTE_FOOTBRIDGE: -1,
    BUILDING_PORTE_LIGHT: -1,
    BUILDING_PORTF_FOOTBRIDGE: -1,
    BUILDING_PORTF_LIGHT: -1,
    BUILDING_PORTG_FOOTBRIDGE: -1,
    BUILDING_PORTG_LIGHT: -1,
    BUILDING_PORTH_FOOTBRIDGE: -1,
    BUILDING_PORTH_LIGHT: -1,
    BUILDING_RESIDENCEBIG_DOOR: -1,
    BUILDING_RESIDENCEBIG_WEATHERCOCK: -1,
    BUILDING_RESIDENCEMEDIUM_DOOR: -1,
    BUILDING_RESIDENCESMALL_CLOTHLINE: -1,
    BUILDING_RESIDENCESMALL_DOOR: -1,
    BUILDING_SAWMILL_DOOR: -1,
    BUILDING_SHIPYARDA_FOOTBRIDGE: -1,
    BUILDING_SHIPYARDB_FOOTBRIDGE: -1,
    BUILDING_SHIPYARDC_FOOTBRIDGE: -1,
    BUILDING_SHIPYARDD_FOOTBRIDGE: -1,
    BUILDING_SHIPYARDE_FOOTBRIDGE: -1,
    BUILDING_SHIPYARDF_FOOTBRIDGE: -1,
    BUILDING_SHIPYARDG_FOOTBRIDGE: -1,
    BUILDING_SHIPYARDH_FOOTBRIDGE: -1,
    BUILDING_SMALLTEMPLE_BOWL: -1,
    BUILDING_SMALLTEMPLE_FRONTWALL: -1,
    BUILDING_SMALLTEMPLE_MANA: -1,
    BUILDING_SMELTGOLD_FIRE: -1,
    BUILDING_SMELTGOLD_MELTED: -1,
    BUILDING_SMELTGOLD_OPENDOOR: -1,
    BUILDING_SMELTGOLD_PUMP: -1,
    BUILDING_SMELTIRON_FIRE: -1,
    BUILDING_SMELTIRON_MELTED: -1,
    BUILDING_SMELTIRON_OPENDOOR: -1,
    BUILDING_SMELTIRON_PUMP: -1,
    BUILDING_STONEMINE_MINEWHEEL: -1,
    BUILDING_SULFURMINE_MINEWHEEL: -1,
    BUILDING_SUNFLOWEROILMAKERHUT_PRESS: -1,
    BUILDING_TOOLSMITH_ANVIL: -1,
    BUILDING_TOOLSMITH_DOOR: -1,
    BUILDING_TOOLSMITH_FIRE: -1,
    BUILDING_TOOLSMITH_WATER: -1,
    BUILDING_TOOLSMITH_WIND: -1,
    BUILDING_VEHICLEHALL_HAMMER: -1,
    BUILDING_VEHICLEHALL_STONEWALL: -1,
    BUILDING_VEHICLEHALL_WHEEL: -1,
    BUILDING_WATERWORKHUT_LOOPWATER: -1,
    BUILDING_WEAPONSMITH_ANVIL: -1,
    BUILDING_WEAPONSMITH_FIRE: -1,
    BUILDING_WEAPONSMITH_WATER: -1,
    BUILDING_WEAPONSMITH_WIND: -1,
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
