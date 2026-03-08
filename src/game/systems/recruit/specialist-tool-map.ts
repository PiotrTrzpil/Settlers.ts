import { UnitType } from '../../core/unit-types';
import { EMaterialType } from '../../economy/material-type';

/**
 * Maps specialist UnitTypes to the tool material the carrier must pick up
 * before transforming. null means no tool needed (Thief transforms in place).
 */
export const SPECIALIST_TOOL_MAP: Partial<Record<UnitType, EMaterialType | null>> = {
    [UnitType.Builder]: EMaterialType.HAMMER,
    [UnitType.Digger]: EMaterialType.SHOVEL,
    [UnitType.Geologist]: EMaterialType.PICKAXE,
    [UnitType.Pioneer]: EMaterialType.SHOVEL,
    [UnitType.Gardener]: EMaterialType.SHOVEL,
    [UnitType.Thief]: null,
};
