/**
 * Ore vein population — from real S4 map data or random fallback.
 *
 * Real maps: MapObjects byte 3 encodes ore type + amount (16 levels per type).
 * Levels are stored at full resolution; visual quantization happens in ResourceSignSystem.
 *
 * Test maps: deterministic random ore distribution on rock tiles.
 */

import type { TerrainData } from '../../terrain/terrain-data';
import { SeededRng } from '../../core/rng';
import { OreType, MAX_ORE_LEVEL } from './ore-type';
import { OreVeinData } from './ore-vein-data';

/** S4 resource value ranges — [min, max] per ore type. */
const S4_COAL_MIN = 17;
const S4_COAL_MAX = 32;
const S4_IRON_MIN = 33;
const S4_IRON_MAX = 48;
const S4_GOLD_MIN = 49;
const S4_GOLD_MAX = 64;
const S4_SULPHUR_MIN = 65;
const S4_SULPHUR_MAX = 80;
const S4_STONE_MIN = 81;
const S4_STONE_MAX = 96;

/** Map S4 resource byte to OreType. Returns None for non-ore values (fish, stone, wood). */
function s4ValueToOreType(value: number): OreType {
    if (value >= S4_COAL_MIN && value <= S4_COAL_MAX) return OreType.Coal;
    if (value >= S4_IRON_MIN && value <= S4_IRON_MAX) return OreType.Iron;
    if (value >= S4_GOLD_MIN && value <= S4_GOLD_MAX) return OreType.Gold;
    if (value >= S4_SULPHUR_MIN && value <= S4_SULPHUR_MAX) return OreType.Sulfur;
    if (value >= S4_STONE_MIN && value <= S4_STONE_MAX) return OreType.Stone;
    return OreType.None;
}

/** Extract the 1-16 amount from an S4 resource byte. */
function s4ValueToAmount(value: number): number {
    if (value >= S4_COAL_MIN && value <= S4_COAL_MAX) return value - S4_COAL_MIN + 1;
    if (value >= S4_IRON_MIN && value <= S4_IRON_MAX) return value - S4_IRON_MIN + 1;
    if (value >= S4_GOLD_MIN && value <= S4_GOLD_MAX) return value - S4_GOLD_MIN + 1;
    if (value >= S4_SULPHUR_MIN && value <= S4_SULPHUR_MAX) return value - S4_SULPHUR_MIN + 1;
    if (value >= S4_STONE_MIN && value <= S4_STONE_MAX) return value - S4_STONE_MIN + 1;
    return 0;
}

/**
 * Load ore veins from S4 map resource data (MapObjects byte 3).
 * Each byte encodes ore type + amount (1-16). Levels are stored at full
 * resolution so mines can deplete gradually; the sign system quantizes
 * to 3 visual tiers (LOW/MED/RICH) for display only.
 */
export function loadOreVeinsFromResourceData(oreVeins: OreVeinData, resourceData: Uint8Array): void {
    const tileCount = Math.min(oreVeins.oreType.length, resourceData.length);
    for (let i = 0; i < tileCount; i++) {
        const raw = resourceData[i]!;
        if (raw === 0) continue;

        const type = s4ValueToOreType(raw);
        if (type === OreType.None) continue;

        const amount = s4ValueToAmount(raw);
        oreVeins.oreType[i] = type;
        oreVeins.oreLevel[i] = amount;
    }
}

// ──────── Random fallback for test maps ────────

const ORE_SEED = 1337;
const DISTRIBUTED_ORES: readonly OreType[] = [OreType.Coal, OreType.Iron, OreType.Gold];

/**
 * Populate ore veins on all rock tiles using a deterministic RNG.
 * ~70% of rock tiles receive ore with a random type and level.
 */
export function populateOreVeins(oreVeins: OreVeinData, terrain: TerrainData): void {
    const rng = new SeededRng(ORE_SEED);

    for (let y = 0; y < terrain.height; y++) {
        for (let x = 0; x < terrain.width; x++) {
            if (!terrain.isRock(x, y)) continue;

            // 30% chance of empty
            if (rng.next() < 0.3) continue;

            const type = DISTRIBUTED_ORES[rng.nextInt(DISTRIBUTED_ORES.length)]!;
            const level = rng.nextInt(MAX_ORE_LEVEL) + 1;
            oreVeins.setOre(x, y, type, level);
        }
    }
}
