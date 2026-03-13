import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';
import type { BuildStep } from '../types';

// ─── Shared economy core (identical for all races) ───────────────

const WOOD_AND_BOARDS: readonly BuildStep[] = [
    { buildingType: BuildingType.WoodcutterHut, count: 2 },
    { buildingType: BuildingType.ForesterHut, count: 1 },
    { buildingType: BuildingType.Sawmill, count: 1 },
];

const STONE: readonly BuildStep[] = [{ buildingType: BuildingType.StonecutterHut, count: 1 }];

const FIRST_RESIDENCE: readonly BuildStep[] = [{ buildingType: BuildingType.ResidenceSmall, count: 1 }];

const FOOD: readonly BuildStep[] = [
    { buildingType: BuildingType.GrainFarm, count: 1 },
    { buildingType: BuildingType.Mill, count: 1 },
    { buildingType: BuildingType.Bakery, count: 1 },
    { buildingType: BuildingType.WaterworkHut, count: 1 },
];

const MINING: readonly BuildStep[] = [
    { buildingType: BuildingType.CoalMine, count: 1 },
    { buildingType: BuildingType.IronMine, count: 1 },
];

const WEAPONS: readonly BuildStep[] = [
    { buildingType: BuildingType.IronSmelter, count: 1 },
    { buildingType: BuildingType.WeaponSmith, count: 1 },
];

const MILITARY: readonly BuildStep[] = [{ buildingType: BuildingType.Barrack, count: 1 }];

const SECOND_RESIDENCE: readonly BuildStep[] = [{ buildingType: BuildingType.ResidenceSmall, count: 1 }];

// ─── Race-specific drink chains ──────────────────────────────────

const ROMAN_DRINK: readonly BuildStep[] = [{ buildingType: BuildingType.Vinyard, count: 1 }];

const VIKING_DRINK: readonly BuildStep[] = [
    { buildingType: BuildingType.BeekeeperHut, count: 1 },
    { buildingType: BuildingType.MeadMakerHut, count: 1 },
];

const MAYAN_DRINK: readonly BuildStep[] = [
    { buildingType: BuildingType.AgaveFarmerHut, count: 1 },
    { buildingType: BuildingType.TequilaMakerHut, count: 1 },
];

const TROJAN_DRINK: readonly BuildStep[] = [
    { buildingType: BuildingType.SunflowerFarmerHut, count: 1 },
    { buildingType: BuildingType.SunflowerOilMakerHut, count: 1 },
];

// ─── Drink chain lookup ──────────────────────────────────────────

function getDrinkChain(race: Race): readonly BuildStep[] {
    switch (race) {
        case Race.Roman:
            return ROMAN_DRINK;
        case Race.Viking:
            return VIKING_DRINK;
        case Race.Mayan:
            return MAYAN_DRINK;
        case Race.Trojan:
            return TROJAN_DRINK;
        case Race.DarkTribe:
            throw new Error('getBuildOrder: DarkTribe is not supported (deferred scope)');
    }
}

// ─── Build order assembly ────────────────────────────────────────

function assembleBuildOrder(race: Race): readonly BuildStep[] {
    return [
        ...WOOD_AND_BOARDS,
        ...STONE,
        ...FIRST_RESIDENCE,
        ...FOOD,
        ...getDrinkChain(race),
        ...MINING,
        ...WEAPONS,
        ...MILITARY,
        ...SECOND_RESIDENCE,
    ];
}

/** Cached build orders per race (assembled once, reused). */
const buildOrderCache = new Map<Race, readonly BuildStep[]>();

/**
 * Get the default build order for a race.
 *
 * Returns a frozen array of BuildSteps defining which buildings to
 * place and in what order. The core economy is shared across all
 * races; only the drink production chain differs.
 *
 * @throws if race is DarkTribe (not yet supported)
 */
export function getBuildOrder(race: Race): readonly BuildStep[] {
    let order = buildOrderCache.get(race);
    if (order === undefined) {
        order = Object.freeze(assembleBuildOrder(race));
        buildOrderCache.set(race, order);
    }
    return order;
}
