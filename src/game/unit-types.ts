/**
 * Unit type definitions and configuration.
 * Centralized unit-related types, enums, and configuration.
 *
 * Military unit types with levels encode the level in the UnitType value:
 * e.g. Swordsman (L1), Swordsman2 (L2), Swordsman3 (L3).
 * Use getUnitLevel() to extract level, getBaseUnitType() to get the L1 variant.
 */

export enum UnitType {
    // ── Common workers (all non-Dark-Tribe races) ──
    Carrier = 0,
    Builder = 1,
    Digger = 2,
    Woodcutter = 3,
    Stonecutter = 4,
    Forester = 5,
    Farmer = 6,
    Fisher = 7,
    Hunter = 8,
    Miner = 9,
    Smelter = 10,
    Smith = 11,
    SawmillWorker = 12,
    Miller = 13,
    Baker = 14,
    Butcher = 15,
    AnimalFarmer = 16,
    Waterworker = 17,
    Healer = 18,
    Donkey = 19,
    // ── Race-specific economy workers ──
    Winemaker = 20, // Roman
    Beekeeper = 21, // Viking
    Meadmaker = 22, // Viking
    AgaveFarmer = 23, // Mayan
    Tequilamaker = 24, // Mayan
    SunflowerFarmer = 25, // Trojan
    SunflowerOilMaker = 26, // Trojan
    // ── Military (L1 base + L2/L3 variants) ──
    Swordsman1 = 27,
    Swordsman2 = 28,
    Swordsman3 = 29,
    Bowman1 = 30,
    Bowman2 = 31,
    Bowman3 = 32,
    SquadLeader = 33,
    // ── Race-specific specialists (L1 + L2/L3) ──
    Medic1 = 34, // Roman
    Medic2 = 35,
    Medic3 = 36,
    AxeWarrior1 = 37, // Viking (same JIL as Medic, different race file)
    AxeWarrior2 = 38,
    AxeWarrior3 = 39,
    BlowgunWarrior1 = 40, // Mayan
    BlowgunWarrior2 = 41,
    BlowgunWarrior3 = 42,
    BackpackCatapultist1 = 43, // Trojan
    BackpackCatapultist2 = 44,
    BackpackCatapultist3 = 45,
    // ── Non-military specialists ──
    Priest = 46,
    Pioneer = 47,
    Thief = 48,
    Geologist = 49,
    Saboteur = 50,
    Gardener = 51, // All non-Dark-Tribe races (JIL 308-310)
    // ── Dark Tribe exclusive ──
    DarkGardener = 52,
    Shaman = 53,
    MushroomFarmer = 54,
    SlavedSettler = 55,
    TempleServant = 56,
    ManacopterMaster = 57,
    Angel = 58,
    Angel2 = 59,
    Angel3 = 60,
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
    // ── Common workers ──
    [UnitType.Carrier]: { name: 'Carrier', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Builder]: { name: 'Builder', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Digger]: { name: 'Digger', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Woodcutter]: { name: 'Woodcutter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Stonecutter]: { name: 'Stonecutter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Forester]: { name: 'Forester', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Farmer]: { name: 'Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Fisher]: { name: 'Fisher', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Hunter]: { name: 'Hunter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Miner]: { name: 'Miner', category: UnitCategory.Worker, speed: 1.5 },
    [UnitType.Smelter]: { name: 'Smelter', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Smith]: { name: 'Smith', category: UnitCategory.Worker, speed: 2 },
    [UnitType.SawmillWorker]: { name: 'Sawmill Worker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Miller]: { name: 'Miller', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Baker]: { name: 'Baker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Butcher]: { name: 'Butcher', category: UnitCategory.Worker, speed: 2 },
    [UnitType.AnimalFarmer]: { name: 'Animal Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Waterworker]: { name: 'Water Worker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Healer]: { name: 'Healer', category: UnitCategory.Worker, speed: 1.5 },
    [UnitType.Donkey]: { name: 'Donkey', category: UnitCategory.Worker, speed: 1.5 },
    // ── Race-specific economy workers ──
    [UnitType.Winemaker]: { name: 'Wine Maker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Beekeeper]: { name: 'Beekeeper', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Meadmaker]: { name: 'Mead Maker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.AgaveFarmer]: { name: 'Agave Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Tequilamaker]: { name: 'Tequila Maker', category: UnitCategory.Worker, speed: 2 },
    [UnitType.SunflowerFarmer]: { name: 'Sunflower Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.SunflowerOilMaker]: { name: 'Sunflower Oil Maker', category: UnitCategory.Worker, speed: 2 },
    // ── Military ──
    [UnitType.Swordsman1]: { name: 'Swordsman', category: UnitCategory.Military, speed: 2 },
    [UnitType.Swordsman2]: { name: 'Swordsman L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.Swordsman3]: { name: 'Swordsman L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.Bowman1]: { name: 'Bowman', category: UnitCategory.Military, speed: 2.2 },
    [UnitType.Bowman2]: { name: 'Bowman L2', category: UnitCategory.Military, speed: 2.2 },
    [UnitType.Bowman3]: { name: 'Bowman L3', category: UnitCategory.Military, speed: 2.2 },
    [UnitType.SquadLeader]: { name: 'Squad Leader', category: UnitCategory.Military, speed: 2 },
    // ── Race-specific specialists ──
    [UnitType.Medic1]: { name: 'Medic', category: UnitCategory.Military, speed: 2 },
    [UnitType.Medic2]: { name: 'Medic L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.Medic3]: { name: 'Medic L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.AxeWarrior1]: { name: 'Axe Warrior', category: UnitCategory.Military, speed: 2 },
    [UnitType.AxeWarrior2]: { name: 'Axe Warrior L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.AxeWarrior3]: { name: 'Axe Warrior L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.BlowgunWarrior1]: { name: 'Blowgun Warrior', category: UnitCategory.Military, speed: 2 },
    [UnitType.BlowgunWarrior2]: { name: 'Blowgun Warrior L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.BlowgunWarrior3]: { name: 'Blowgun Warrior L3', category: UnitCategory.Military, speed: 2 },
    [UnitType.BackpackCatapultist1]: { name: 'Backpack Catapultist', category: UnitCategory.Military, speed: 2 },
    [UnitType.BackpackCatapultist2]: { name: 'Backpack Catapultist L2', category: UnitCategory.Military, speed: 2 },
    [UnitType.BackpackCatapultist3]: { name: 'Backpack Catapultist L3', category: UnitCategory.Military, speed: 2 },
    // ── Non-military specialists ──
    [UnitType.Priest]: { name: 'Priest', category: UnitCategory.Religious, speed: 1.5 },
    [UnitType.Pioneer]: { name: 'Pioneer', category: UnitCategory.Specialist, speed: 2 },
    [UnitType.Thief]: { name: 'Thief', category: UnitCategory.Specialist, speed: 3 },
    [UnitType.Geologist]: { name: 'Geologist', category: UnitCategory.Specialist, speed: 1.5 },
    [UnitType.Saboteur]: { name: 'Saboteur', category: UnitCategory.Specialist, speed: 2 },
    [UnitType.Gardener]: { name: 'Gardener', category: UnitCategory.Specialist, speed: 1.5 },
    // ── Dark Tribe exclusive ──
    [UnitType.DarkGardener]: { name: 'Dark Gardener', category: UnitCategory.Worker, speed: 2 },
    [UnitType.Shaman]: { name: 'Shaman', category: UnitCategory.Religious, speed: 1.5 },
    [UnitType.MushroomFarmer]: { name: 'Mushroom Farmer', category: UnitCategory.Worker, speed: 2 },
    [UnitType.SlavedSettler]: { name: 'Slaved Settler', category: UnitCategory.Worker, speed: 2 },
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
    [UnitType.Swordsman1, [UnitType.Swordsman1, UnitType.Swordsman2, UnitType.Swordsman3]],
    [UnitType.Bowman1, [UnitType.Bowman1, UnitType.Bowman2, UnitType.Bowman3]],
    [UnitType.Medic1, [UnitType.Medic1, UnitType.Medic2, UnitType.Medic3]],
    [UnitType.AxeWarrior1, [UnitType.AxeWarrior1, UnitType.AxeWarrior2, UnitType.AxeWarrior3]],
    [UnitType.BlowgunWarrior1, [UnitType.BlowgunWarrior1, UnitType.BlowgunWarrior2, UnitType.BlowgunWarrior3]],
    [
        UnitType.BackpackCatapultist1,
        [UnitType.BackpackCatapultist1, UnitType.BackpackCatapultist2, UnitType.BackpackCatapultist3],
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

/** Check if a unit type is an angel (ephemeral death effect, not a real settler). */
export function isAngelUnitType(type: UnitType): boolean {
    return type === UnitType.Angel || type === UnitType.Angel2 || type === UnitType.Angel3;
}

/** Get all unit types in a specific category. */
export function getUnitTypesInCategory(category: UnitCategory): UnitType[] {
    return Object.entries(UNIT_TYPE_CONFIG)
        .filter(([, config]) => config.category === category)
        .map(([type]) => Number(type) as UnitType);
}
