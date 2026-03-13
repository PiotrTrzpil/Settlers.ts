/**
 * Case-insensitive enum name resolution for CLI commands.
 * Builds lowercase lookup maps at module load for BuildingType, UnitType, and EMaterialType.
 * BuildingType also accepts raw numeric strings (e.g. "3" resolves to the enum member with value 3).
 */

import { BuildingType } from '@/game/buildings/building-type';
import { UnitType } from '@/game/core/unit-types';
import { EMaterialType } from '@/game/economy/material-type';

// ─── Generic enum indexer ─────────────────────────────────────────────────────

interface NumericEnumIndex {
    byName: Map<string, number>;
    validNames: string[];
}

interface StringEnumIndex {
    byName: Map<string, string>;
    validNames: string[];
}

/** Build a lowercase name -> value map from a numeric TypeScript enum. */
function indexNumericEnum(enumObj: Record<string, string | number>): NumericEnumIndex {
    const byName = new Map<string, number>();
    const validNames: string[] = [];

    for (const [key, value] of Object.entries(enumObj)) {
        if (typeof value !== 'number') {
            continue;
        } // skip reverse mappings
        byName.set(key.toLowerCase(), value);
        validNames.push(key);
        // Also index the numeric value as a string key
        byName.set(String(value), value);
    }

    return { byName, validNames };
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

function resolveNumeric(index: NumericEnumIndex, label: string, input: string): number {
    const value = index.byName.get(input.toLowerCase());
    if (value !== undefined) {
        return value;
    }
    throw new Error(`unknown ${label} '${input}'. valid: ${index.validNames.join(', ')}`);
}

function resolveString<T extends string>(index: StringEnumIndex, label: string, input: string): T {
    const value = index.byName.get(input.toLowerCase());
    if (value !== undefined) {
        return value as T;
    }
    throw new Error(`unknown ${label} '${input}'. valid: ${index.validNames.join(', ')}`);
}

// ─── Pre-built indexes ───────────────────────────────────────────────────────

const BUILDING_INDEX = indexNumericEnum(BuildingType as unknown as Record<string, string | number>);
const UNIT_INDEX = indexStringEnum(UnitType as unknown as Record<string, string>);
const MATERIAL_INDEX = indexStringEnum(EMaterialType as unknown as Record<string, string>);

// ─── Public API ──────────────────────────────────────────────────────────────

/** Resolve a building name (case-insensitive) or numeric string to BuildingType. */
export function resolveBuilding(name: string): number {
    return resolveNumeric(BUILDING_INDEX, 'building type', name);
}

/** Resolve a unit name (case-insensitive) to UnitType. */
export function resolveUnit(name: string): UnitType {
    return resolveString<UnitType>(UNIT_INDEX, 'unit type', name);
}

/** Resolve a material name (case-insensitive) or numeric string to EMaterialType. */
export function resolveMaterial(name: string): EMaterialType {
    return resolveString<EMaterialType>(MATERIAL_INDEX, 'material type', name);
}
