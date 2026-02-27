/**
 * Type definitions for rich map object profiles.
 * Each ObjectProfile captures a complete statistical picture
 * of where a particular raw object value appears on the map.
 */
import type { TerrainGroup } from './ground-type-names';

/** Min/max/avg/median height statistics. */
export interface HeightStats {
    min: number;
    max: number;
    avg: number;
    median: number;
}

/** Frequency of a specific ground type for an object value. */
export interface GroundTypeFreq {
    groundType: number;
    name: string;
    count: number;
    pct: number;
}

/** Aggregated frequency of a terrain group for an object value. */
export interface TerrainGroupFreq {
    group: TerrainGroup;
    count: number;
    pct: number;
}

/** Complete profile for one raw object value. */
export interface ObjectProfile {
    /** Raw byte value from the map file. */
    raw: number;
    /** Total count across the map. */
    count: number;
    /** Human-readable label from registry, or "???" if unmapped. */
    label: string;
    /** Category from registry, or "???" if unmapped. */
    category: string;
    /** Whether this value is in the registry. */
    mapped: boolean;
    /** Ground type distribution, sorted by count desc. */
    terrain: GroundTypeFreq[];
    /** Terrain group distribution, sorted by count desc. */
    terrainGroups: TerrainGroupFreq[];
    /** Height statistics for tiles where this object appears. */
    height: HeightStats;
    /** Percentage of occurrences on dark ground terrain. */
    darkLandPct: number;
    /** Percentage of occurrences on tiles with the pond flag set (bit 5 of terrain attrs). */
    pondPct: number;
    /** Primary terrain group (most common group). */
    primaryGroup: TerrainGroup;
}

/** Category-level summary statistics. */
export interface CategorySummary {
    category: string;
    totalCount: number;
    uniqueTypes: number;
    avgHeight: number;
    primaryGroup: TerrainGroup;
    primaryGroupPct: number;
}

/** Terrain-group-level summary statistics. */
export interface TerrainGroupSummary {
    group: TerrainGroup;
    objectCount: number;
    pctOfTotal: number;
    uniqueTypes: number;
}
