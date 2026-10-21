/**
 * RecruitCandidateFinder — picks the (idle carrier, tool pile) pair for a recruitment.
 *
 * With a hint: the tool pile nearest the hint, then the carrier nearest that pile.
 * With a target: minimise carrier→tool + tool→target. Neither: minimise carrier→tool.
 * Carriers in territory pockets disconnected from the reference point are skipped.
 */

import type { GameState } from '../../game-state';
import type { UnitType } from '../../core/unit-types';
import type { EMaterialType } from '../../economy/material-type';
import type { Tile } from '@/game/core/coordinates';
import type { IdleCarrierPool } from '../carriers';
import { query } from '../../ecs';
import type { ToolSourceResolver } from './tool-source-resolver';
import { SPECIALIST_TOOL_MAP } from './specialist-tool-map';

export type TileWithPile = Tile & { pileEntityId: number };

/** Result of findRecruitmentCandidate — carrier + optional tool pile. */
export interface RecruitmentCandidate {
    carrierId: number;
    toolPile: TileWithPile | null;
}

export interface CandidateSearchOpts {
    /** Destination after recruitment (optimizes carrier→tool→target distance). */
    target?: Tile;
    /** Camera-center hint (for player-queued recruitment from UI). */
    hint?: Tile;
}

/** Tool material a unit type needs; null = transforms directly. */
export function toolMaterialOf(unitType: UnitType): EMaterialType | null {
    // eslint-disable-next-line no-restricted-syntax -- index access returns undefined for missing keys; null = no tool
    return SPECIALIST_TOOL_MAP[unitType] ?? null;
}

export interface RecruitCandidateFinderConfig {
    gameState: GameState;
    idleCarrierPool: IdleCarrierPool;
    toolSourceResolver: ToolSourceResolver;
    /** Rejects carriers in territory pockets disconnected from the reference tile. */
    territoryCheck: (a: Tile, b: Tile, player: number) => boolean;
}

export class RecruitCandidateFinder {
    private readonly gameState: GameState;
    private readonly idleCarrierPool: IdleCarrierPool;
    private readonly toolSourceResolver: ToolSourceResolver;
    private readonly territoryCheck: RecruitCandidateFinderConfig['territoryCheck'];

    constructor(config: RecruitCandidateFinderConfig) {
        this.gameState = config.gameState;
        this.idleCarrierPool = config.idleCarrierPool;
        this.toolSourceResolver = config.toolSourceResolver;
        this.territoryCheck = config.territoryCheck;
    }

    /**
     * Build a carrier eligibility filter that rejects carriers in disconnected
     * territory pockets. Returns undefined if no reference point is available.
     */
    territoryFilter(ref: Tile | undefined, player: number): ((entityId: number) => boolean) | undefined {
        if (!ref) {
            return undefined;
        }
        const check = this.territoryCheck;
        const gs = this.gameState;
        return (entityId: number) => {
            const e = gs.getEntity(entityId);
            if (!e) {
                return false;
            }
            return check(e, ref, player);
        };
    }

    /** The idle carrier nearest `tile` (territory-connected to it). */
    nearestCarrier(tile: Tile, player: number): number | null {
        return this.idleCarrierPool.findNearest(tile.x, tile.y, player, this.territoryFilter(tile, player));
    }

    /**
     * Find the best carrier to recruit as the given specialist type (tool pile included when the
     * type needs a tool). See the module doc for the target / hint semantics.
     */
    find(unitType: UnitType, player: number, opts?: CandidateSearchOpts): RecruitmentCandidate | null {
        const toolMaterial = toolMaterialOf(unitType);
        const ref = opts?.target ?? opts?.hint;
        const filter = this.territoryFilter(ref, player);

        if (toolMaterial !== null) {
            if (opts?.hint) {
                return this.resolveToolWithHint(toolMaterial, opts.hint, player, filter);
            }
            return this.resolveToolByScan(toolMaterial, player, opts?.target, filter);
        }

        // No tool needed — nearest idle carrier (to the reference point, or any).
        const origin = ref ? ref : { x: 0, y: 0 };
        const carrierId = this.idleCarrierPool.findNearest(origin.x, origin.y, player, filter);
        return carrierId !== null ? { carrierId, toolPile: null } : null;
    }

    private resolveToolWithHint(
        toolMaterial: EMaterialType,
        hint: Tile,
        player: number,
        carrierFilter?: (entityId: number) => boolean
    ): RecruitmentCandidate | null {
        const toolPile = this.toolSourceResolver.findNearestToolPile(toolMaterial, hint.x, hint.y, player);
        if (!toolPile) {
            return null;
        }
        const carrierId = this.idleCarrierPool.findNearest(toolPile.x, toolPile.y, player, carrierFilter);
        if (carrierId === null) {
            return null;
        }
        return { carrierId, toolPile };
    }

    /**
     * Scan all idle carriers. For each, find the nearest tool pile and compute
     * total trip cost: carrier→tool + (tool→target if target given).
     */
    private resolveToolByScan(
        toolMaterial: EMaterialType,
        player: number,
        target?: Tile,
        carrierFilter?: (entityId: number) => boolean
    ): RecruitmentCandidate | null {
        let best: RecruitmentCandidate | null = null;
        let bestCost = Infinity;

        const store = this.idleCarrierPool.carrierStore;

        for (const [id, , entity] of query(store, this.gameState.store)) {
            if (entity.player !== player) {
                continue;
            }
            if (!this.idleCarrierPool.isIdle(id)) {
                continue;
            }
            if (carrierFilter && !carrierFilter(id)) {
                continue;
            }

            const toolPile = this.toolSourceResolver.findNearestToolPile(toolMaterial, entity.x, entity.y, player);
            if (!toolPile) {
                continue;
            }

            const cost = tripCost(entity.x, entity.y, toolPile.x, toolPile.y, target);
            if (cost < bestCost) {
                bestCost = cost;
                best = { carrierId: id, toolPile };
            }
        }

        return best;
    }
}

/** Squared distance for carrier→tool leg, plus optional tool→target leg. */
function tripCost(carrierX: number, carrierY: number, toolX: number, toolY: number, target?: Tile): number {
    const cdx = carrierX - toolX;
    const cdy = carrierY - toolY;
    let cost = cdx * cdx + cdy * cdy;
    if (target) {
        const tdx = toolX - target.x;
        const tdy = toolY - target.y;
        cost += tdx * tdx + tdy * tdy;
    }
    return cost;
}
