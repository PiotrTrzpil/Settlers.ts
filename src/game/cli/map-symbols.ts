/**
 * Symbol mapping for CLI map rendering — Dwarf-Fortress-style ASCII symbols.
 *
 * Each tile is rendered as a single ASCII character based on priority:
 * unit > building > pile > map object > terrain.
 */

import type { Entity } from '@/game/entity';
import { EntityType } from '@/game/entity';
import { UnitType, getBaseUnitType } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import type { TerrainData } from '@/game/terrain/terrain-data';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Which layers to include in the map render. */
export interface MapLayerFilter {
    terrain: boolean;
    buildings: boolean;
    units: boolean;
    objects: boolean;
    piles: boolean;
}

/** Preset viewport sizes. */
export type MapSizePreset = 'sm' | 'md' | 'lg' | 'xl';

/** Resolved viewport dimensions. */
export interface MapViewport {
    cx: number;
    cy: number;
    radius: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default: all layers enabled. */
export const ALL_LAYERS: MapLayerFilter = {
    terrain: true,
    buildings: true,
    units: true,
    objects: true,
    piles: true,
};

const SIZE_PRESETS: Record<MapSizePreset, number> = {
    sm: 5,
    md: 15,
    lg: 30,
    xl: 50,
};

const VALID_LAYERS = new Set<string>(['terrain', 'buildings', 'units', 'objects', 'piles']);

// ─── Ranged military unit types (use '>' symbol) ────────────────────────────

const RANGED_BASE_TYPES: ReadonlySet<UnitType> = new Set([
    UnitType.Bowman1,
    UnitType.BlowgunWarrior1,
    UnitType.BackpackCatapultist1,
]);

// ─── Symbol Legend Descriptions ──────────────────────────────────────────────

const SYMBOL_LEGEND: Record<string, string> = {
    '~': 'water',
    '^': 'rock',
    ',': 'beach',
    '%': 'swamp',
    '*': 'snow',
    _: 'desert',
    '#': 'mud',
    '.': 'grass',
    c: 'carrier',
    b: 'builder',
    w: 'worker',
    '!': 'melee',
    '>': 'ranged',
    '@': 'leader',
    d: 'donkey',
    C: 'castle',
    S: 'storage',
    G: 'guard',
    X: 'barrack',
    B: 'building',
    M: 'mine',
    H: 'house',
    '&': 'temple',
    T: 'tree',
    $: 'resource',
    '"': 'crop',
    o: 'stone',
    P: 'pile',
};

// ─── Symbol Resolution ───────────────────────────────────────────────────────

function unitSymbol(subType: UnitType): string {
    const ut = subType;
    if (ut === UnitType.Carrier) {
        return 'c';
    }
    if (ut === UnitType.Builder) {
        return 'b';
    }
    if (ut === UnitType.Donkey) {
        return 'd';
    }
    if (ut === UnitType.SquadLeader) {
        return '@';
    }
    const base = getBaseUnitType(ut);
    if (RANGED_BASE_TYPES.has(base)) {
        return '>';
    }
    // Swordsman, AxeWarrior, Medic, and other military → melee symbol
    if (
        base === UnitType.Swordsman1 ||
        base === UnitType.AxeWarrior1 ||
        base === UnitType.Medic1 ||
        base === UnitType.Angel
    ) {
        return '!';
    }
    // All other workers/specialists
    return 'w';
}

const BUILDING_SYMBOL_MAP: ReadonlyMap<BuildingType, string> = new Map([
    [BuildingType.Castle, 'C'],
    [BuildingType.Fortress, 'C'],
    [BuildingType.StorageArea, 'S'],
    [BuildingType.GuardTowerSmall, 'G'],
    [BuildingType.GuardTowerBig, 'G'],
    [BuildingType.Barrack, 'X'],
    [BuildingType.CoalMine, 'M'],
    [BuildingType.IronMine, 'M'],
    [BuildingType.GoldMine, 'M'],
    [BuildingType.StoneMine, 'M'],
    [BuildingType.SulfurMine, 'M'],
    [BuildingType.ResidenceSmall, 'H'],
    [BuildingType.ResidenceMedium, 'H'],
    [BuildingType.ResidenceBig, 'H'],
    [BuildingType.SmallTemple, '&'],
    [BuildingType.LargeTemple, '&'],
    [BuildingType.DarkTemple, '&'],
]);

function buildingSymbol(subType: BuildingType): string {
    return BUILDING_SYMBOL_MAP.get(subType) ?? 'B';
}

/** [minSubType, maxSubType, symbol] — checked in order, first match wins. */
const MAP_OBJECT_RANGES: readonly [number, number, string][] = [
    [0, 26, 'T'], // trees
    [100, 106, '$'], // resource deposits
    [200, 205, '"'], // crops
    [400, 449, 'o'], // stones
];

function mapObjectSymbol(subType: number): string {
    for (const [lo, hi, sym] of MAP_OBJECT_RANGES) {
        if (subType >= lo && subType <= hi) {
            return sym;
        }
    }
    return '.';
}

function terrainSymbol(groundType: number): string {
    if (groundType <= 8) {
        return '~';
    }
    if (groundType === 32) {
        return '^';
    }
    if (groundType === 48) {
        return ',';
    }
    if (groundType >= 64 && groundType <= 65) {
        return '_';
    }
    if (groundType >= 80 && groundType <= 81) {
        return '%';
    }
    if (groundType >= 96 && groundType <= 99) {
        return '~';
    }
    if (groundType >= 128 && groundType <= 129) {
        return '*';
    }
    if (groundType >= 144 && groundType <= 145) {
        return '#';
    }
    return '.';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Return a single ASCII character for the tile content.
 * Priority: unit > building > pile > map object > terrain.
 */
export function renderTileSymbol(
    entity: Entity | undefined,
    groundEntity: Entity | undefined,
    terrainType: number,
    _terrainHeight: number,
    layers: MapLayerFilter
): string {
    // Unit layer (entity from unitOccupancy)
    if (entity && entity.type === EntityType.Unit && layers.units) {
        return unitSymbol(entity.subType as UnitType);
    }

    // Ground entity layers (buildings, piles, map objects)
    if (groundEntity) {
        if (groundEntity.type === EntityType.Building && layers.buildings) {
            return buildingSymbol(groundEntity.subType as BuildingType);
        }
        if (groundEntity.type === EntityType.StackedPile && layers.piles) {
            return 'P';
        }
        if (groundEntity.type === EntityType.MapObject && layers.objects) {
            return mapObjectSymbol(groundEntity.subType as number);
        }
    }

    // Terrain layer (always last)
    if (layers.terrain) {
        return terrainSymbol(terrainType);
    }

    return ' ';
}

/** Resolve a size preset or custom radius to a MapViewport. */
export function resolveViewport(
    cx: number,
    cy: number,
    sizeOrRadius: MapSizePreset | number,
    terrain: TerrainData
): MapViewport {
    const radius = typeof sizeOrRadius === 'number' ? sizeOrRadius : SIZE_PRESETS[sizeOrRadius];
    return {
        cx: Math.max(radius, Math.min(terrain.width - 1 - radius, cx)),
        cy: Math.max(radius, Math.min(terrain.height - 1 - radius, cy)),
        radius,
    };
}

/** Return a compact legend string for all symbols that appear in the rendered grid. */
export function buildLegend(usedSymbols: Set<string>): string {
    const parts: string[] = [];
    for (const [sym, desc] of Object.entries(SYMBOL_LEGEND)) {
        if (usedSymbols.has(sym)) {
            parts.push(`${sym}=${desc}`);
        }
    }
    return parts.join(' ');
}

/** Parse `--layer terrain,buildings,...` flag into a MapLayerFilter. Returns ALL_LAYERS if undefined. */
export function parseLayers(layerArg: string | undefined): MapLayerFilter {
    if (!layerArg) {
        return { ...ALL_LAYERS };
    }
    const filter: MapLayerFilter = {
        terrain: false,
        buildings: false,
        units: false,
        objects: false,
        piles: false,
    };
    for (const name of layerArg.split(',')) {
        const trimmed = name.trim();
        if (!VALID_LAYERS.has(trimmed)) {
            throw new Error(`Unknown layer '${trimmed}'. Valid: ${[...VALID_LAYERS].join(', ')}`);
        }
        filter[trimmed as keyof MapLayerFilter] = true;
    }
    return filter;
}
