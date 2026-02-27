/**
 * Core analysis engine: builds rich ObjectProfile[] from raw map data.
 * Computes per-object-type terrain distribution, height stats, dark/pond flags.
 */
import { lookupRawObject } from '../../src/resources/map/raw-object-registry';
import type { MapRawData } from './map-data-loader';
import {
    getGroundTypeName,
    getTerrainGroup,
    DARK_GROUND_TYPES,
    TERRAIN_GROUPS,
    type TerrainGroup,
} from './ground-type-names';
import type { ObjectProfile, HeightStats, CategorySummary, TerrainGroupSummary } from './object-profile';

/** Intermediate accumulator for building a profile. */
interface ProfileAccumulator {
    count: number;
    terrainHist: Map<number, number>;
    heights: number[];
    darkCount: number;
    pondCount: number;
}

/** Build ObjectProfile[] from raw map data. Covers ALL non-zero raw values. */
export function buildObjectProfiles(data: MapRawData): ObjectProfile[] {
    const accumulators = new Map<number, ProfileAccumulator>();

    for (let i = 0; i < data.tileCount; i++) {
        const rawVal = data.objectBytes[i]!;
        if (rawVal === 0) continue;

        let acc = accumulators.get(rawVal);
        if (!acc) {
            acc = { count: 0, terrainHist: new Map(), heights: [], darkCount: 0, pondCount: 0 };
            accumulators.set(rawVal, acc);
        }

        acc.count++;

        const gt = data.groundTypes[i]!;
        acc.terrainHist.set(gt, (acc.terrainHist.get(gt) ?? 0) + 1);

        acc.heights.push(data.groundHeights[i]!);

        if (DARK_GROUND_TYPES.has(gt)) acc.darkCount++;

        // Pond flag is bit 5 of terrain attributes
        if (data.terrainAttrs[i]! & 0x20) acc.pondCount++;
    }

    const profiles: ObjectProfile[] = [];

    for (const [raw, acc] of accumulators) {
        const entry = lookupRawObject(raw);

        const terrain = [...acc.terrainHist.entries()]
            .map(([gt, count]) => ({
                groundType: gt,
                name: getGroundTypeName(gt),
                count,
                pct: Math.round((count / acc.count) * 100),
            }))
            .sort((a, b) => b.count - a.count);

        const groupCounts = new Map<TerrainGroup, number>();
        for (const [gt, count] of acc.terrainHist) {
            const group = getTerrainGroup(gt);
            groupCounts.set(group, (groupCounts.get(group) ?? 0) + count);
        }
        const terrainGroups = TERRAIN_GROUPS.filter(g => groupCounts.has(g))
            .map(group => ({
                group,
                count: groupCounts.get(group)!,
                pct: Math.round((groupCounts.get(group)! / acc.count) * 100),
            }))
            .sort((a, b) => b.count - a.count);

        const height = computeHeightStats(acc.heights);
        const primaryGroup = terrainGroups[0]?.group ?? 'Grass';

        profiles.push({
            raw,
            count: acc.count,
            label: entry?.label ?? '???',
            category: entry?.category ?? '???',
            mapped: !!entry,
            terrain,
            terrainGroups,
            height,
            darkLandPct: Math.round((acc.darkCount / acc.count) * 100),
            pondPct: Math.round((acc.pondCount / acc.count) * 100),
            primaryGroup,
        });
    }

    return profiles.sort((a, b) => b.count - a.count);
}

/** Find the terrain group with the most occurrences across profiles. */
function findPrimaryGroup(catProfiles: ObjectProfile[]): { group: TerrainGroup; count: number } {
    const groupCounts = new Map<TerrainGroup, number>();
    for (const p of catProfiles) {
        for (const tg of p.terrainGroups) {
            groupCounts.set(tg.group, (groupCounts.get(tg.group) ?? 0) + tg.count);
        }
    }
    let primaryGroup: TerrainGroup = 'Grass';
    let primaryGroupCount = 0;
    for (const [group, count] of groupCounts) {
        if (count > primaryGroupCount) {
            primaryGroup = group;
            primaryGroupCount = count;
        }
    }
    return { group: primaryGroup, count: primaryGroupCount };
}

/** Build category-level summaries from profiles. */
export function buildCategorySummaries(profiles: ObjectProfile[]): CategorySummary[] {
    const byCategory = new Map<string, ObjectProfile[]>();
    for (const p of profiles) {
        const cat = p.category;
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(p);
    }

    const summaries: CategorySummary[] = [];
    for (const [category, catProfiles] of byCategory) {
        const totalCount = catProfiles.reduce((s, p) => s + p.count, 0);
        const weightedHeight = catProfiles.reduce((s, p) => s + p.height.avg * p.count, 0);
        const primary = findPrimaryGroup(catProfiles);

        summaries.push({
            category,
            totalCount,
            uniqueTypes: catProfiles.length,
            avgHeight: totalCount > 0 ? Math.round(weightedHeight / totalCount) : 0,
            primaryGroup: primary.group,
            primaryGroupPct: totalCount > 0 ? Math.round((primary.count / totalCount) * 100) : 0,
        });
    }

    return summaries.sort((a, b) => b.totalCount - a.totalCount);
}

/** Build terrain-group-level summaries from profiles. */
export function buildTerrainGroupSummaries(profiles: ObjectProfile[]): TerrainGroupSummary[] {
    const totalObjects = profiles.reduce((s, p) => s + p.count, 0);
    const groupCounts = new Map<TerrainGroup, { count: number; types: Set<number> }>();

    for (const p of profiles) {
        for (const tg of p.terrainGroups) {
            if (!groupCounts.has(tg.group)) groupCounts.set(tg.group, { count: 0, types: new Set() });
            const entry = groupCounts.get(tg.group)!;
            entry.count += tg.count;
            entry.types.add(p.raw);
        }
    }

    return TERRAIN_GROUPS.filter(g => groupCounts.has(g)).map(group => {
        const entry = groupCounts.get(group)!;
        return {
            group,
            objectCount: entry.count,
            pctOfTotal: totalObjects > 0 ? Math.round((entry.count / totalObjects) * 100) : 0,
            uniqueTypes: entry.types.size,
        };
    });
}

function computeHeightStats(heights: number[]): HeightStats {
    if (heights.length === 0) return { min: 0, max: 0, avg: 0, median: 0 };

    let min = 255;
    let max = 0;
    let sum = 0;
    for (const h of heights) {
        if (h < min) min = h;
        if (h > max) max = h;
        sum += h;
    }

    heights.sort((a, b) => a - b);
    const mid = heights.length >> 1;
    const median = heights.length % 2 === 0 ? (heights[mid - 1]! + heights[mid]!) / 2 : heights[mid]!;

    return {
        min,
        max,
        avg: Math.round(sum / heights.length),
        median: Math.round(median),
    };
}
