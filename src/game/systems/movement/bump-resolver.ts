/**
 * Bump resolution for unit collisions.
 *
 * Handles pushing idle/waiting units out of the way when a moving unit
 * needs their tile. Supports recursive chain-pushes and swap fallbacks.
 *
 * Extracted from MovementSystem to keep file sizes manageable.
 */

import { Tile, tileKey } from '../../entity';
import type { EventBus, GameEvents } from '../../event-bus';
import { getAllNeighbors } from '../hex-directions';
import { isPassable } from '../../terrain';
import { MovementController } from './movement-controller';
import type { IPathfinder } from './pathfinding-service';
import type { UpdatePositionFn } from './movement-system';
import { setPathfindingEntityContext } from '../pathfinding';

/**
 * Score a candidate bump destination. Higher is better.
 * Prefers tiles perpendicular to the bumper's travel direction (side-step),
 * penalizes tiles ahead of the bumper (which cause repeated bumps).
 */
function scoreBumpTile(tile: Tile, occupant: MovementController, travelDx: number, travelDy: number): number {
    const dx = tile.x - occupant.tileX;
    const dy = tile.y - occupant.tileY;
    return -(dx * travelDx + dy * travelDy);
}

/** Maximum depth for recursive bump chains to prevent infinite loops. */
const MAX_BUMP_DEPTH = 4;

/**
 * Dependencies injected from MovementSystem so BumpResolver stays decoupled.
 */
export interface BumpResolverDeps {
    controllers: Map<number, MovementController>;
    unitOccupancy: Map<string, number>;
    buildingOccupancy: Set<string>;
    eventBus: EventBus;
    pathfinder: IPathfinder;
    updatePositionFn: UpdatePositionFn;
    terrainGroundType: Uint8Array | undefined;
    terrainMapWidth: number;
    terrainMapHeight: number;
    verbose: boolean;
}

/**
 * Resolves bump collisions between units.
 *
 * Stateless — all mutable state is accessed through the deps reference,
 * which points back to MovementSystem's fields.
 */
export class BumpResolver {
    constructor(private readonly deps: BumpResolverDeps) {}

    /**
     * Attempt to bump an occupant out of the way, recursively if needed.
     * Returns true if bump succeeded (occupant moved, tile is now free).
     */
    tryBump(bumper: MovementController, occupantId: number, depth = 0): boolean {
        if (this.deps.verbose && depth === 0) {
            this.emitBumpAttempt(bumper.entityId, occupantId);
        }
        if (depth > MAX_BUMP_DEPTH) {
            this.emitBumpFailed(bumper.entityId, occupantId, 'max_depth');
            return false;
        }

        const occupant = this.deps.controllers.get(occupantId);
        if (!occupant || !this.canBumpOccupant(bumper, occupant)) {
            this.emitBumpFailed(bumper.entityId, occupantId, this.bumpFailReason(occupant), {
                occupantState: occupant?.state,
                occupantBusy: occupant?.busy,
            });
            return false;
        }

        return this.tryBumpOrSwap(bumper, occupant, occupantId, depth);
    }

    /**
     * Push any unit standing at (x, y) to a free passable neighbor tile.
     * Returns true if the tile is now free (was empty or push succeeded).
     */
    pushUnitAt(x: number, y: number): boolean {
        const key = tileKey(x, y);
        const occupantId = this.deps.unitOccupancy.get(key);
        if (occupantId === undefined) {
            return true;
        }

        const occupant = this.deps.controllers.get(occupantId);
        if (!occupant) {
            return true;
        }

        const neighbors = getAllNeighbors({ x, y });
        for (const n of neighbors) {
            if (!this.isTilePassableForBump(n.x, n.y)) {
                continue;
            }
            if (this.getUnitAt(tileKey(n.x, n.y), occupantId) !== undefined) {
                continue;
            }

            const oldKey = tileKey(occupant.tileX, occupant.tileY);
            if (this.deps.unitOccupancy.get(oldKey) === occupantId) {
                this.deps.unitOccupancy.delete(oldKey);
            }
            occupant.handlePush(n.x, n.y);
            this.deps.unitOccupancy.set(tileKey(n.x, n.y), occupantId);
            this.deps.updatePositionFn(occupantId, n.x, n.y);
            this.repathBumpedOccupant(occupant, n);
            return true;
        }
        return false;
    }

    /**
     * Check if a tile is passable for bump destination:
     * in bounds, passable terrain, not blocked by a completed building.
     */
    isTilePassableForBump(x: number, y: number): boolean {
        if (x < 0 || x >= this.deps.terrainMapWidth || y < 0 || y >= this.deps.terrainMapHeight) {
            return false;
        }
        if (this.deps.terrainGroundType) {
            const idx = x + y * this.deps.terrainMapWidth;
            if (!isPassable(this.deps.terrainGroundType[idx]!)) {
                return false;
            }
        }
        if (this.deps.buildingOccupancy.has(tileKey(x, y))) {
            return false;
        }
        return true;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /** Find the unit occupying a tile, excluding selfId. */
    private getUnitAt(key: string, selfId: number): number | undefined {
        const occupant = this.deps.unitOccupancy.get(key);
        if (occupant !== undefined && occupant !== selfId) {
            return occupant;
        }
        return undefined;
    }

    private canBumpOccupant(bumper: MovementController, occupant: MovementController): boolean {
        if (occupant.busy) {
            return false;
        }
        if (occupant.state === 'moving' && occupant.waitTime === 0) {
            return false;
        }
        if (occupant.state !== 'idle' && bumper.entityId >= occupant.entityId) {
            return false;
        }
        return true;
    }

    private tryBumpOrSwap(
        bumper: MovementController,
        occupant: MovementController,
        occupantId: number,
        depth: number
    ): boolean {
        const dest = this.findBumpDestination(occupant, bumper, depth);
        if (!dest) {
            return this.swapOrFail(bumper, occupant, occupantId, depth, 'no_destination');
        }

        if (!this.clearTileForBump(occupant, dest, depth)) {
            return this.swapOrFail(bumper, occupant, occupantId, depth, 'dest_occupied');
        }

        this.executeBump(bumper.entityId, occupant, occupantId, dest);
        return true;
    }

    private swapOrFail(
        bumper: MovementController,
        occupant: MovementController,
        occupantId: number,
        depth: number,
        reason: string
    ): boolean {
        if (depth === 0 && this.trySwap(bumper, occupant, occupantId)) {
            return true;
        }
        this.emitBumpFailed(bumper.entityId, occupantId, reason, {
            occupantPos: occupant.tileX + ',' + occupant.tileY,
        });
        return false;
    }

    private executeBump(bumperId: number, occupant: MovementController, occupantId: number, dest: Tile): void {
        if (this.deps.verbose) {
            this.deps.eventBus.emit('movement:bump', {
                unitId: bumperId,
                occupantId,
                fromX: occupant.tileX,
                fromY: occupant.tileY,
                toX: dest.x,
                toY: dest.y,
            });
        }
        const oldKey = tileKey(occupant.tileX, occupant.tileY);
        if (this.deps.unitOccupancy.get(oldKey) === occupantId) {
            this.deps.unitOccupancy.delete(oldKey);
        }
        occupant.handlePush(dest.x, dest.y);
        this.deps.unitOccupancy.set(tileKey(dest.x, dest.y), occupantId);
        this.deps.updatePositionFn(occupantId, dest.x, dest.y);
        this.repathBumpedOccupant(occupant, dest);
    }

    private trySwap(bumper: MovementController, occupant: MovementController, occupantId: number): boolean {
        const bumperTile: Tile = { x: bumper.tileX, y: bumper.tileY };
        if (!this.isTilePassableForBump(bumperTile.x, bumperTile.y)) {
            return false;
        }
        this.executeBump(bumper.entityId, occupant, occupantId, bumperTile);
        return true;
    }

    private repathBumpedOccupant(occupant: MovementController, dest: Tile): void {
        const goal = occupant.goal;
        if (!goal) {
            return;
        }
        setPathfindingEntityContext(occupant.entityId);
        const newPath = this.deps.pathfinder.findPath(dest.x, dest.y, goal.x, goal.y);
        setPathfindingEntityContext(undefined);
        if (newPath && newPath.length > 0) {
            occupant.replacePath(newPath);
        }
    }

    private bumpFailReason(occupant: MovementController | undefined): string {
        if (!occupant) {
            return 'no_controller';
        }
        if (occupant.busy) {
            return 'busy';
        }
        if (occupant.state === 'moving' && occupant.waitTime === 0) {
            return 'actively_moving';
        }
        return 'priority';
    }

    private clearTileForBump(bumper: MovementController, dest: Tile, depth: number): boolean {
        const destOccupantId = this.getUnitAt(tileKey(dest.x, dest.y), bumper.entityId);
        if (destOccupantId === undefined) {
            return true;
        }
        return this.tryBump(bumper, destOccupantId, depth + 1);
    }

    private findBumpDestination(occupant: MovementController, bumper: MovementController, depth: number): Tile | null {
        const neighbors = getAllNeighbors({ x: occupant.tileX, y: occupant.tileY });
        const travelDx = occupant.tileX - bumper.tileX;
        const travelDy = occupant.tileY - bumper.tileY;

        const free: Tile[] = [];
        const bumpable: Tile[] = [];

        for (const n of neighbors) {
            if (n.x === bumper.tileX && n.y === bumper.tileY) {
                continue;
            }
            if (!this.isTilePassableForBump(n.x, n.y)) {
                continue;
            }
            const nOccupant = this.getUnitAt(tileKey(n.x, n.y), occupant.entityId);
            if (nOccupant === undefined) {
                free.push(n);
            } else if (depth < MAX_BUMP_DEPTH && this.isBumpableOccupant(nOccupant)) {
                bumpable.push(n);
            }
        }

        const candidates = free.length > 0 ? free : bumpable;
        if (candidates.length === 0) {
            return null;
        }
        if (candidates.length === 1) {
            return candidates[0]!;
        }

        return this.pickBestBumpTile(candidates, occupant, travelDx, travelDy);
    }

    private isBumpableOccupant(occupantId: number): boolean {
        const ctrl = this.deps.controllers.get(occupantId);
        if (!ctrl) {
            return false;
        }
        if (ctrl.busy) {
            return false;
        }
        if (ctrl.state === 'idle') {
            return true;
        }
        return ctrl.waitTime > 0;
    }

    private pickBestBumpTile(
        candidates: Tile[],
        occupant: MovementController,
        travelDx: number,
        travelDy: number
    ): Tile {
        let best = candidates[0]!;
        let bestScore = scoreBumpTile(best, occupant, travelDx, travelDy);
        for (let i = 1; i < candidates.length; i++) {
            const n = candidates[i]!;
            const score = scoreBumpTile(n, occupant, travelDx, travelDy);
            if (score > bestScore) {
                bestScore = score;
                best = n;
            }
        }
        return best;
    }

    private emitBumpAttempt(bumperId: number, occupantId: number): void {
        if (!this.deps.verbose) {
            return;
        }
        const occ = this.deps.controllers.get(occupantId);
        this.deps.eventBus.emit('movement:bumpAttempt', {
            unitId: bumperId,
            occupantId,
            hasController: !!occ,
            occupantState: occ?.state,
            occupantBusy: occ?.busy,
        });
    }

    private emitBumpFailed(
        bumperId: number,
        occupantId: number,
        reason: string,
        extra?: Omit<GameEvents['movement:bumpFailed'], 'unitId' | 'occupantId' | 'reason'>
    ): void {
        if (!this.deps.verbose) {
            return;
        }
        this.deps.eventBus.emit('movement:bumpFailed', { unitId: bumperId, occupantId, reason, ...extra });
    }
}
