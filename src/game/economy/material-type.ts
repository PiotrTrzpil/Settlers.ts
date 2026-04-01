/**
 * Material/resource type system for the Settlers economy.
 * Adapted from JSettlers EMaterialType for Settlers 4.
 */

export enum EMaterialType {
    // Raw resources
    LOG = 'LOG',
    STONE = 'STONE',
    COAL = 'COAL',
    IRONORE = 'IRONORE',
    GOLDORE = 'GOLDORE',
    GRAIN = 'GRAIN',
    PIG = 'PIG',
    WATER = 'WATER',
    FISH = 'FISH',

    // Processed materials
    BOARD = 'BOARD',
    IRONBAR = 'IRONBAR',
    GOLDBAR = 'GOLDBAR',
    FLOUR = 'FLOUR',
    BREAD = 'BREAD',
    MEAT = 'MEAT',
    WINE = 'WINE',

    // Tools
    AXE = 'AXE',
    PICKAXE = 'PICKAXE',
    SAW = 'SAW',
    HAMMER = 'HAMMER',
    SCYTHE = 'SCYTHE',
    ROD = 'ROD',

    // Weapons
    SWORD = 'SWORD',
    BOW = 'BOW',

    // Additional resources
    SULFUR = 'SULFUR',
    ARMOR = 'ARMOR', // Leader helmets/equipment
    BATTLEAXE = 'BATTLEAXE', // Heavy battle axes (different from tool axe)
    AGAVE = 'AGAVE', // Mayan crop/plant
    BLOWGUN = 'BLOWGUN', // Mayan weapon
    GOAT = 'GOAT', // Mayan livestock
    MEAD = 'MEAD', // Honey wine
    HONEY = 'HONEY', // Raw honey (for mead)
    SHEEP = 'SHEEP', // Livestock
    SHOVEL = 'SHOVEL', // Tool for pioneers/landscapers
    CATAPULT = 'CATAPULT', // Siege ammunition
    GOOSE = 'GOOSE', // Livestock (geese)
    TEQUILA = 'TEQUILA', // Mayan drink
    SUNFLOWER = 'SUNFLOWER', // Trojan crop
    SUNFLOWEROIL = 'SUNFLOWEROIL', // Trojan drink
    AMMO = 'AMMO', // Ammunition (crossbow bolts)
    GUNPOWDER = 'GUNPOWDER', // Gunpowder for cannons

    // Special
    NO_MATERIAL = 'NO_MATERIAL',
}

export interface MaterialTypeConfig {
    /** Whether this material can be placed on the ground for transport */
    droppable: boolean;
    /** Default transport priority index (lower = higher priority) */
    defaultPriorityIndex: number;
    /** Whether the player can configure distribution ratios for this material */
    distributionConfigurable: boolean;
}

export const MATERIAL_CONFIGS: ReadonlyMap<EMaterialType, MaterialTypeConfig> = new Map([
    // Building materials — highest transport priority
    [EMaterialType.BOARD, { droppable: true, defaultPriorityIndex: 0, distributionConfigurable: true }],
    [EMaterialType.STONE, { droppable: true, defaultPriorityIndex: 1, distributionConfigurable: true }],

    // Food — critical for mines
    [EMaterialType.BREAD, { droppable: true, defaultPriorityIndex: 2, distributionConfigurable: true }],
    [EMaterialType.MEAT, { droppable: true, defaultPriorityIndex: 3, distributionConfigurable: true }],
    [EMaterialType.FISH, { droppable: true, defaultPriorityIndex: 4, distributionConfigurable: true }],

    // Smelting inputs
    [EMaterialType.COAL, { droppable: true, defaultPriorityIndex: 5, distributionConfigurable: true }],
    [EMaterialType.IRONORE, { droppable: true, defaultPriorityIndex: 6, distributionConfigurable: false }],
    [EMaterialType.GOLDORE, { droppable: true, defaultPriorityIndex: 7, distributionConfigurable: false }],

    // Metals
    [EMaterialType.IRONBAR, { droppable: true, defaultPriorityIndex: 8, distributionConfigurable: true }],
    [EMaterialType.GOLDBAR, { droppable: true, defaultPriorityIndex: 9, distributionConfigurable: false }],

    // Intermediate resources
    [EMaterialType.LOG, { droppable: true, defaultPriorityIndex: 10, distributionConfigurable: false }],
    [EMaterialType.GRAIN, { droppable: true, defaultPriorityIndex: 11, distributionConfigurable: true }],
    [EMaterialType.FLOUR, { droppable: true, defaultPriorityIndex: 12, distributionConfigurable: false }],
    [EMaterialType.PIG, { droppable: true, defaultPriorityIndex: 13, distributionConfigurable: false }],
    [EMaterialType.WATER, { droppable: true, defaultPriorityIndex: 14, distributionConfigurable: false }],
    [EMaterialType.WINE, { droppable: true, defaultPriorityIndex: 15, distributionConfigurable: false }],

    // Tools
    [EMaterialType.AXE, { droppable: true, defaultPriorityIndex: 16, distributionConfigurable: false }],
    [EMaterialType.PICKAXE, { droppable: true, defaultPriorityIndex: 17, distributionConfigurable: false }],
    [EMaterialType.SAW, { droppable: true, defaultPriorityIndex: 18, distributionConfigurable: false }],
    [EMaterialType.HAMMER, { droppable: true, defaultPriorityIndex: 19, distributionConfigurable: false }],
    [EMaterialType.SCYTHE, { droppable: true, defaultPriorityIndex: 20, distributionConfigurable: false }],
    [EMaterialType.ROD, { droppable: true, defaultPriorityIndex: 21, distributionConfigurable: false }],

    // Weapons
    [EMaterialType.SWORD, { droppable: true, defaultPriorityIndex: 22, distributionConfigurable: false }],
    [EMaterialType.BOW, { droppable: true, defaultPriorityIndex: 23, distributionConfigurable: false }],
    [EMaterialType.BATTLEAXE, { droppable: true, defaultPriorityIndex: 24, distributionConfigurable: false }],

    // Additional resources
    [EMaterialType.SULFUR, { droppable: true, defaultPriorityIndex: 25, distributionConfigurable: false }],
    [EMaterialType.ARMOR, { droppable: true, defaultPriorityIndex: 26, distributionConfigurable: false }],
    [EMaterialType.AGAVE, { droppable: true, defaultPriorityIndex: 11, distributionConfigurable: true }], // Similar to GRAIN
    [EMaterialType.BLOWGUN, { droppable: true, defaultPriorityIndex: 23, distributionConfigurable: false }], // Similar to BOW
    [EMaterialType.GOAT, { droppable: false, defaultPriorityIndex: 32, distributionConfigurable: false }], // Livestock
    [EMaterialType.MEAD, { droppable: true, defaultPriorityIndex: 15, distributionConfigurable: true }], // Alcohol
    [EMaterialType.HONEY, { droppable: true, defaultPriorityIndex: 15, distributionConfigurable: false }], // For mead
    [EMaterialType.SHEEP, { droppable: false, defaultPriorityIndex: 33, distributionConfigurable: false }], // Livestock
    [EMaterialType.SHOVEL, { droppable: true, defaultPriorityIndex: 21, distributionConfigurable: false }], // Tool
    [EMaterialType.CATAPULT, { droppable: true, defaultPriorityIndex: 26, distributionConfigurable: false }], // Siege
    [EMaterialType.GOOSE, { droppable: false, defaultPriorityIndex: 34, distributionConfigurable: false }], // Livestock
    [EMaterialType.TEQUILA, { droppable: true, defaultPriorityIndex: 35, distributionConfigurable: true }], // Mayan drink
    [EMaterialType.SUNFLOWER, { droppable: true, defaultPriorityIndex: 36, distributionConfigurable: true }], // Trojan crop
    [EMaterialType.SUNFLOWEROIL, { droppable: true, defaultPriorityIndex: 37, distributionConfigurable: true }], // Trojan drink
    [EMaterialType.AMMO, { droppable: true, defaultPriorityIndex: 26, distributionConfigurable: false }], // Ammunition
    [EMaterialType.GUNPOWDER, { droppable: true, defaultPriorityIndex: 26, distributionConfigurable: false }], // Gunpowder

    // Non-droppable
    [EMaterialType.NO_MATERIAL, { droppable: false, defaultPriorityIndex: -1, distributionConfigurable: false }],
]);

/** All droppable materials sorted by default transport priority (ascending index = lower priority) */
export const DROPPABLE_MATERIALS: readonly EMaterialType[] = Array.from(MATERIAL_CONFIGS.entries())
    .filter(([, config]) => config.droppable)
    .sort((a, b) => a[1].defaultPriorityIndex - b[1].defaultPriorityIndex)
    .map(([type]) => type);

/** Check whether a material type can be dropped on the ground */
export function isMaterialDroppable(type: EMaterialType): boolean {
    // eslint-disable-next-line no-restricted-syntax -- EMaterialType may include values not in MATERIAL_CONFIGS (e.g. NO_MATERIAL); false is the correct safe default
    return MATERIAL_CONFIGS.get(type)?.droppable ?? false;
}

/** Get the default transport priority index for a material (lower = higher priority) */
export function getMaterialPriority(type: EMaterialType): number {
    return MATERIAL_CONFIGS.get(type)?.defaultPriorityIndex ?? -1;
}
