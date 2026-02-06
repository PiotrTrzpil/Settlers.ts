/**
 * Map object type definitions.
 * These are natural objects that exist on the map independently of players.
 */

export enum MapObjectType {
    // Trees
    TreePine = 0,
    TreeOak = 1,
    TreeBirch = 2,
    TreePalm = 3,
    TreeCypress = 4,
    TreeDead = 5,

    // Stones
    StoneSmall = 10,
    StoneMedium = 11,
    StoneLarge = 12,

    // Resources (mineable)
    IronDeposit = 20,
    GoldDeposit = 21,
    CoalDeposit = 22,
    StoneDeposit = 23,
    SulfurDeposit = 24,
    GemsDeposit = 25,

    // Plants
    Bush = 30,
    Mushroom = 31,
    Flowers = 32,
    Corn = 33,
    Wheat = 34,

    // Other objects
    Stump = 40,
    FallenTree = 41,
    Pile = 42,
}
