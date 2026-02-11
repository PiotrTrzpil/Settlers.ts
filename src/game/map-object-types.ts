/**
 * Map object type definitions.
 * These are natural objects that exist on the map independently of players.
 */

export enum MapObjectType {
    // Trees (S4ModApi S4_TREE_ENUM)
    TreeOak = 0,        // 1
    TreeBeech = 1,      // 2
    TreeAsh = 2,        // 3
    TreeLinden = 3,     // 4
    TreeBirch = 4,      // 5
    TreePoplar = 5,     // 6
    TreeChestnut = 6,   // 7
    TreeMaple = 7,      // 8
    TreeFir = 8,        // 9
    TreeSpruce = 9,     // 10
    TreeCoconut = 10,   // 11
    TreeDate = 11,      // 12
    TreeWalnut = 12,    // 13
    TreeCorkOak = 13,   // 14
    TreePine = 14,      // 15
    TreePine2 = 15,     // 16
    TreeOliveLarge = 16,// 17
    TreeOliveSmall = 17,// 18

    // Tree aliases for code compatibility or specific tribe variations
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    TreePalm = 10,      // Alias for Coconut/Date generic
    // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
    TreeCypress = 8,    // Alias for Fir/Spruce generic
    TreeDead = 18,      // Placeholder for now

    // Resources (Placeholder IDs for now)
    ResourceCoal = 100,
    ResourceGold = 101,
    ResourceIron = 102,
    ResourceStone = 103,
    ResourceSulfur = 104,
}
