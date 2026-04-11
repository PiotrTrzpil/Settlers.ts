/**
 * Garrison Render Spec — defines draw order for garrison buildings.
 *
 * Each spec is a list of towers. A tower renders in order:
 *   1. overlay `{name}` (back sprite) — skipped if not found
 *   2. all listed settlers
 *   3. overlay `{name}_frontwall` — skipped if not found
 *
 * Every settler belongs to exactly one tower.
 * All other overlays (frontwall, door, flag) are not part of the spec —
 * they are appended automatically after all towers are rendered.
 */

import { BuildingType } from '@/game/buildings/building-type';
import { Race } from '@/game/core/race';

// ── Types ───────────────────────────────────────────────────────

export interface TowerSlot {
    /** Tower name. Emits overlay `{name}` as back and `{name}_frontwall` as front. */
    readonly name: string;
    /** XML settler position indices to render between back and front. */
    readonly settlers: readonly number[];
}

const tower = (name: string, ...settlers: number[]): TowerSlot => ({ name, settlers });

// ── Guard Towers (same for all races) ───────────────────────────

const GUARD_TOWER: readonly TowerSlot[] = [tower('', 0, 1, 2, 3, 4, 5)];

// ── Castle (per-race settler groupings) ─────────────────────────
//
// Each race's castle has 9 settler positions (XML indices 0–8).
// Every settler is assigned to one of three towers based on
// spatial proximity from XML pixel offset analysis.

/** Roman Castle */
const CASTLE_ROMAN: readonly TowerSlot[] = [
    tower('tower1', 4, 5, 8), // top tower   — bowman (4) + swordsman (5) + bowman (8)
    tower('tower3', 6, 7), // right tower — pair (6,7)
    tower('', 0), // bowman (0) — between tower3 and main frontwall
    tower('frontwall'), // main castle frontwall
    tower('tower2', 1, 2, 3), // center — swordsman (1) + pair (2,3)
    tower('door'), // castle gate
];

/** Mayan Castle */
const CASTLE_MAYA: readonly TowerSlot[] = [
    tower('tower3', 4, 5, 8), // far left + top  (x≈-28..-136)
    tower('tower1', 0, 1, 2, 3), // center-left     (x≈-19..+24)
    tower('tower2', 6, 7), // right            (x≈+106..+114)
];

/** Viking Castle */
const CASTLE_VIKING: readonly TowerSlot[] = [
    tower('tower3', 2, 3, 8), // far left + top  (x≈-45..-98)
    tower('tower1', 0, 1, 4, 7), // center          (x≈-57..+67)
    tower('tower2', 5, 6), // right            (x≈+104)
];

/** Trojan Castle — no tower back patches, only frontwalls. */
const CASTLE_TROJAN: readonly TowerSlot[] = [
    tower('tower1', 0, 4, 7, 8), // left group     (x≈-52..-130)
    tower('tower2', 1, 5, 6), // right group    (x≈+94..+129)
    tower('tower3', 2, 3), // top/center     (x≈-3..+64)
];

// ── Lookup ──────────────────────────────────────────────────────

const CASTLE_SPECS: ReadonlyMap<Race, readonly TowerSlot[]> = new Map([
    [Race.Roman, CASTLE_ROMAN],
    [Race.Mayan, CASTLE_MAYA],
    [Race.Viking, CASTLE_VIKING],
    [Race.Trojan, CASTLE_TROJAN],
]);

/**
 * Get the render spec for a garrison building.
 * Returns undefined for non-garrison buildings.
 */
export function getGarrisonRenderSpec(buildingType: BuildingType, race: Race): readonly TowerSlot[] | undefined {
    if (buildingType === BuildingType.GuardTowerSmall || buildingType === BuildingType.GuardTowerBig) {
        return GUARD_TOWER;
    }
    if (buildingType === BuildingType.Castle) {
        return CASTLE_SPECS.get(race);
    }
    return undefined;
}
