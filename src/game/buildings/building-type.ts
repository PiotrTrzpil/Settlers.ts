/**
 * BuildingType enum — pure value enum with no dependencies.
 * Extracted to its own file to allow import from game-data module without circular deps.
 */

export enum BuildingType {
    WoodcutterHut = 'WoodcutterHut',
    StorageArea = 'StorageArea',
    Sawmill = 'Sawmill',
    StonecutterHut = 'StonecutterHut',
    GrainFarm = 'GrainFarm',
    Mill = 'Mill',
    Bakery = 'Bakery',
    FisherHut = 'FisherHut',
    AnimalRanch = 'AnimalRanch',
    Slaughterhouse = 'Slaughterhouse',
    WaterworkHut = 'WaterworkHut',
    CoalMine = 'CoalMine',
    IronMine = 'IronMine',
    GoldMine = 'GoldMine',
    IronSmelter = 'IronSmelter',
    SmeltGold = 'SmeltGold',
    WeaponSmith = 'WeaponSmith',
    ToolSmith = 'ToolSmith',
    Barrack = 'Barrack',
    ForesterHut = 'ForesterHut',
    HealerHut = 'HealerHut',
    GuardTowerSmall = 'GuardTowerSmall',
    HunterHut = 'HunterHut',
    DonkeyRanch = 'DonkeyRanch',
    StoneMine = 'StoneMine',
    SulfurMine = 'SulfurMine',
    ResidenceSmall = 'ResidenceSmall',
    ResidenceMedium = 'ResidenceMedium',
    ResidenceBig = 'ResidenceBig',
    GuardTowerBig = 'GuardTowerBig',
    Castle = 'Castle',
    AmmunitionMaker = 'AmmunitionMaker',
    SmallTemple = 'SmallTemple',
    LargeTemple = 'LargeTemple',
    LookoutTower = 'LookoutTower',
    Shipyard = 'Shipyard',
    Eyecatcher01 = 'Eyecatcher01',
    Vinyard = 'Vinyard',
    SiegeWorkshop = 'SiegeWorkshop',
    Eyecatcher02 = 'Eyecatcher02',
    // Eyecatchers 03-12: race-specific decorative monuments
    Eyecatcher03 = 'Eyecatcher03',
    Eyecatcher04 = 'Eyecatcher04',
    Eyecatcher05 = 'Eyecatcher05',
    Eyecatcher06 = 'Eyecatcher06',
    Eyecatcher07 = 'Eyecatcher07',
    Eyecatcher08 = 'Eyecatcher08',
    Eyecatcher09 = 'Eyecatcher09',
    Eyecatcher10 = 'Eyecatcher10',
    Eyecatcher11 = 'Eyecatcher11',
    Eyecatcher12 = 'Eyecatcher12',
    // Race-specific drink production buildings
    AgaveFarmerHut = 'AgaveFarmerHut',
    TequilaMakerHut = 'TequilaMakerHut',
    BeekeeperHut = 'BeekeeperHut',
    MeadMakerHut = 'MeadMakerHut',
    SunflowerFarmerHut = 'SunflowerFarmerHut',
    SunflowerOilMakerHut = 'SunflowerOilMakerHut',
    MushroomFarm = 'MushroomFarm',
    DarkTemple = 'DarkTemple',
    Fortress = 'Fortress',
    ManaCopterHall = 'ManaCopterHall',
    // Infrastructure buildings
    CharcoalMaker = 'CharcoalMaker',
    Port = 'Port',
    Marketplace = 'Marketplace',
}

/** Check if a building type is a storage area (flat ground storage with dynamic slots). */
export function isStorageBuilding(buildingType: BuildingType): boolean {
    return buildingType === BuildingType.StorageArea;
}
