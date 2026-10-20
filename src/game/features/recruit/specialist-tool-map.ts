import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';

/**
 * Maps specialist UnitTypes to the tool material the carrier must pick up
 * before transforming. Derived from SettlerValues.xml <tool> tags.
 *
 * Only types that require a tool are listed — types with GOOD_NO_GOOD
 * (Carrier, Donkey, Forester, AnimalFarmer, etc.) don't need a tool.
 * null means the unit transforms directly (no tool required).
 */
export const SPECIALIST_TOOL_MAP: Partial<Record<UnitType, EMaterialType | null>> = {
    // ── Construction ──
    [UnitType.Builder]: EMaterialType.HAMMER,
    [UnitType.Digger]: EMaterialType.SHOVEL,

    // ── Resource workers ──
    [UnitType.Woodcutter]: EMaterialType.AXE,
    [UnitType.Stonecutter]: EMaterialType.PICKAXE,
    [UnitType.Farmer]: EMaterialType.SCYTHE,
    [UnitType.Fisher]: EMaterialType.ROD,
    [UnitType.Hunter]: EMaterialType.BOW,
    [UnitType.Miner]: EMaterialType.PICKAXE,

    // ── Processing workers ──
    [UnitType.Smith]: EMaterialType.HAMMER,
    [UnitType.SawmillWorker]: EMaterialType.SAW,
    [UnitType.Butcher]: EMaterialType.AXE,

    // ── Non-military specialists ──
    [UnitType.Pioneer]: EMaterialType.SHOVEL,
    [UnitType.Geologist]: EMaterialType.PICKAXE,
    [UnitType.Gardener]: EMaterialType.SHOVEL,
    [UnitType.Saboteur]: EMaterialType.PICKAXE,
    [UnitType.Thief]: null,

    // ── Military (barracks-trained, tool = weapon) ──
    [UnitType.Swordsman1]: EMaterialType.SWORD,
    [UnitType.Swordsman2]: EMaterialType.SWORD,
    [UnitType.Swordsman3]: EMaterialType.SWORD,
    [UnitType.Bowman1]: EMaterialType.BOW,
    [UnitType.Bowman2]: EMaterialType.BOW,
    [UnitType.Bowman3]: EMaterialType.BOW,
    [UnitType.Medic1]: EMaterialType.SWORD,
    [UnitType.Medic2]: EMaterialType.SWORD,
    [UnitType.Medic3]: EMaterialType.SWORD,
    [UnitType.AxeWarrior1]: EMaterialType.BATTLEAXE,
    [UnitType.AxeWarrior2]: EMaterialType.BATTLEAXE,
    [UnitType.AxeWarrior3]: EMaterialType.BATTLEAXE,
    [UnitType.BlowgunWarrior1]: EMaterialType.BLOWGUN,
    [UnitType.BlowgunWarrior2]: EMaterialType.BLOWGUN,
    [UnitType.BlowgunWarrior3]: EMaterialType.BLOWGUN,
    [UnitType.BackpackCatapultist1]: EMaterialType.CATAPULT,
    [UnitType.BackpackCatapultist2]: EMaterialType.CATAPULT,
    [UnitType.BackpackCatapultist3]: EMaterialType.CATAPULT,
};
