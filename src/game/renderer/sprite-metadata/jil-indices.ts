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
import { EMaterialType } from '../../economy';

// ============================================================
// Unit job indices — settler files (20-24.jil)
// ============================================================

/**
 * Mapping from UnitType to JIL job index in settler files (20-24.jil).
 * The job index is the same across all race files - only the GFX file number differs.
 * These indices map to unit sprites via JIL -> DIL -> GIL -> GFX.
 *
 * Each job has 6 directions (D0-D5) matching hex grid directions.
 */
export const UNIT_JOB_INDICES: Partial<Record<UnitType, number>> = {
    // Job 0: Unknown/placeholder
    [UnitType.Carrier]: 1, // Carrier without goods (walk cycle)
    [UnitType.Builder]: 19, // Construction worker
    [UnitType.Woodcutter]: 5, // Woodcutter
    [UnitType.Swordsman]: 227, // Lvl1 swordsman (first of pair 227/228)
    [UnitType.Bowman]: 236, // Lvl1 bowman standing (236-240 = set1, 242-246 = set2)
    [UnitType.Digger]: 50, // Digger/Landscaper walk
    [UnitType.Smith]: 52, // Smith idle
    [UnitType.Miner]: 60, // Miner walk
    [UnitType.Forester]: 62, // Forester idle
    [UnitType.Farmer]: 65, // Farmer idle
    [UnitType.AgaveFarmer]: 65, // Agave farmer (same sprite as farmer)
    [UnitType.Beekeeper]: 65, // Beekeeper (same sprite as farmer)
    [UnitType.Priest]: 287, // Priest idle/walk (288 is alternate?)
    [UnitType.Geologist]: 290, // Geologist idle
    [UnitType.Pioneer]: 298, // Pioneer idle
    [UnitType.Thief]: -1, // TODO: Not yet identified
    [UnitType.SawmillWorker]: 96, // Sawmill worker idle
    // Dark Tribe specific (file 23.jil)
    [UnitType.MushroomFarmer]: 313, // Mushroom farmer
};

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
 * Use -1 for unmapped animations (not yet identified in JIL files).
 */
export const WORKER_JOB_INDICES = {
    // Carrier (transports goods)
    carrier: {
        idle: [44, 45, 46, 47, 48], // idle animation variants
        walk: 1,
        work: [49], // striking/protesting
    },
    // Digger/Landscaper (uses shovel)
    digger: {
        idle: -1, // TODO: unmapped
        walk: 50,
        work: [51], // digging
    },
    // Smithy worker
    smith: {
        idle: 52,
    },
    // Builder
    builder: {
        idle: -1, // TODO: unmapped (may share with walk pose)
        walk: 53, // Note: also at job 19
    },
    // Woodcutter
    woodcutter: {
        idle: -1, // TODO: unmapped (may share with walk pose)
        walk: 54, // Note: also at job 5
        carry: 55, // carrying log
        work: [56, 57], // [chopping standing tree, cutting fallen log]
    },
    sawmillworker: {
        idle: 96,
        carry: [97, 98], // carrying, carrying2
        work: [99], // working
        pickup: [100, 101], // picking up, picking up2
    },
    // Miner
    miner: {
        idle: 58,
        walk: 60,
        carry: 61, // carrying stone
        work: [59], // mining
    },
    // Forester
    forester: {
        idle: 62,
        carry: 63, // carrying plant
        work: [64], // planting
    },
    // Farmer (grain, agave farmer, beekeeper share same sprites)
    farmer: {
        idle: 65,
        carry: 66, // carrying grain
        work: [67, 68], // [seeding phase 1, seeding phase 2]
    },
    agavefarmer: {
        idle: 65,
        carry: 66,
        work: [67, 68],
    },
    beekeeper: {
        idle: 65,
        carry: 66,
        work: [67, 68],
    },
    // Priest
    priest: {
        idle: 287,
        alternate: 288, // Unknown purpose
    },
    // Geologist
    geologist: {
        idle: 290,
        work: [291, 292, 293, 294, 295, 296, 297], // Different work phases
    },
    // Pioneer
    pioneer: {
        idle: 298,
        work: [299, 300], // [working phase 1, working phase 2]
    },
    // Swordsman levels: 2 indices each — base (idle frame 0 + walk frames 1+) and fight
    swordsman_1: {
        idle: 227,
        walk: 227, // walk = frames 1+ of base index (same as idle)
        fight: [228],
    },
    swordsman_2: {
        idle: 230,
        walk: 230,
        fight: [231],
    },
    swordsman_3: {
        idle: 233,
        walk: 233,
        fight: [234],
    },
    // Bowman levels (first is idle, rest are shooting animations; fight reuses shooting)
    bowman_1: {
        idle: 236,
        work: [237, 238, 239, 240], // shooting variants
        fight: [237], // shooting = fighting
    },
    bowman_2: {
        idle: 242,
        work: [243, 244, 245, 246],
        fight: [243],
    },
    bowman_3: {
        idle: 248,
        work: [249, 250, 251, 252],
        fight: [249],
    },
} as const;

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
 * Job 1 is the empty carrier (already in UNIT_JOB_INDICES).
 * Carrier job indices follow the same pattern as resource JIL indices (3.jil) but +1.
 * E.g., AGAVE resource is job #1, carrier with AGAVE is job #2.
 */
export const CARRIER_MATERIAL_JOB_INDICES: Partial<Record<EMaterialType, number>> = Object.fromEntries(
    Object.entries(RESOURCE_JOB_INDICES).map(([type, idx]) => [Number(type), idx + 1])
) as Partial<Record<EMaterialType, number>>;
