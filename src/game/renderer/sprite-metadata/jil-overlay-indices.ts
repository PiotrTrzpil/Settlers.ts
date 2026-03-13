/**
 * Building overlay JIL index table — overlay animation entries for building GFX files.
 *
 * Extracted from jil-indices.ts to keep that module under the line limit.
 */

/**
 * Entry in the overlay JIL index table.
 * `null` = not yet identified. Otherwise:
 * - `job`: JIL job index. Omit to reuse the parent building's job.
 * - `dir`: DIL direction index. Default: 0.
 */
export interface OverlayJilEntry {
    readonly job?: number;
    readonly dir?: number;
}

/**
 * Resolve an OverlayJilEntry to { jobIndex, directionIndex }.
 * Returns null for unmapped entries (null) or if parentJobIndex is missing for a parent-relative entry.
 */
export function resolveOverlayJilEntry(
    entry: OverlayJilEntry | null,
    parentJobIndex?: number
): { jobIndex: number; directionIndex: number } | null {
    if (!entry) {
        return null;
    }
    const jobIndex = entry.job ?? parentJobIndex;
    if (jobIndex === undefined) {
        return null;
    }
    return { jobIndex, directionIndex: entry.dir ?? 0 };
}

/**
 * JIL job index for building overlay animations (smoke, fire, wheels, etc.).
 * Overlays share the GFX file with their building (file = Race as number, e.g. 10 for Roman).
 *
 * Entries are `null` for overlays not yet identified — fill in after inspecting
 * the building GFX files. Names come from the <job> field in buildingInfo.xml.
 */
export const BUILDING_OVERLAY_JIL_INDICES: Readonly<Record<string, OverlayJilEntry | null>> = {
    // TODO: fill in actual JIL indices after inspecting the building GFX files
    BUILDING_AMMOMAKERHUT_EXPLOSION: null,
    BUILDING_ANIMALRANCH_ANIMAL1: { dir: 2 },
    BUILDING_ANIMALRANCH_ANIMAL2: { dir: 3 },
    BUILDING_ANIMALRANCH_ANIMAL3: { dir: 4 },
    BUILDING_ANIMALRANCH_ANIMAL4: { dir: 5 },
    BUILDING_ANIMALRANCH_ANIMAL5: { dir: 6 },
    BUILDING_ANIMALRANCH_ANIMAL6: { dir: 7 },
    BUILDING_BAKERY_DOOR: null,
    BUILDING_BAKERY_FIRE: null,
    BUILDING_BAKERY_OPENDOOR: null,
    BUILDING_BAKERY_OVEN: { dir: 4 },
    BUILDING_BAKERY_POLLER: { dir: 3 },
    BUILDING_BAKERY_SIGN: { dir: 2 },
    BUILDING_BARRACKS_ANIMPUPPET: null,
    BUILDING_BIGTEMPLE_ANIM: null,
    BUILDING_CASTLE_DOOR: null,
    BUILDING_CASTLE_FRONTWALL: null,
    BUILDING_CASTLE_TOWER1: null,
    BUILDING_CASTLE_TOWER1_FRONTWALL: null,
    BUILDING_CASTLE_TOWER2: null,
    BUILDING_CASTLE_TOWER2_FRONTWALL: null,
    BUILDING_CASTLE_TOWER3: null,
    BUILDING_CASTLE_TOWER3_FRONTWALL: null,
    BUILDING_COALMINE_MINEWHEEL: null,
    BUILDING_DONKEYRANCH_DONKEY1: { dir: 2 },
    BUILDING_DONKEYRANCH_DONKEY2: { dir: 3 },
    BUILDING_DONKEYRANCH_DONKEY3: { dir: 4 },
    BUILDING_EYECATCHER03_ANIM: null,
    BUILDING_EYECATCHER04_ANIM: null,
    BUILDING_EYECATCHER09_ANIM: null,
    BUILDING_EYECATCHER10_ANIM: null,
    BUILDING_EYECATCHER11_ANIM: null,
    BUILDING_EYECATCHER12_ANIM: null,
    BUILDING_FISHERHUT_DOOR: null,
    BUILDING_FISHERHUT_MOVENET: { dir: 2 },
    BUILDING_FISHERHUT_WATER: null,
    BUILDING_FORESTERHUT_ANIM: null,
    BUILDING_GOLDMINE_MINEWHEEL: null,
    BUILDING_GUARDTOWERBIG_DOOR: null,
    BUILDING_GUARDTOWERBIG_FRONTWALL: null,
    BUILDING_GUARDTOWERSMALL_DOOR: null,
    BUILDING_GUARDTOWERSMALL_FRONTWALL: null,
    BUILDING_HEALERHUT_WATER: null,
    BUILDING_IRONMINE_MINEWHEEL: null,
    BUILDING_LOOKOUTTOWER_HORN: null,
    BUILDING_LOOKOUTTOWER_MOVEBELL: null,
    BUILDING_MANACOPTERHALL_KOPTER: null,
    BUILDING_MANACOPTERHALL_MANA: null,
    BUILDING_MANACOPTERHALL_SDRIVE: null,
    BUILDING_MANACOPTERHALL_WORK: null,
    BUILDING_MARKETPLACE_JUMPBIRD: null,
    BUILDING_MARKETPLACE_SCALE: null,
    BUILDING_MILL_BACKWHEEL: { dir: 2 },
    BUILDING_MILL_MILLWHEEL: { dir: 2 },
    BUILDING_MUSHROOMFARM_FLOW: null,
    BUILDING_MUSHROOMFARM_GROW: null,
    BUILDING_MUSHROOMFARM_OPEN: null,
    BUILDING_PORTA_FOOTBRIDGE: null,
    BUILDING_PORTA_LIGHT: null,
    BUILDING_PORTB_FOOTBRIDGE: null,
    BUILDING_PORTB_LIGHT: null,
    BUILDING_PORTC_FOOTBRIDGE: null,
    BUILDING_PORTC_LIGHT: null,
    BUILDING_PORTD_FOOTBRIDGE: null,
    BUILDING_PORTD_LIGHT: null,
    BUILDING_PORTE_FOOTBRIDGE: null,
    BUILDING_PORTE_LIGHT: null,
    BUILDING_PORTF_FOOTBRIDGE: null,
    BUILDING_PORTF_LIGHT: null,
    BUILDING_PORTG_FOOTBRIDGE: null,
    BUILDING_PORTG_LIGHT: null,
    BUILDING_PORTH_FOOTBRIDGE: null,
    BUILDING_PORTH_LIGHT: null,
    BUILDING_RESIDENCEBIG_DOOR: null,
    BUILDING_RESIDENCEBIG_WEATHERCOCK: null,
    BUILDING_RESIDENCEMEDIUM_DOOR: null,
    BUILDING_RESIDENCESMALL_CLOTHLINE: null,
    BUILDING_RESIDENCESMALL_DOOR: null,
    BUILDING_SAWMILL_DOOR: null,
    BUILDING_SHIPYARDA_FOOTBRIDGE: null,
    BUILDING_SHIPYARDB_FOOTBRIDGE: null,
    BUILDING_SHIPYARDC_FOOTBRIDGE: null,
    BUILDING_SHIPYARDD_FOOTBRIDGE: null,
    BUILDING_SHIPYARDE_FOOTBRIDGE: null,
    BUILDING_SHIPYARDF_FOOTBRIDGE: null,
    BUILDING_SHIPYARDG_FOOTBRIDGE: null,
    BUILDING_SHIPYARDH_FOOTBRIDGE: null,
    BUILDING_SMALLTEMPLE_BOWL: null,
    BUILDING_SMALLTEMPLE_FRONTWALL: null,
    BUILDING_SMALLTEMPLE_MANA: null,
    BUILDING_SMELTGOLD_FIRE: null,
    BUILDING_SMELTGOLD_MELTED: { dir: 3 },
    BUILDING_SMELTGOLD_OPENDOOR: null,
    BUILDING_SMELTGOLD_PUMP: { dir: 2 },
    BUILDING_SMELTIRON_FIRE: null,
    BUILDING_SMELTIRON_MELTED: { dir: 3 },
    BUILDING_SMELTIRON_OPENDOOR: null,
    BUILDING_SMELTIRON_PUMP: { dir: 2 },
    BUILDING_STONEMINE_MINEWHEEL: null,
    BUILDING_SULFURMINE_MINEWHEEL: null,
    BUILDING_SUNFLOWEROILMAKERHUT_PRESS: null,
    BUILDING_TOOLSMITH_ANVIL: null,
    BUILDING_TOOLSMITH_DOOR: null,
    BUILDING_TOOLSMITH_FIRE: null,
    BUILDING_TOOLSMITH_WATER: null,
    BUILDING_TOOLSMITH_WIND: null,
    BUILDING_VEHICLEHALL_HAMMER: null,
    BUILDING_VEHICLEHALL_STONEWALL: null,
    BUILDING_VEHICLEHALL_WHEEL: null,
    BUILDING_WATERWORKHUT_LOOPWATER: null,
    BUILDING_WEAPONSMITH_ANVIL: null,
    BUILDING_WEAPONSMITH_FIRE: null,
    BUILDING_WEAPONSMITH_WATER: null,
    BUILDING_WEAPONSMITH_WIND: null,
};
