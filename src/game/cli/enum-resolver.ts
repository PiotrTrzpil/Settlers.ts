/**
 * Case-insensitive enum name resolution for CLI commands.
 * Builds lowercase lookup maps at module load for BuildingType, UnitType, and EMaterialType.
 */

import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/core/unit-types';
import { EMaterialType } from '@/game/economy/material-type';

// ─── Generic enum indexer ─────────────────────────────────────────────────────

interface StringEnumIndex {
    byName: Map<string, string>;
    validNames: string[];
}

/** Build a lowercase name -> value map from a string TypeScript enum. */
function indexStringEnum(enumObj: Record<string, string>): StringEnumIndex {
    const byName = new Map<string, string>();
    const validNames: string[] = [];

    for (const [key, value] of Object.entries(enumObj)) {
        byName.set(key.toLowerCase(), value);
        byName.set(value.toLowerCase(), value);
        validNames.push(key);
    }

    return { byName, validNames };
}

function resolveString<T extends string>(index: StringEnumIndex, label: string, input: string): T {
    const value = index.byName.get(input.toLowerCase());
    if (value !== undefined) {
        return value as T;
    }
    throw new Error(`unknown ${label} '${input}'. valid: ${index.validNames.join(', ')}`);
}

// ─── Pre-built indexes ───────────────────────────────────────────────────────

const BUILDING_INDEX = indexStringEnum(BuildingType as unknown as Record<string, string>);
const UNIT_INDEX = indexStringEnum(UnitType as unknown as Record<string, string>);
const MATERIAL_INDEX = indexStringEnum(EMaterialType as unknown as Record<string, string>);

// ─── Public API ──────────────────────────────────────────────────────────────

/** Resolve a building name (case-insensitive) to BuildingType. */
export function resolveBuilding(name: string): BuildingType {
    return resolveString<BuildingType>(BUILDING_INDEX, 'building type', name);
}

/** Resolve a unit name (case-insensitive) to UnitType. */
export function resolveUnit(name: string): UnitType {
    return resolveString<UnitType>(UNIT_INDEX, 'unit type', name);
}

/** Resolve a material name (case-insensitive) or numeric string to EMaterialType. */
export function resolveMaterial(name: string): EMaterialType {
    return resolveString<EMaterialType>(MATERIAL_INDEX, 'material type', name);
}
