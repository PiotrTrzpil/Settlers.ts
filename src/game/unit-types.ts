/**
 * Unit type definitions and configuration.
 * Centralized unit-related types, enums, and configuration.
 *
 * Military unit types with levels encode the level in the UnitType value:
 * e.g. Swordsman (L1), Swordsman2 (L2), Swordsman3 (L3).
 * Use getUnitLevel() to extract level, getBaseUnitType() to get the L1 variant.
 */

export enum UnitType {
    Carrier = 0,
    Builder = 1,
    Swordsman = 2, // L1
    Bowman = 3, // L1
    // Removed: Pikeman = 4 (doesn't exist in S4, race-specific variants are Axewarrior/Blowgunwarrior)
    Priest = 5,
    Pioneer = 6,
    Thief = 7,
    Geologist = 8,
    Woodcutter = 9,
    Miner = 10,
    Forester = 11,
    Farmer = 12,
    Smith = 13,
    Digger = 14, // Landscaper/Shovelworker
    SawmillWorker = 15,
    Miller = 16,
    Butcher = 17,
    Stonecutter = 18,
    SquadLeader = 19,
    DarkGardener = 20,
    Shaman = 21,
    Medic = 22, // L1 — Roman specialist
    Hunter = 23,
    Healer = 24,
    Smelter = 25,
    Donkey = 26,
    MushroomFarmer = 27,
    SlavedSettler = 28, // Dark Tribe (no levels)
    AgaveFarmer = 29,
    Beekeeper = 30,
    AxeWarrior = 31, // L1 — Viking specialist (same JIL as Medic, different race file)
    BlowgunWarrior = 32, // L1 — Mayan specialist
    BackpackCatapultist = 33, // L1 — Trojan specialist
    // Level 2/3 variants for military units
    Swordsman2 = 34,
    Swordsman3 = 35,
    Bowman2 = 36,
    Bowman3 = 37,
    Medic2 = 38,
    Medic3 = 39,
    AxeWarrior2 = 42,
    AxeWarrior3 = 43,
    BlowgunWarrior2 = 44,
    BlowgunWarrior3 = 45,
    BackpackCatapultist2 = 46,
    BackpackCatapultist3 = 47,
    Winemaker = 48,
    Meadmaker = 49,
    Tequilamaker = 50,
    Saboteur = 51,
    TempleServant = 52,
    ManacopterMaster = 53,
    Angel = 54, // L1 — Dark Tribe, distinct from SlavedSettler
    Angel2 = 55,
    Angel3 = 56,
}

/**
 * Upper-level unit categories.
 * Determines selectability and general behavior grouping.
 */
export enum UnitCategory {
    /** Worker units - not selectable, perform automated tasks (Carrier, Builder, Woodcutter) */
    Worker = 'worker',
    /** Military units - selectable, can fight (Swordsman, Bowman) */
    Military = 'military',
    /** Religious units - selectable, special abilities (Priest) */
    Religious = 'religious',
    /** Specialist units - not selectable, perform specific jobs (Pioneer, Thief, Geologist) */
    Specialist = 'specialist',
}

/**
 * Configuration for each unit type.
 * Centralizes all unit properties so adding new types is a single-entry change.
 */
export interface UnitTypeConfig {
    /** Display name for UI */
    name: string;
    /** Upper-level category determining selectability and behavior grouping */
    category: UnitCategory;
    /** Default movement speed in tiles/second */
    speed: number;
}

/**
 * Central registry of unit type configurations.
 * To add a new unit type:
 * 1. Add an entry to the UnitType enum
 * 2. Add its config here
 * 3. Optionally add it to BUILDING_SPAWN_ON_COMPLETE if a building produces it
 */
export const UNIT_TYPE_CONFIG: Record<UnitType, UnitTypeConfig> = {
    [UnitType.Carrier]: { name: 'Carrier', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Builder]: { name: 'Builder', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Swordsman]: { name: 'Swordsman', category: UnitCategory.Military, speed: 2 },
    [UnitType.Bowman]: { name: 'Bowman', category: UnitCategory.Military, speed: 2.2 },
    [UnitType.Priest]: { name: 'Priest', category: UnitCategory.Religious, speed: 1.5 },
    [UnitType.Pioneer]: { name: 'Pioneer', category: UnitCategory.Specialist, speed: 2 },
    [UnitType.Thief]: { name: 'Thief', category: UnitCategory.Specialist, speed: 3 },
    [UnitType.Geologist]: { name: 'Geologist', category: UnitCategory.Specialist, speed: 1.5 },
    [UnitType.Woodcutter]: { name: 'Woodcutter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Miner]: { name: 'Miner', category: UnitCategory.Worker, speed: 1.5 },
    [UnitType.Forester]: { name: 'Forester', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Farmer]: { name: 'Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Smith]: { name: 'Smith', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Digger]: { name: 'Digger', category: UnitCategory.Worker, speed: 2 },
    [UnitType.SawmillWorker]: { name: 'Sawmill Worker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Miller]: { name: 'Miller', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Butcher]: { name: 'Butcher', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Stonecutter]: { name: 'Stonecutter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.SquadLeader]: { name: 'Squad Leader', category: UnitCategory.Military, speed: 2 },
    [UnitType.DarkGardener]: { name: 'Dark Gardener', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Shaman]: { name: 'Shaman', category: UnitCategory.Religious, speed: 1.5 },
    [UnitType.Medic]: { name: 'Medic', category: UnitCategory.Military, speed: 2 },
    [UnitType.Hunter]: { name: 'Hunter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Healer]: { name: 'Healer', category: UnitCategory.Military, speed: 1.5 },
    [UnitType.Smelter]: { name: 'Smelter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Donkey]: { name: 'Donkey', category: UnitCategory.Worker, speed: 1.5 },
    [UnitType.MushroomFarmer]: { name: 'Mushroom Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.SlavedSettler]: { name: 'Angel', category: UnitCategory.Worker, speed: 2 },
    [UnitType.AgaveFarmer]: { name: 'Agave Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Beekeeper]: { name: 'Beekeeper', category: UnitCategory.Worker, speed: 2 },
    [UnitType.AxeWarrior]: { name: 'Axe Warrior', category: UnitCategory.Military, speed: 2 },
    [UnitType.BlowgunWarrior]: { name: 'Blowgun Warrior', category: UnitCategory.Military, speed: 2 },
    [UnitType.BackpackCatapultist]: { name: 'Backpack Catapultist', category: UnitCategory.Military, speed: 2 },
    [UnitType.Swordsman2]: { name: 'Swordsman L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.Swordsman3]: { name: 'Swordsman L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.Bowman2]: { name: 'Bowman L2', category: UnitCategory.Military, speed: 2.2 },
    [UnitType.Bowman3]: { name: 'Bowman L3', category: UnitCategory.Military, speed: 2.2 },
    [UnitType.Medic2]: { name: 'Medic L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.Medic3]: { name: 'Medic L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.AxeWarrior2]: { name: 'Axe Warrior L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.AxeWarrior3]: { name: 'Axe Warrior L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.BlowgunWarrior2]: { name: 'Blowgun Warrior L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.BlowgunWarrior3]: { name: 'Blowgun Warrior L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.BackpackCatapultist2]: { name: 'Backpack Catapultist L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.BackpackCatapultist3]: { name: 'Backpack Catapultist L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.Winemaker]: { name: 'Wine Maker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Meadmaker]: { name: 'Mead Maker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Tequilamaker]: { name: 'Tequila Maker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Saboteur]: { name: 'Saboteur', category: UnitCategory.Specialist, speed: 2 },
    [UnitType.TempleServant]: { name: 'Temple Servant', category: UnitCategory.Worker, speed: 2 },
    [UnitType.ManacopterMaster]: { name: 'Manacopter Master', category: UnitCategory.Military, speed: 2 },
    [UnitType.Angel]: { name: 'Angel', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Angel2]: { name: 'Angel L2', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Angel3]: { name: 'Angel L3', category: UnitCategory.Worker, speed: 2 },
};

/** Categories that allow player selection */
const SELECTABLE_CATEGORIES: ReadonlySet<UnitCategory> = new Set([
    UnitCategory.Military,
    UnitCategory.Religious,
    UnitCategory.Specialist,
]);

// ─── Leveled unit type helpers ──────────────────────────────────────────────

/**
 * Level groupings: base L1 type → [L1, L2, L3].
 * Only unit types that have level variants are listed here.
 */
const LEVEL_GROUPS: ReadonlyMap<UnitType, readonly [UnitType, UnitType, UnitType]> = new Map([
    [UnitType.Swordsman, [UnitType.Swordsman, UnitType.Swordsman2, UnitType.Swordsman3]],
    [UnitType.Bowman, [UnitType.Bowman, UnitType.Bowman2, UnitType.Bowman3]],
    [UnitType.Medic, [UnitType.Medic, UnitType.Medic2, UnitType.Medic3]],
    [UnitType.AxeWarrior, [UnitType.AxeWarrior, UnitType.AxeWarrior2, UnitType.AxeWarrior3]],
    [UnitType.BlowgunWarrior, [UnitType.BlowgunWarrior, UnitType.BlowgunWarrior2, UnitType.BlowgunWarrior3]],
    [
        UnitType.BackpackCatapultist,
        [UnitType.BackpackCatapultist, UnitType.BackpackCatapultist2, UnitType.BackpackCatapultist3],
    ],
    [UnitType.Angel, [UnitType.Angel, UnitType.Angel2, UnitType.Angel3]],
]);

/** Reverse map: any leveled UnitType → { base, level }. Built once from LEVEL_GROUPS. */
const LEVEL_INFO: ReadonlyMap<UnitType, { base: UnitType; level: number }> = (() => {
    const m = new Map<UnitType, { base: UnitType; level: number }>();
    for (const [base, variants] of LEVEL_GROUPS) {
        for (let i = 0; i < variants.length; i++) {
            m.set(variants[i]!, { base, level: i + 1 });
        }
    }
    return m;
})();

/** Get the combat level (1-3) for a unit type. Non-leveled types return 1. */
export function getUnitLevel(unitType: UnitType): number {
    return LEVEL_INFO.get(unitType)?.level ?? 1;
}

/** Get the L1 base type for a leveled unit (e.g. Swordsman3 → Swordsman). Returns itself for non-leveled types. */
export function getBaseUnitType(unitType: UnitType): UnitType {
    return LEVEL_INFO.get(unitType)?.base ?? unitType;
}

/** Get all level variants [L1, L2, L3] for a unit type. Returns undefined for non-leveled types. */
export function getLevelVariants(unitType: UnitType): readonly [UnitType, UnitType, UnitType] | undefined {
    const base = getBaseUnitType(unitType);
    return LEVEL_GROUPS.get(base);
}

/** Get the UnitType for a specific level of a leveled unit. Returns the input type if not leveled. */
export function getUnitTypeAtLevel(unitType: UnitType, level: number): UnitType {
    const variants = getLevelVariants(unitType);
    if (!variants) return unitType;
    return variants[Math.max(0, Math.min(2, level - 1))]!;
}

// ─── Standard helpers ───────────────────────────────────────────────────────

/** Get the category for a unit type. */
export function getUnitCategory(unitType: UnitType): UnitCategory {
    return UNIT_TYPE_CONFIG[unitType].category;
}

/** Check if a unit type is selectable (Military and Religious categories). */
export function isUnitTypeSelectable(unitType: UnitType): boolean {
    const category = getUnitCategory(unitType);
    return SELECTABLE_CATEGORIES.has(category);
}

/** Check if a unit type is military (can fight). */
export function isUnitTypeMilitary(unitType: UnitType): boolean {
    return getUnitCategory(unitType) === UnitCategory.Military;
}

/** Get the default speed for a unit type. */
export function getUnitTypeSpeed(unitType: UnitType): number {
    return UNIT_TYPE_CONFIG[unitType].speed;
}

/** Get all unit types in a specific category. */
export function getUnitTypesInCategory(category: UnitCategory): UnitType[] {
    return Object.entries(UNIT_TYPE_CONFIG)
        .filter(([, config]) => config.category === category)
        .map(([type]) => Number(type) as UnitType);
}
