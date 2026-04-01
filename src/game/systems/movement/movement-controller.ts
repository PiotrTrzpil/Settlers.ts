import { TileCoord } from '../../entity';
import { getStepDirection, EDirection, getStepDistanceFactor } from '../hex-directions';

/**
 * Movement state machine states (external API).
 * - idle: Unit has no path and is stationary
 * - moving: Unit is actively following a path (includes waiting for occupied tiles)
 */
export type MovementState = 'idle' | 'moving';

/**
 * Tagged union for controller phase — makes state transitions explicit
 * and scopes path/wait data to the phases that use them.
 */
type ControllerPhase =
    | { readonly tag: 'idle' }
    | { readonly tag: 'moving'; path: TileCoord[]; pathIndex: number; waitTime: number };

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

    // --- Busy state (pick/put animation — unbumpable) ---
    private _busy = false;

    // --- Cumulative wait time (not reset by repath, only by successful steps) ---
    private _cumulativeWaitTime = 0;

    // --- Teleport detection ---
    private _lastVisualX = 0;
    private _lastVisualY = 0;
    private _stepsTakenThisTick = 0;

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
        if (this._phase.tag === 'moving') {
            return 'moving';
        }
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

    /** Number of executeMove steps taken since last advanceProgress. */
    get stepsTakenThisTick(): number {
        return this._stepsTakenThisTick;
    }

    get nextWaypoint(): TileCoord | undefined {
        if (this._phase.tag === 'idle') {
            return undefined;
        }
        const { path, pathIndex } = this._phase;
        return pathIndex < path.length ? path[pathIndex] : undefined;
    }

    get direction(): number {
        return this._direction;
    }

    setDirection(direction: EDirection): void {
        this._direction = direction;
    }

    get goal(): TileCoord | undefined {
        if (this._phase.tag === 'idle') {
            return undefined;
        }
        const { path } = this._phase;
        return path.length > 0 ? path[path.length - 1] : undefined;
    }

    /** How long the unit has been waiting for an occupied tile (only meaningful while moving). */
    get waitTime(): number {
        return this._phase.tag === 'moving' ? this._phase.waitTime : 0;
    }

    /**
     * Cumulative wait time across repaths. Unlike waitTime, this is NOT reset by repath —
     * only by successful steps or new paths. Used for giveup decisions.
     */
    get cumulativeWaitTime(): number {
        return this._cumulativeWaitTime;
    }

    /** True when the unit has a path but is blocked waiting for an occupied tile. */
    get isWaiting(): boolean {
        return this._phase.tag === 'moving' && this._phase.waitTime > 0 && !this.isInTransit;
    }

    /** Whether the unit is performing an unbumpable action (e.g. pick/put animation at a pile). */
    get busy(): boolean {
        return this._busy;
    }

    set busy(value: boolean) {
        this._busy = value;
    }

    // =====================================================================
    // Path management
    // =====================================================================

    /** Start following a new path from stationary state. */
    startPath(path: TileCoord[]): void {
        if (path.length === 0) {
            return;
        }

        const visualBefore = this.computeVisualPosition();

        this._phase = { tag: 'moving', path: [...path], pathIndex: 0, waitTime: 0 };
        this._cumulativeWaitTime = 0;

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
        this._phase = { tag: 'moving', path: [...path], pathIndex: 0, waitTime: 0 };
        this._cumulativeWaitTime = 0;
        this.warnIfTeleported(visualBefore, 'redirectPath');
    }

    /** Replace entire remaining path. */
    replacePath(newPath: TileCoord[]): void {
        const visualBefore = this.computeVisualPosition();
        const p = this.activePathPhase();
        p.path = [...newPath];
        p.pathIndex = 0;
        p.waitTime = 0;
        this.warnIfTeleported(visualBefore, 'replacePath');
    }

    /** Clear the current path and transition to idle. */
    clearPath(): void {
        this._phase = IDLE;
    }

    // =====================================================================
    // Progress & wait time management
    // =====================================================================

    /**
     * Halt progress accumulation when the unit can't advance further this tick.
     * Must snap any completed transit first — otherwise the visual interpolation
     * (lerp from prevTile to tile at progress) would show the unit at prevTile
     * instead of at tile where it actually is.
     */
    haltProgress(): void {
        if (this.isInTransit) {
            this._prevTileX = this._tileX;
            this._prevTileY = this._tileY;
        }
        this._progress = 0;
    }

    /** Add elapsed time to the wait counter (called every tick while waiting for an occupied tile). */
    addWaitTime(deltaSec: number): void {
        if (this._phase.tag === 'moving') {
            this._phase.waitTime += deltaSec;
            this._cumulativeWaitTime += deltaSec;
        }
    }

    /** Reset wait time to zero (e.g. after a successful step or repath). */
    resetWaitTime(): void {
        if (this._phase.tag === 'moving') {
            this._phase.waitTime = 0;
        }
    }

    // =====================================================================
    // Tick processing
    // =====================================================================

    /** Advance movement progress by delta time. */
    advanceProgress(deltaSec: number, maxProgress?: number): number {
        this._stepsTakenThisTick = 0;
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
        if (!this.canMove()) {
            return null;
        }

        const p = this.activePathPhase();
        const wp = p.path[p.pathIndex]!;

        this._prevTileX = this._tileX;
        this._prevTileY = this._tileY;
        this._tileX = wp.x;
        this._tileY = wp.y;

        this._direction = getStepDirection(this._tileX - this._prevTileX, this._tileY - this._prevTileY);
        this._distanceFactor = getStepDistanceFactor(this._tileX - this._prevTileX, this._tileY - this._prevTileY);

        p.pathIndex++;
        this._progress -= 1;
        this._stepsTakenThisTick++;

        // Successful move → reset wait time (both per-repath and cumulative)
        p.waitTime = 0;
        this._cumulativeWaitTime = 0;

        return wp;
    }

    /** Handle path completion and transit completion. Call after processing all moves. */
    finalizeTick(): void {
        if (this.hasPath) {
            return;
        }

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
     * Handle being pushed/bumped by another unit.
     * Only updates position and visual state — path management is handled by caller.
     * IMPORTANT: Caller must ensure unit is NOT mid-transit to prevent teleporting.
     */
    handlePush(newX: number, newY: number): void {
        const visualBefore = this.computeVisualPosition();

        this._prevTileX = this._tileX;
        this._prevTileY = this._tileY;
        this._tileX = newX;
        this._tileY = newY;
        this._progress = 0;
        this._stepsTakenThisTick++;

        this.warnIfTeleported(visualBefore, 'handlePush');

        this._direction = getStepDirection(this._tileX - this._prevTileX, this._tileY - this._prevTileY);
        this._distanceFactor = getStepDistanceFactor(this._tileX - this._prevTileX, this._tileY - this._prevTileY);

        // Transition to moving if we have a path; idle units stay idle (transit tracked via isInTransit)
        if (this._phase.tag === 'moving') {
            this._phase.waitTime = 0;
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

    /** Get the active path phase (moving). Throws on idle — contract violation. */
    private activePathPhase(): Extract<ControllerPhase, { tag: 'moving' }> {
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
