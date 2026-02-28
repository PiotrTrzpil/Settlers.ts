/**
 * Static palette data for the sidebar UI: buildings, units, and resources.
 * Extracted from use-map-view.ts to keep file sizes manageable.
 */

import { UnitType, BuildingType } from '@/game/entity';
import { EMaterialType, DROPPABLE_MATERIALS } from '@/game/economy';

/** All building definitions for the UI — filtered by race at runtime */
export const ALL_BUILDINGS = [
    // --- Storage ---
    { type: BuildingType.StorageArea, id: 'warehouse', name: 'Warehouse', icon: '📦' },

    // --- Residential ---
    { type: BuildingType.ResidenceSmall, id: 'smallhouse', name: 'Small House', icon: '🏠' },
    { type: BuildingType.ResidenceMedium, id: 'mediumhouse', name: 'Medium House', icon: '🏡' },
    { type: BuildingType.ResidenceBig, id: 'largehouse', name: 'Large House', icon: '🏘️' },
    { type: BuildingType.LivingHouse, id: 'livinghouse', name: 'Living House', icon: '🛖' },

    // --- Wood & Stone ---
    { type: BuildingType.WoodcutterHut, id: 'woodcutter', name: 'Woodcutter Hut', icon: '🪓' },
    { type: BuildingType.ForesterHut, id: 'forester', name: 'Forester', icon: '🌲' },
    { type: BuildingType.Sawmill, id: 'sawmill', name: 'Sawmill', icon: '🪚' },
    { type: BuildingType.StonecutterHut, id: 'stonecutter', name: 'Stonecutter', icon: '🪨' },
    { type: BuildingType.StoneMine, id: 'stonemine', name: 'Stone Mine', icon: '⛰️' },

    // --- Food Production ---
    { type: BuildingType.GrainFarm, id: 'farm', name: 'Farm', icon: '🌾' },
    { type: BuildingType.Mill, id: 'windmill', name: 'Windmill', icon: '🌀' },
    { type: BuildingType.Bakery, id: 'bakery', name: 'Bakery', icon: '🍞' },
    { type: BuildingType.FisherHut, id: 'fishery', name: 'Fishery', icon: '🐟' },
    { type: BuildingType.HunterHut, id: 'hunter', name: 'Hunter', icon: '🏹' },
    { type: BuildingType.AnimalRanch, id: 'pigfarm', name: 'Pig Farm', icon: '🐷' },
    { type: BuildingType.Slaughterhouse, id: 'slaughterhouse', name: 'Slaughter', icon: '🥩' },
    { type: BuildingType.WaterworkHut, id: 'waterworks', name: 'Waterworks', icon: '💧' },
    { type: BuildingType.Vinyard, id: 'vinyard', name: 'Vineyard', icon: '🍇' },
    { type: BuildingType.BeekeeperHut, id: 'beekeeper', name: 'Beekeeper', icon: '🐝' },
    { type: BuildingType.MeadMakerHut, id: 'meadmaker', name: 'Mead Maker', icon: '🍯' },
    { type: BuildingType.AgaveFarmerHut, id: 'agavefarmer', name: 'Agave Farm', icon: '🌵' },
    { type: BuildingType.TequilaMakerHut, id: 'tequilamaker', name: 'Tequila Maker', icon: '🥃' },
    { type: BuildingType.SunflowerFarmerHut, id: 'sunflowerfarmer', name: 'Sunflower Farm', icon: '🌻' },
    { type: BuildingType.SunflowerOilMakerHut, id: 'sunfloweroilmaker', name: 'Oil Press', icon: '🫒' },
    { type: BuildingType.DonkeyRanch, id: 'donkeyfarm', name: 'Donkey Farm', icon: '🫏' },

    // --- Mining & Smelting ---
    { type: BuildingType.CoalMine, id: 'coalmine', name: 'Coal Mine', icon: '⛏️' },
    { type: BuildingType.IronMine, id: 'ironmine', name: 'Iron Mine', icon: '🔩' },
    { type: BuildingType.GoldMine, id: 'goldmine', name: 'Gold Mine', icon: '🪙' },
    { type: BuildingType.SulfurMine, id: 'sulfurmine', name: 'Sulfur Mine', icon: '💛' },
    { type: BuildingType.IronSmelter, id: 'ironsmelter', name: 'Iron Smelter', icon: '🔥' },
    { type: BuildingType.SmeltGold, id: 'goldsmelter', name: 'Gold Smelter', icon: '✨' },

    // --- Crafting ---
    { type: BuildingType.WeaponSmith, id: 'weaponsmith', name: 'Weaponsmith', icon: '⚔️' },
    { type: BuildingType.ToolSmith, id: 'toolsmith', name: 'Toolsmith', icon: '🔧' },
    { type: BuildingType.AmmunitionMaker, id: 'ammomaker', name: 'Ammo Maker', icon: '🎯' },

    // --- Military ---
    { type: BuildingType.Barrack, id: 'barrack', name: 'Barrack', icon: '🛡️' },
    { type: BuildingType.GuardTowerSmall, id: 'tower', name: 'Tower', icon: '🗼' },
    { type: BuildingType.GuardTowerBig, id: 'largetower', name: 'Large Tower', icon: '🏰' },
    { type: BuildingType.LookoutTower, id: 'scouttower', name: 'Scout Tower', icon: '👁️' },
    { type: BuildingType.Castle, id: 'castle', name: 'Castle', icon: '🏯' },
    { type: BuildingType.SiegeWorkshop, id: 'siegeworkshop', name: 'Siege Works', icon: '⚙️' },

    // --- Special ---
    { type: BuildingType.HealerHut, id: 'healer', name: 'Healer', icon: '💊' },
    { type: BuildingType.SmallTemple, id: 'smalltemple', name: 'Small Temple', icon: '⛩️' },
    { type: BuildingType.LargeTemple, id: 'largetemple', name: 'Large Temple', icon: '🕌' },
    { type: BuildingType.Shipyard, id: 'shipyard', name: 'Shipyard', icon: '⛵' },
    { type: BuildingType.Eyecatcher01, id: 'eyecatcher01', name: 'Eyecatcher 1', icon: '🕯️' },
    { type: BuildingType.Eyecatcher02, id: 'eyecatcher02', name: 'Eyecatcher 2', icon: '🏛️' },

    // --- Dark Tribe ---
    { type: BuildingType.MushroomFarm, id: 'mushroomfarm', name: 'Mushroom Farm', icon: '🍄' },
    { type: BuildingType.DarkTemple, id: 'darktemple', name: 'Dark Temple', icon: '🏚️' },
    { type: BuildingType.Fortress, id: 'fortress', name: 'Fortress', icon: '🏰' },
    { type: BuildingType.ManaCopterHall, id: 'manacopter', name: 'Mana Copter Hall', icon: '👼' },
];

/** All unit definitions for the UI — each military type has 3 level entries */
export const ALL_UNITS: { type: UnitType; id: string; name: string; icon: string; level?: number }[] = [
    { type: UnitType.Carrier, id: 'carrier', name: 'Carrier', icon: '🧑' },
    { type: UnitType.Builder, id: 'builder', name: 'Builder', icon: '👷' },
    { type: UnitType.Woodcutter, id: 'woodcutter', name: 'Woodcutter', icon: '🪓' },
    { type: UnitType.Miner, id: 'miner', name: 'Miner', icon: '⛏️' },
    { type: UnitType.Forester, id: 'forester', name: 'Forester', icon: '🌲' },
    { type: UnitType.Farmer, id: 'farmer', name: 'Farmer', icon: '🌾' },
    { type: UnitType.Smith, id: 'smith', name: 'Smith', icon: '🔨' },
    { type: UnitType.Digger, id: 'digger', name: 'Digger', icon: '🕳️' },
    { type: UnitType.SawmillWorker, id: 'sawmillworker', name: 'Sawmill Worker', icon: '🪚' },
    { type: UnitType.Swordsman, id: 'swordsman-1', name: 'Swordsman L1', icon: '⚔️', level: 1 },
    { type: UnitType.Swordsman, id: 'swordsman-2', name: 'Swordsman L2', icon: '⚔️', level: 2 },
    { type: UnitType.Swordsman, id: 'swordsman-3', name: 'Swordsman L3', icon: '⚔️', level: 3 },
    { type: UnitType.Bowman, id: 'bowman-1', name: 'Bowman L1', icon: '🏹', level: 1 },
    { type: UnitType.Bowman, id: 'bowman-2', name: 'Bowman L2', icon: '🏹', level: 2 },
    { type: UnitType.Bowman, id: 'bowman-3', name: 'Bowman L3', icon: '🏹', level: 3 },
    { type: UnitType.Priest, id: 'priest', name: 'Priest', icon: '🙏' },
    { type: UnitType.Pioneer, id: 'pioneer', name: 'Pioneer', icon: '🚩' },
    { type: UnitType.Thief, id: 'thief', name: 'Thief', icon: '🥷' },
    { type: UnitType.Geologist, id: 'geologist', name: 'Geologist', icon: '🔍' },
    { type: UnitType.Miller, id: 'miller', name: 'Miller', icon: '🌀' },
    { type: UnitType.Butcher, id: 'butcher', name: 'Butcher', icon: '🥩' },
    { type: UnitType.Stonecutter, id: 'stonecutter', name: 'Stonecutter', icon: '🪨' },
    { type: UnitType.SquadLeader, id: 'squadleader', name: 'Squad Leader', icon: '🎖️' },
    { type: UnitType.DarkGardener, id: 'darkgardener', name: 'Dark Gardener', icon: '🍄' },
    { type: UnitType.Shaman, id: 'shaman', name: 'Shaman', icon: '🪄' },
    { type: UnitType.Medic, id: 'medic', name: 'Medic', icon: '🩺' },
    { type: UnitType.Hunter, id: 'hunter', name: 'Hunter', icon: '🏹' },
    { type: UnitType.Healer, id: 'healer', name: 'Healer', icon: '💊' },
    { type: UnitType.Smelter, id: 'smelter', name: 'Smelter', icon: '🔥' },
    { type: UnitType.Donkey, id: 'donkey', name: 'Donkey', icon: '🫏' },
    { type: UnitType.MushroomFarmer, id: 'mushroomfarmer', name: 'Mushroom Farmer', icon: '🍄' },
    { type: UnitType.AgaveFarmer, id: 'agavefarmer', name: 'Agave Farmer', icon: '🌵' },
    { type: UnitType.Beekeeper, id: 'beekeeper', name: 'Beekeeper', icon: '🐝' },
    { type: UnitType.SlavedSettler, id: 'slavedsettler', name: 'Slaved Settler', icon: '⛓️' },
    { type: UnitType.Angel, id: 'angel', name: 'Angel', icon: '👼' },
    { type: UnitType.Winemaker, id: 'winemaker', name: 'Wine Maker', icon: '🍷' },
    { type: UnitType.Meadmaker, id: 'meadmaker', name: 'Mead Maker', icon: '🍺' },
    { type: UnitType.Tequilamaker, id: 'tequilamaker', name: 'Tequila Maker', icon: '🥃' },
    { type: UnitType.Saboteur, id: 'saboteur', name: 'Saboteur', icon: '💥' },
    { type: UnitType.TempleServant, id: 'templeservant', name: 'Temple Servant', icon: '⛩️' },
    { type: UnitType.ManacopterMaster, id: 'manacoptermaster', name: 'Manacopter Master', icon: '🚁' },
    { type: UnitType.AxeWarrior, id: 'axewarrior', name: 'Axe Warrior', icon: '🪓' },
    { type: UnitType.BlowgunWarrior, id: 'blowgunwarrior', name: 'Blowgun Warrior', icon: '🎯' },
    { type: UnitType.BackpackCatapultist, id: 'backpackcatapultist', name: 'Backpack Catapultist', icon: '💣' },
    // Level 2/3 variants
    { type: UnitType.Swordsman2, id: 'swordsman2', name: 'Swordsman L2', icon: '⚔️' },
    { type: UnitType.Swordsman3, id: 'swordsman3', name: 'Swordsman L3', icon: '⚔️' },
    { type: UnitType.Bowman2, id: 'bowman2', name: 'Bowman L2', icon: '🏹' },
    { type: UnitType.Bowman3, id: 'bowman3', name: 'Bowman L3', icon: '🏹' },
    { type: UnitType.Medic2, id: 'medic2', name: 'Medic L2', icon: '🩺' },
    { type: UnitType.Medic3, id: 'medic3', name: 'Medic L3', icon: '🩺' },
    { type: UnitType.AxeWarrior2, id: 'axewarrior2', name: 'Axe Warrior L2', icon: '🪓' },
    { type: UnitType.AxeWarrior3, id: 'axewarrior3', name: 'Axe Warrior L3', icon: '🪓' },
    { type: UnitType.BlowgunWarrior2, id: 'blowgunwarrior2', name: 'Blowgun Warrior L2', icon: '🎯' },
    { type: UnitType.BlowgunWarrior3, id: 'blowgunwarrior3', name: 'Blowgun Warrior L3', icon: '🎯' },
    { type: UnitType.BackpackCatapultist2, id: 'backpackcatapultist2', name: 'Backpack Catapultist L2', icon: '💣' },
    { type: UnitType.BackpackCatapultist3, id: 'backpackcatapultist3', name: 'Backpack Catapultist L3', icon: '💣' },
    { type: UnitType.Angel2, id: 'angel2', name: 'Angel L2', icon: '👼' },
    { type: UnitType.Angel3, id: 'angel3', name: 'Angel L3', icon: '👼' },
];

// Runtime check in development: ensure all UnitType values are in ALL_UNITS
if (import.meta.env.DEV) {
    const unitTypesInArray = new Set(ALL_UNITS.map(u => u.type));
    const allUnitTypes = Object.values(UnitType).filter((v): v is UnitType => typeof v === 'number');
    const missing = allUnitTypes.filter(t => !unitTypesInArray.has(t));
    if (missing.length > 0) {
        console.error(
            'ALL_UNITS is missing UnitTypes:',
            missing.map(t => UnitType[t])
        );
    }
}

/** Resources available in the UI (derived from droppable materials) */
export const ALL_RESOURCES = DROPPABLE_MATERIALS.map(type => {
    const name = EMaterialType[type].charAt(0) + EMaterialType[type].slice(1).toLowerCase().replace('_', ' ');
    return {
        type,
        id: EMaterialType[type].toLowerCase(),
        name,
        icon: '📦', // Placeholder, will be replaced by texture
    };
});
