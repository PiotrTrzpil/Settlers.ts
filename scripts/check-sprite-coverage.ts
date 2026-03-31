/**
 * Diagnostic: check which raw object values have sprite coverage.
 *
 * Coverage comes from two sources:
 *   1. Dedicated loaders (trees, stone, crops, resources) — handle specific categories
 *   2. Pool cycling (decoration-sprite-map) — handles all other categories
 *
 * This script identifies gaps in both paths.
 *
 * Run: npx tsx scripts/check-sprite-coverage.ts
 */
import { RAW_OBJECT_REGISTRY, type RawObjectEntry } from '../src/resources/map/raw-object-registry';
import { buildDecorationSpriteMap } from '../src/game/renderer/decoration-sprite-map';
import { MapObjectType } from '../src/game/types/map-object-types';

const decoMap = buildDecorationSpriteMap();

// ---- 1. Dedicated loaders — which categories/types do they cover? ----
const TREE_TYPES = new Set<MapObjectType>([
    MapObjectType.TreeOak,
    MapObjectType.TreeBeech,
    MapObjectType.TreeAsh,
    MapObjectType.TreeLinden,
    MapObjectType.TreeBirch,
    MapObjectType.TreePoplar,
    MapObjectType.TreeChestnut,
    MapObjectType.TreeMaple,
    MapObjectType.TreeFir,
    MapObjectType.TreeSpruce,
    MapObjectType.TreeCoconut,
    MapObjectType.TreeDate,
    MapObjectType.TreeWalnut,
    MapObjectType.TreeCorkOak,
    MapObjectType.TreePine,
    MapObjectType.TreePine2,
    MapObjectType.TreeOliveLarge,
    MapObjectType.TreeOliveSmall,
    MapObjectType.TreeDead,
    MapObjectType.DarkTree1A,
    MapObjectType.DarkTree1B,
    MapObjectType.DarkTree2A,
    MapObjectType.DarkTree2B,
    MapObjectType.DarkTree3A,
    MapObjectType.DarkTree3B,
    MapObjectType.DarkTree4A,
    MapObjectType.DarkTree4B,
    MapObjectType.DarkTree5A,
]);
const STONE_TYPES = new Set<MapObjectType>([
    MapObjectType.ResourceStone1,
    MapObjectType.ResourceStone2,
    MapObjectType.ResourceStone3,
    MapObjectType.ResourceStone4,
    MapObjectType.ResourceStone5,
    MapObjectType.ResourceStone6,
    MapObjectType.ResourceStone7,
    MapObjectType.ResourceStone8,
    MapObjectType.ResourceStone9,
    MapObjectType.ResourceStone10,
    MapObjectType.ResourceStone11,
    MapObjectType.ResourceStone12,
    MapObjectType.ResourceDarkStone,
]);
const CROP_TYPES = new Set<MapObjectType>([
    MapObjectType.Grain,
    MapObjectType.Sunflower,
    MapObjectType.Agave,
    MapObjectType.Beehive,
    MapObjectType.Grape,
    MapObjectType.Wheat2,
]);
const RESOURCE_TYPES = new Set<MapObjectType>([
    MapObjectType.ResourceCoal,
    MapObjectType.ResourceGold,
    MapObjectType.ResourceIron,
    MapObjectType.ResourceSulfur,
]);

function getLoader(type: MapObjectType): string | null {
    if (TREE_TYPES.has(type)) return 'loadTreeSprites';
    if (STONE_TYPES.has(type)) return 'loadStoneSprites';
    if (CROP_TYPES.has(type)) return 'loadCropSprites';
    if (RESOURCE_TYPES.has(type)) return 'loadResourceMapObjects';
    return null;
}

// ---- 2. Classify every entry ----
type CoverageSource = 'loader' | 'pool' | 'none';
interface ClassifiedEntry {
    entry: RawObjectEntry;
    source: CoverageSource;
    loader?: string;
}

const classified: ClassifiedEntry[] = RAW_OBJECT_REGISTRY.map(entry => {
    if (entry.type != null) {
        const loader = getLoader(entry.type);
        if (loader) return { entry, source: 'loader', loader };
    }
    if (decoMap.has(entry.raw)) return { entry, source: 'pool' };
    return { entry, source: 'none' };
});

const byLoader = classified.filter(c => c.source === 'loader');
const byPool = classified.filter(c => c.source === 'pool');
const uncovered = classified.filter(c => c.source === 'none');

// ---- Output ----
const pad = (s: string, w: number) => s.padEnd(w);
const rpad = (s: string, w: number) => String(s).padStart(w);

console.log('=== SPRITE COVERAGE ANALYSIS ===\n');
console.log(`Total registry entries: ${RAW_OBJECT_REGISTRY.length}`);
console.log(`  Covered by dedicated loaders: ${byLoader.length}`);
console.log(`  Covered by pool cycling:      ${byPool.length}`);
console.log(`  NO coverage:                  ${uncovered.length}${uncovered.length > 0 ? '  <-- GAPS!' : '  ✓'}`);

// ---- Loader breakdown ----
console.log('\n' + '─'.repeat(80));
console.log('DEDICATED LOADERS\n');
const loaderGroups = new Map<string, number>();
for (const c of byLoader) loaderGroups.set(c.loader!, (loaderGroups.get(c.loader!) ?? 0) + 1);
for (const [loader, count] of loaderGroups) console.log(`  ${loader}: ${count} entries`);

// ---- Pool utilization ----
console.log('\n' + '─'.repeat(80));
console.log('POOL UTILIZATION BY CATEGORY\n');

const poolByCategory = new Map<string, { rawCount: number; typed: number; untyped: number }>();
for (const c of byPool) {
    const cat = c.entry.category;
    if (!poolByCategory.has(cat)) poolByCategory.set(cat, { rawCount: 0, typed: 0, untyped: 0 });
    const info = poolByCategory.get(cat)!;
    info.rawCount++;
    if (c.entry.type != null) info.typed++;
    else info.untyped++;
}

const categoryPoolSizes = new Map<string, Set<number>>();
for (const [raw, ref] of decoMap) {
    const entry = RAW_OBJECT_REGISTRY.find(e => e.raw === raw);
    if (entry) {
        if (!categoryPoolSizes.has(entry.category)) categoryPoolSizes.set(entry.category, new Set());
        categoryPoolSizes.get(entry.category)!.add(ref.gilIndex);
    }
}

console.log(
    `${pad('Category', 22)} ${rpad('Total', 6)} ${rpad('Typed', 6)} ${rpad('Untyped', 8)} ${rpad('Sprites', 8)} ${rpad('Ratio', 8)} Notes`
);
console.log(
    `${pad('────────', 22)} ${rpad('─────', 6)} ${rpad('─────', 6)} ${rpad('───────', 8)} ${rpad('───────', 8)} ${rpad('─────', 8)} ─────`
);

for (const [cat, info] of [...poolByCategory.entries()].sort((a, b) => b[1].rawCount - a[1].rawCount)) {
    const uniqueSprites = categoryPoolSizes.get(cat)?.size ?? 0;
    const ratio = uniqueSprites > 0 ? `${(info.rawCount / uniqueSprites).toFixed(1)}:1` : 'N/A';
    let note = '';
    if (uniqueSprites === 0) note = '⚠ NO POOL';
    else if (info.rawCount > uniqueSprites * 3) note = 'heavy cycling';
    console.log(
        `${pad(cat, 22)} ${rpad(String(info.rawCount), 6)} ${rpad(String(info.typed), 6)} ${rpad(String(info.untyped), 8)} ${rpad(String(uniqueSprites), 8)} ${rpad(ratio, 8)} ${note}`
    );
}

// ---- Gaps ----
if (uncovered.length > 0) {
    console.log('\n' + '─'.repeat(80));
    console.log('UNCOVERED ENTRIES (no loader, no pool)\n');
    console.log(`${pad('Raw', 5)} ${pad('Label', 22)} ${pad('Category', 20)} ${pad('Type', 22)} ${pad('Notes', 50)}`);
    console.log(`${pad('───', 5)} ${pad('─────', 22)} ${pad('────────', 20)} ${pad('────', 22)} ${pad('─────', 50)}`);
    for (const c of uncovered) {
        const e = c.entry;
        const typeName = e.type != null ? (MapObjectType[e.type] ?? String(e.type)) : '—';
        console.log(
            `${pad(String(e.raw), 5)} ${pad(e.label, 22)} ${pad(e.category, 20)} ${pad(typeName, 22)} ${pad(e.notes.slice(0, 50), 50)}`
        );
    }
} else {
    console.log('\n' + '─'.repeat(80));
    console.log('ALL ENTRIES COVERED ✓\n');
}
