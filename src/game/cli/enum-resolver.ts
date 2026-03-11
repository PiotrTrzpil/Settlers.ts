/**
 * Case-insensitive enum name resolution for CLI commands.
 * Builds lowercase lookup maps at module load for BuildingType, UnitType, and EMaterialType.
 * Also accepts raw numeric strings (e.g. "3" resolves to the enum member with value 3).
 */

import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/core/unit-types';
import { EMaterialType } from '@/game/economy/material-type';

// ─── Generic enum indexer ─────────────────────────────────────────────────────

interface EnumIndex {
    byName: Map<string, number>;
    validNames: string[];
}

/** Build a lowercase name -> value map from a numeric TypeScript enum. */
function indexEnum(enumObj: Record<string, string | number>): EnumIndex {
    const byName = new Map<string, number>();
    const validNames: string[] = [];

    for (const [key, value] of Object.entries(enumObj)) {
        if (typeof value !== 'number') continue; // skip reverse mappings
        byName.set(key.toLowerCase(), value);
        validNames.push(key);
        // Also index the numeric value as a string key
        byName.set(String(value), value);
    }

    return { byName, validNames };
}

function resolve(index: EnumIndex, label: string, input: string): number {
    const value = index.byName.get(input.toLowerCase());
    if (value !== undefined) return value;
    throw new Error(`unknown ${label} '${input}'. valid: ${index.validNames.join(', ')}`);
}

// ─── Pre-built indexes ───────────────────────────────────────────────────────

const BUILDING_INDEX = indexEnum(BuildingType as unknown as Record<string, string | number>);
const UNIT_INDEX = indexEnum(UnitType as unknown as Record<string, string | number>);
const MATERIAL_INDEX = indexEnum(EMaterialType as unknown as Record<string, string | number>);

// ─── Public API ──────────────────────────────────────────────────────────────

/** Resolve a building name (case-insensitive) or numeric string to BuildingType. */
export function resolveBuilding(name: string): number {
    return resolve(BUILDING_INDEX, 'building type', name);
}

/** Resolve a unit name (case-insensitive) or numeric string to UnitType. */
export function resolveUnit(name: string): number {
    return resolve(UNIT_INDEX, 'unit type', name);
}

/** Resolve a material name (case-insensitive) or numeric string to EMaterialType. */
export function resolveMaterial(name: string): number {
    return resolve(MATERIAL_INDEX, 'material type', name);
}
