import { TileCoord } from '../../entity';
import { getApproxDirection, EDirection, getStepDistanceFactor } from '../hex-directions';

/**
 * Movement state machine states (external API).
 * - idle: Unit has no path and is stationary
 * - moving: Unit is actively following a path (or sliding after push)
 * - blocked: Unit is temporarily blocked and waiting
 */
export type MovementState = 'idle' | 'moving' | 'blocked';

/**
 * Tagged union for controller phase — makes state transitions explicit
 * and scopes path/blocked data to the phases that use them.
 */
type ControllerPhase =
    | { readonly tag: 'idle' }
    | { readonly tag: 'moving'; path: TileCoord[]; pathIndex: number }
    | { readonly tag: 'blocked'; path: TileCoord[]; pathIndex: number; blockedTime: number };

const IDLE: ControllerPhase = { tag: 'idle' };

/**
 * Per-unit movement controller with explicit tagged-union state machine.
 * Manages path following, visual interpolation, and state transitions.
 */
export class MovementController {
    readonly entityId: number;

    // --- Phase (tagged union) ---
    private _phase: ControllerPhase = IDLE;

    // --- Position (common to all phases) ---
    private _tileX: number;
    private _tileY: number;
    private _prevTileX: number;
    private _prevTileY: number;

    // --- Interpolation & movement ---
    private _progress: number = 0;
    private _speed: number;
    private _direction: number = EDirection.EAST;
    private _distanceFactor: number = 1.0;

    // --- Teleport detection ---
    private _lastVisualX = 0;
    private _lastVisualY = 0;

    constructor(entityId: number, x: number, y: number, speed: number) {
        this.entityId = entityId;
        this._tileX = x;
        this._tileY = y;
        this._prevTileX = x;
        this._prevTileY = y;
        this._speed = speed;
        this._lastVisualX = x;
        this._lastVisualY = y;
    }

    // =====================================================================
    // State getters
    // =====================================================================

    /** External state — derives from phase tag + transit status. */
    get state(): MovementState {
        if (this._phase.tag !== 'idle') return this._phase.tag === 'blocked' ? 'blocked' : 'moving';
        // Idle phase but still sliding (e.g. after push without path) → report 'moving'
        return this.isInTransit ? 'moving' : 'idle';
    }

    get tileX(): number {
        return this._tileX;
    }

    get tileY(): number {
        return this._tileY;
    }

    get prevTileX(): number {
        return this._prevTileX;
    }

    get prevTileY(): number {
        return this._prevTileY;
    }

    get progress(): number {
        return this._progress;
    }

    get speed(): number {
        return this._speed;
    }

    setSpeed(speed: number): void {
        this._speed = speed;
    }

    get path(): ReadonlyArray<TileCoord> {
        return this._phase.tag !== 'idle' ? this._phase.path : [];
    }

    get pathIndex(): number {
        return this._phase.tag !== 'idle' ? this._phase.pathIndex : 0;
    }

    /** Unit is visually interpolating between tiles. */
    get isInTransit(): boolean {
        return this._prevTileX !== this._tileX || this._prevTileY !== this._tileY;
    }

    /** Unit has more path waypoints to follow. */
    get hasPath(): boolean {
        return this._phase.tag !== 'idle' && this._phase.pathIndex < this._phase.path.length;
    }

    get nextWaypoint(): TileCoord | null {
        if (this._phase.tag === 'idle') return null;
        const { path, pathIndex } = this._phase;
        return pathIndex < path.length ? (path[pathIndex] ?? null) : null;
    }

    get direction(): number {
        return this._direction;
    }

    setDirection(direction: EDirection): void {
        this._direction = direction;
    }

    get goal(): TileCoord | null {
        if (this._phase.tag === 'idle') return null;
        const { path } = this._phase;
        return path.length > 0 ? (path[path.length - 1] ?? null) : null;
    }

    get blockedTime(): number {
        return this._phase.tag === 'blocked' ? this._phase.blockedTime : 0;
    }

    // =====================================================================
    // Path management
    // =====================================================================

    /** Start following a new path from stationary state. */
    startPath(path: TileCoord[]): void {
        if (path.length === 0) return;

        const visualBefore = this.computeVisualPosition();

        this._phase = { tag: 'moving', path: [...path], pathIndex: 0 };

        if (!this.isInTransit) {
            this._prevTileX = this._tileX;
            this._prevTileY = this._tileY;
            this._progress = 1; // Trigger immediate first step
        }

        this.warnIfTeleported(visualBefore, 'startPath');
    }

    /** Redirect to a new path while potentially in motion. */
    redirectPath(path: TileCoord[]): void {
        if (path.length === 0) {
            this.clearPath();
            return;
        }

        const visualBefore = this.computeVisualPosition();
        this._phase = { tag: 'moving', path: [...path], pathIndex: 0 };
        this.warnIfTeleported(visualBefore, 'redirectPath');
    }

    /** Clear the current path and transition to idle. */
    clearPath(): void {
        this._phase = IDLE;
    }

    /** Insert a detour tile at the current path position. */
    insertDetour(tile: TileCoord): void {
        const p = this.activePathPhase();
        p.path.splice(p.pathIndex, 0, tile);
    }

    /** Replace path with a new prefix and keep remaining suffix. */
    replacePathPrefix(newPrefix: TileCoord[], suffixStartIndex: number): void {
        const p = this.activePathPhase();
        const suffix = p.path.slice(suffixStartIndex);
        p.path = [...newPrefix, ...suffix];
        p.pathIndex = 0;
    }

    /** Replace entire remaining path. */
    replacePath(newPath: TileCoord[]): void {
        const p = this.activePathPhase();
        p.path = [...newPath];
        p.pathIndex = 0;
    }

    /** Replace path from a given index onward with a new suffix. */
    replacePathSuffix(newSuffix: TileCoord[], suffixStartIndex: number): void {
        const p = this.activePathPhase();
        p.path = [...p.path.slice(0, suffixStartIndex), ...newSuffix];
    }

    // =====================================================================
    // Tick processing
    // =====================================================================

    /** Advance movement progress by delta time. */
    advanceProgress(deltaSec: number, maxProgress?: number): number {
        if (this._phase.tag !== 'idle' || this.isInTransit) {
            this._progress += (this._speed * deltaSec) / this._distanceFactor;
            if (maxProgress !== undefined && this._progress > maxProgress) {
                this._progress = maxProgress;
            }
        }
        return this._progress;
    }

    /** Check if a move is ready (progress >= 1 and path available). */
    canMove(): boolean {
        return this._progress >= 1 && this.hasPath;
    }

    /** Execute a move to the next waypoint. Returns new position or null. */
    executeMove(): TileCoord | null {
        if (!this.canMove()) return null;

        const p = this.activePathPhase();
        const wp = p.path[p.pathIndex]!;

        this._prevTileX = this._tileX;
        this._prevTileY = this._tileY;
        this._tileX = wp.x;
        this._tileY = wp.y;

        this._direction = getApproxDirection(this._prevTileX, this._prevTileY, this._tileX, this._tileY);
        this._distanceFactor = getStepDistanceFactor(this._tileX - this._prevTileX, this._tileY - this._prevTileY);

        p.pathIndex++;
        this._progress -= 1;

        // Successful move → ensure we're in 'moving' phase (clears blocked)
        if (p.tag === 'blocked') {
            this._phase = { tag: 'moving', path: p.path, pathIndex: p.pathIndex };
        }

        return wp;
    }

    /** Mark the unit as blocked this tick. Resets progress so the unit waits. */
    setBlocked(): void {
        const phase = this._phase;
        if (phase.tag === 'idle') return; // pushed/sliding unit — nothing to block
        this._phase = {
            tag: 'blocked',
            path: phase.path,
            pathIndex: phase.pathIndex,
            blockedTime: phase.tag === 'blocked' ? phase.blockedTime : 0,
        };
        this._progress = 0;
    }

    /** Add elapsed time to the blocked counter (called every tick while blocked). */
    addBlockedTime(deltaSec: number): void {
        if (this._phase.tag === 'blocked') {
            this._phase.blockedTime += deltaSec;
        }
    }

    /** Reset blocked time (e.g. after escalated repath succeeds). */
    resetBlockedTime(): void {
        if (this._phase.tag === 'blocked') {
            this._phase.blockedTime = 0;
        }
    }

    /** Handle path completion and transit completion. Call after processing all moves. */
    finalizeTick(): void {
        if (this.hasPath) return;

        // Path exhausted — clean up phase
        if (this._phase.tag !== 'idle') {
            this._phase = IDLE;
        }

        // Handle visual transit completion
        if (this.isInTransit) {
            if (this._progress >= 1) {
                this._prevTileX = this._tileX;
                this._prevTileY = this._tileY;
                this._progress = 0;
            }
        } else {
            this._progress = 0;
        }
    }

    // =====================================================================
    // Position updates (external coordination)
    // =====================================================================

    /** Sync position from external state (spawn, teleport, editor). */
    syncPosition(x: number, y: number): void {
        this._tileX = x;
        this._tileY = y;
        this._prevTileX = x;
        this._prevTileY = y;
        this._progress = 0;
        this._lastVisualX = x;
        this._lastVisualY = y;
    }

    /**
     * Handle being pushed by another unit.
     * Only updates position and visual state — path management is handled by caller.
     * IMPORTANT: Caller must ensure unit is NOT mid-transit to prevent teleporting.
     */
    handlePush(newX: number, newY: number): void {
        if (this.isInTransit) {
            console.warn(
                `[MovementController] handlePush called mid-transit for entity ${this.entityId}! ` +
                    `Visual pos: (${this._prevTileX},${this._prevTileY}) -> (${this._tileX},${this._tileY}) @ ${this._progress.toFixed(2)}`
            );
        }

        this._prevTileX = this._tileX;
        this._prevTileY = this._tileY;
        this._tileX = newX;
        this._tileY = newY;
        this._progress = 0;

        this._direction = getApproxDirection(this._prevTileX, this._prevTileY, this._tileX, this._tileY);
        this._distanceFactor = getStepDistanceFactor(this._tileX - this._prevTileX, this._tileY - this._prevTileY);

        // Transition to moving if we have a path; idle units stay idle (transit tracked via isInTransit)
        if (this._phase.tag !== 'idle') {
            this._phase = { tag: 'moving', path: this._phase.path, pathIndex: this._phase.pathIndex };
        }
    }

    // =====================================================================
    // Teleport detection
    // =====================================================================

    updateLastVisualPosition(): void {
        const pos = this.computeVisualPosition();
        this._lastVisualX = pos.x;
        this._lastVisualY = pos.y;
    }

    detectTeleport(): number {
        const pos = this.computeVisualPosition();
        const dx = pos.x - this._lastVisualX;
        const dy = pos.y - this._lastVisualY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // =====================================================================
    // Internal helpers
    // =====================================================================

    private computeVisualPosition(): { x: number; y: number } {
        const t = Math.max(0, Math.min(this._progress, 1));
        return {
            x: this._prevTileX + (this._tileX - this._prevTileX) * t,
            y: this._prevTileY + (this._tileY - this._prevTileY) * t,
        };
    }

    /** Get the active path phase (moving or blocked). Throws on idle — contract violation. */
    private activePathPhase(): Exclude<ControllerPhase, { tag: 'idle' }> {
        if (this._phase.tag === 'idle') {
            throw new Error(`Entity ${this.entityId}: path operation on idle controller`);
        }
        return this._phase;
    }

    private warnIfTeleported(visualBefore: { x: number; y: number }, label: string): void {
        const visualAfter = this.computeVisualPosition();
        const dx = visualAfter.x - visualBefore.x;
        const dy = visualAfter.y - visualBefore.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.1) {
            console.warn(
                `[MovementController] ${label} caused teleport! Entity ${this.entityId} jumped ${dist.toFixed(2)} tiles` +
                    ` | before=(${visualBefore.x.toFixed(1)},${visualBefore.y.toFixed(1)})` +
                    ` after=(${visualAfter.x.toFixed(1)},${visualAfter.y.toFixed(1)})` +
                    ` | tile=(${this._tileX},${this._tileY}) prev=(${this._prevTileX},${this._prevTileY})` +
                    ` | progress=${this._progress.toFixed(2)} state=${this._phase.tag}`
            );
        }
    }
}
