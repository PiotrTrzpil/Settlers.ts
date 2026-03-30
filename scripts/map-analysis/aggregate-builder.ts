/**
 * Aggregate profiler: merges ObjectProfile[] from multiple maps into
 * a single cross-map report per raw value.
 */
import type { NeighborFreq, MapProfileResult, ObjectProfile } from './object-profile';
import type { TerrainGroup } from './ground-type-names';
import { TERRAIN_GROUPS } from './ground-type-names';

/** Aggregated profile for one raw value across all maps. */
export interface AggregateProfile {
    raw: number;
    label: string;
    category: string;
    hasType: boolean;
    totalCount: number;
    mapCount: number;
    darkPct: number;
    pondPct: number;
    avgHeight: number;
    minHeight: number;
    maxHeight: number;
    terrainGroups: { group: TerrainGroup; pct: number }[];
    topNeighbors: NeighborFreq[];
}

/** Accumulator for merging profiles. */
interface Accumulator {
    label: string;
    category: string;
    hasType: boolean;
    totalCount: number;
    maps: Set<string>;
    darkTotal: number;
    pondTotal: number;
    heightSum: number;
    heightMin: number;
    heightMax: number;
    terrainGroups: Map<TerrainGroup, number>;
    neighbors: Map<number, { label: string; count: number }>;
}

function createAccumulator(p: ObjectProfile): Accumulator {
    return {
        label: p.label,
        category: p.category,
        hasType: p.type != null,
        totalCount: 0,
        maps: new Set(),
        darkTotal: 0,
        pondTotal: 0,
        heightSum: 0,
        heightMin: 255,
        heightMax: 0,
        terrainGroups: new Map(),
        neighbors: new Map(),
    };
}

function mergeProfile(acc: Accumulator, p: ObjectProfile, mapName: string): void {
    acc.totalCount += p.count;
    acc.maps.add(mapName);
    acc.darkTotal += Math.round((p.darkLandPct / 100) * p.count);
    acc.pondTotal += Math.round((p.pondPct / 100) * p.count);
    acc.heightSum += p.height.avg * p.count;
    if (p.height.min < acc.heightMin) acc.heightMin = p.height.min;
    if (p.height.max > acc.heightMax) acc.heightMax = p.height.max;

    for (const tg of p.terrainGroups) {
        acc.terrainGroups.set(tg.group, (acc.terrainGroups.get(tg.group) ?? 0) + tg.count);
    }
    for (const n of p.topNeighbors) {
        const existing = acc.neighbors.get(n.raw);
        if (existing) {
            existing.count += n.count;
        } else {
            acc.neighbors.set(n.raw, { label: n.label, count: n.count });
        }
    }
    if (acc.label === '???' && p.label !== '???') {
        acc.label = p.label;
        acc.category = p.category;
    }
}

function finalizeAccumulator(raw: number, acc: Accumulator): AggregateProfile {
    const terrainGroups = TERRAIN_GROUPS.filter(g => acc.terrainGroups.has(g))
        .map(g => ({
            group: g,
            pct: Math.round(((acc.terrainGroups.get(g) ?? 0) / acc.totalCount) * 100),
        }))
        .filter(g => g.pct > 0)
        .sort((a, b) => b.pct - a.pct);

    const topNeighbors = [...acc.neighbors.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([nRaw, { label, count }]) => ({ raw: nRaw, label, count }));

    const pct = (part: number) => (acc.totalCount > 0 ? Math.round((part / acc.totalCount) * 100) : 0);

    return {
        raw,
        label: acc.label,
        category: acc.category,
        hasType: acc.hasType,
        totalCount: acc.totalCount,
        mapCount: acc.maps.size,
        darkPct: pct(acc.darkTotal),
        pondPct: pct(acc.pondTotal),
        avgHeight: acc.totalCount > 0 ? Math.round(acc.heightSum / acc.totalCount) : 0,
        minHeight: acc.heightMin,
        maxHeight: acc.heightMax,
        terrainGroups,
        topNeighbors,
    };
}

/** Merge per-map profiles into AggregateProfile[]. */
export function buildAggregateProfiles(mapProfiles: MapProfileResult[]): AggregateProfile[] {
    const accumulators = new Map<number, Accumulator>();

    for (const { mapName, profiles } of mapProfiles) {
        for (const p of profiles) {
            let acc = accumulators.get(p.raw);
            if (!acc) {
                acc = createAccumulator(p);
                accumulators.set(p.raw, acc);
            }
            mergeProfile(acc, p, mapName);
        }
    }

    return [...accumulators.entries()].map(([raw, acc]) => finalizeAccumulator(raw, acc)).sort((a, b) => a.raw - b.raw);
}
