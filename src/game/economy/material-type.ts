/**
 * Material/resource type system for the Settlers economy.
 * Adapted from JSettlers EMaterialType for Settlers 4.
 */

export enum EMaterialType {
    // Raw resources
    TRUNK = 0,
    STONE = 1,
    COAL = 2,
    IRONORE = 3,
    GOLDORE = 4,
    CROP = 5,
    PIG = 6,
    WATER = 7,
    FISH = 8,

    // Processed materials
    PLANK = 9,
    IRON = 10,
    GOLD = 11,
    FLOUR = 12,
    BREAD = 13,
    MEAT = 14,
    WINE = 15,

    // Tools
    AXE = 16,
    PICK = 17,
    SAW = 18,
    HAMMER = 19,
    SCYTHE = 20,
    FISHINGROD = 21,

    // Weapons
    SWORD = 22,
    BOW = 23,
    SPEAR = 24,
    BLADE = 25,

    // Additional resources
    GRAPES = 27,
    SULFUR = 28,
    DONKEY = 29,
    GEMS = 30,
    OFFICER_GEAR = 31,  // Leader helmets/equipment
    BATTLE_AXE = 32,    // Heavy battle axes (different from tool axe)

    // Special
    NO_MATERIAL = 26,
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
    [EMaterialType.PLANK, { droppable: true, defaultPriorityIndex: 0, distributionConfigurable: true }],
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
    [EMaterialType.IRON, { droppable: true, defaultPriorityIndex: 8, distributionConfigurable: true }],
    [EMaterialType.GOLD, { droppable: true, defaultPriorityIndex: 9, distributionConfigurable: false }],

    // Intermediate resources
    [EMaterialType.TRUNK, { droppable: true, defaultPriorityIndex: 10, distributionConfigurable: false }],
    [EMaterialType.CROP, { droppable: true, defaultPriorityIndex: 11, distributionConfigurable: true }],
    [EMaterialType.FLOUR, { droppable: true, defaultPriorityIndex: 12, distributionConfigurable: false }],
    [EMaterialType.PIG, { droppable: true, defaultPriorityIndex: 13, distributionConfigurable: false }],
    [EMaterialType.WATER, { droppable: true, defaultPriorityIndex: 14, distributionConfigurable: false }],
    [EMaterialType.WINE, { droppable: true, defaultPriorityIndex: 15, distributionConfigurable: false }],

    // Tools
    [EMaterialType.AXE, { droppable: true, defaultPriorityIndex: 16, distributionConfigurable: false }],
    [EMaterialType.PICK, { droppable: true, defaultPriorityIndex: 17, distributionConfigurable: false }],
    [EMaterialType.SAW, { droppable: true, defaultPriorityIndex: 18, distributionConfigurable: false }],
    [EMaterialType.HAMMER, { droppable: true, defaultPriorityIndex: 19, distributionConfigurable: false }],
    [EMaterialType.SCYTHE, { droppable: true, defaultPriorityIndex: 20, distributionConfigurable: false }],
    [EMaterialType.FISHINGROD, { droppable: true, defaultPriorityIndex: 21, distributionConfigurable: false }],

    // Weapons
    [EMaterialType.SWORD, { droppable: true, defaultPriorityIndex: 22, distributionConfigurable: false }],
    [EMaterialType.BOW, { droppable: true, defaultPriorityIndex: 23, distributionConfigurable: false }],
    [EMaterialType.SPEAR, { droppable: true, defaultPriorityIndex: 24, distributionConfigurable: false }],
    [EMaterialType.BLADE, { droppable: true, defaultPriorityIndex: 25, distributionConfigurable: false }],
    [EMaterialType.BATTLE_AXE, { droppable: true, defaultPriorityIndex: 26, distributionConfigurable: false }],

    // Additional resources
    [EMaterialType.GRAPES, { droppable: true, defaultPriorityIndex: 27, distributionConfigurable: false }],
    [EMaterialType.SULFUR, { droppable: true, defaultPriorityIndex: 28, distributionConfigurable: false }],
    [EMaterialType.DONKEY, { droppable: false, defaultPriorityIndex: 29, distributionConfigurable: false }],
    [EMaterialType.GEMS, { droppable: true, defaultPriorityIndex: 30, distributionConfigurable: false }],
    [EMaterialType.OFFICER_GEAR, { droppable: true, defaultPriorityIndex: 31, distributionConfigurable: false }],

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
    return MATERIAL_CONFIGS.get(type)?.droppable ?? false;
}

/** Get the default transport priority index for a material (lower = higher priority) */
export function getMaterialPriority(type: EMaterialType): number {
    return MATERIAL_CONFIGS.get(type)?.defaultPriorityIndex ?? -1;
}
