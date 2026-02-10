import { TileCoord } from '../../entity';
import { getApproxDirection, EDirection } from '../hex-directions';

/**
 * Movement state machine states.
 * - idle: Unit has no path and is stationary
 * - moving: Unit is actively following a path
 * - blocked: Unit is temporarily blocked and waiting
 */
export type MovementState = 'idle' | 'moving' | 'blocked';

/**
 * Per-unit movement controller that encapsulates all movement state.
 * Manages the state machine for a single unit's movement, including
 * path following, visual interpolation, and state transitions.
 */
export class MovementController {
    /** Entity ID this controller manages */
    readonly entityId: number;

    /** Current movement state */
    private _state: MovementState = 'idle';

    /** Current tile position (logical position) */
    private _tileX: number;
    private _tileY: number;

    /** Previous tile position (for visual interpolation) */
    private _prevTileX: number;
    private _prevTileY: number;

    /** Interpolation progress (0 to 1) between prevTile and current tile */
    private _progress: number = 0;

    /** Movement speed in tiles per second */
    private _speed: number;

    /** Current path to follow */
    private _path: TileCoord[] = [];

    /** Current index in path */
    private _pathIndex: number = 0;

    /** Time spent blocked in seconds (for timeout handling) */
    private _blockedTime: number = 0;

    /** Current facing direction (0-5 for hex directions, updated when steps are taken) */
    private _direction: number = EDirection.EAST;

    /** Last computed visual position for teleport detection */
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

    /**
     * Compute the current visual position (fractional tile coordinates).
     * This is what the renderer would display.
     */
    private computeVisualPosition(): { x: number; y: number } {
        const t = Math.max(0, Math.min(this._progress, 1));
        return {
            x: this._prevTileX + (this._tileX - this._prevTileX) * t,
            y: this._prevTileY + (this._tileY - this._prevTileY) * t,
        };
    }

    /**
     * Update the last visual position. Call this at the END of each tick
     * after all state changes, so we can detect teleports on the next change.
     */
    updateLastVisualPosition(): void {
        const pos = this.computeVisualPosition();
        this._lastVisualX = pos.x;
        this._lastVisualY = pos.y;
    }

    /**
     * Check if the current visual position is continuous with the last visual position.
     * A teleport is detected if the visual position jumps by more than a small threshold.
     * @returns Distance jumped, or 0 if continuous
     */
    detectTeleport(): number {
        const pos = this.computeVisualPosition();
        const dx = pos.x - this._lastVisualX;
        const dy = pos.y - this._lastVisualY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // === State Getters ===

    get state(): MovementState {
        return this._state;
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

    /** Set movement speed (tiles per second). Primarily for testing. */
    setSpeed(speed: number): void {
        this._speed = speed;
    }

    get path(): ReadonlyArray<TileCoord> {
        return this._path;
    }

    get pathIndex(): number {
        return this._pathIndex;
    }

    /** Check if unit is currently in visual transit (interpolating between tiles) */
    get isInTransit(): boolean {
        return this._prevTileX !== this._tileX || this._prevTileY !== this._tileY;
    }

    /** Check if unit has more path to follow */
    get hasPath(): boolean {
        return this._pathIndex < this._path.length;
    }

    /** Get next waypoint, or null if no more waypoints */
    get nextWaypoint(): TileCoord | null {
        return this._pathIndex < this._path.length ? this._path[this._pathIndex] : null;
    }

    /** Current facing direction (0-5 for hex directions). Updated when movement steps occur. */
    get direction(): number {
        return this._direction;
    }

    /** Get the current goal (final waypoint), or null if no path. */
    get goal(): TileCoord | null {
        return this._path.length > 0 ? this._path[this._path.length - 1] : null;
    }

    // === Path Management ===

    /**
     * Start following a new path from stationary state.
     * Progress starts at 0; the unit will move after (1/speed) seconds.
     */
    startPath(path: TileCoord[]): void {
        if (path.length === 0) return;

        // Check for potential teleport
        const visualBefore = this.computeVisualPosition();

        this._path = [...path];
        this._pathIndex = 0;
        this._state = 'moving';

        // Set up for smooth interpolation
        if (!this.isInTransit) {
            this._prevTileX = this._tileX;
            this._prevTileY = this._tileY;
            // Start at 1 to trigger immediate first step execution in next update
            this._progress = 1;
        }
        // If in transit, keep current progress to avoid visual jump

        this._blockedTime = 0;

        // Verify no teleport occurred
        const visualAfter = this.computeVisualPosition();
        const dx = visualAfter.x - visualBefore.x;
        const dy = visualAfter.y - visualBefore.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.1) {
            console.warn(`[MovementController] startPath caused teleport! Entity ${this.entityId} jumped ${dist.toFixed(2)} tiles`);
        }
    }

    /**
     * Redirect to a new path while potentially in motion.
     * Preserves current visual interpolation state.
     */
    redirectPath(path: TileCoord[]): void {
        if (path.length === 0) {
            this.clearPath();
            return;
        }

        // Capture visual position before change
        const visualBefore = this.computeVisualPosition();

        this._path = [...path];
        this._pathIndex = 0;
        this._state = 'moving';
        this._blockedTime = 0;

        // Don't touch progress or prevTile - keep smooth motion

        // Verify no teleport occurred
        const visualAfter = this.computeVisualPosition();
        const dx = visualAfter.x - visualBefore.x;
        const dy = visualAfter.y - visualBefore.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.1) {
            console.warn(`[MovementController] redirectPath caused teleport! Entity ${this.entityId} jumped ${dist.toFixed(2)} tiles`);
        }
    }

    /**
     * Clear the current path and transition to idle.
     */
    clearPath(): void {
        this._path = [];
        this._pathIndex = 0;
        this._state = 'idle';
        this._blockedTime = 0;
    }

    // === Tick Processing ===

    /**
     * Advance movement progress by delta time.
     * Call this every tick before processing moves.
     * @param deltaSec Time since last tick
     * @param maxProgress Optional cap on total progress (prevents teleporting on lag)
     * @returns The accumulated progress (may be > 1 if multiple moves are pending)
     */
    advanceProgress(deltaSec: number, maxProgress?: number): number {
        // Only advance if moving or in visual transit
        if (this._state === 'moving' || this.isInTransit) {
            this._progress += this._speed * deltaSec;

            // Cap progress to prevent teleporting on large delta times
            if (maxProgress !== undefined && this._progress > maxProgress) {
                this._progress = maxProgress;
            }
        }

        return this._progress;
    }

    /**
     * Check if a move is ready (progress >= 1 and path available).
     */
    canMove(): boolean {
        return this._progress >= 1 && this.hasPath;
    }

    /**
     * Consume one move tick worth of progress.
     * Call this when a tile move is executed.
     */
    consumeMoveTick(): void {
        this._progress -= 1;
    }

    /**
     * Execute a move to the next waypoint.
     * Updates internal state and returns the new position.
     * @returns The new tile position, or null if no move was made
     */
    executeMove(): TileCoord | null {
        if (!this.canMove()) return null;

        const wp = this._path[this._pathIndex];

        // Store previous position for interpolation
        this._prevTileX = this._tileX;
        this._prevTileY = this._tileY;

        // Update current position
        this._tileX = wp.x;
        this._tileY = wp.y;

        // Update facing direction based on movement
        this._direction = getApproxDirection(this._prevTileX, this._prevTileY, this._tileX, this._tileY);

        // Advance path
        this._pathIndex++;

        // Consume progress
        this.consumeMoveTick();

        // Clear blocked state on successful move
        this._blockedTime = 0;

        return wp;
    }

    /**
     * Mark the unit as blocked this tick.
     * @param deltaSec Time since last tick (for timeout tracking)
     */
    setBlocked(deltaSec: number): void {
        this._state = 'blocked';
        this._blockedTime += deltaSec;
        this._progress = 0; // Wait for next tick
    }

    /**
     * Get how long the unit has been blocked.
     */
    get blockedTime(): number {
        return this._blockedTime;
    }

    /**
     * Handle path completion and transit completion.
     * Call this after processing all moves for the tick.
     */
    finalizeTick(): void {
        // Check if path is complete
        if (!this.hasPath) {
            if (this._path.length > 0) {
                this._path = [];
                this._pathIndex = 0;
            }

            // Check if visual transit is complete
            if (this.isInTransit) {
                if (this._progress >= 1) {
                    // Interpolation complete, sync prev to current
                    this._prevTileX = this._tileX;
                    this._prevTileY = this._tileY;
                    this._progress = 0;
                    this._state = 'idle';
                }
            } else {
                // Already stationary
                this._progress = 0;
                this._state = 'idle';
            }
        }
    }

    // === Position Updates (for external coordination) ===

    /**
     * Sync position from external entity state.
     * Used when entity position changes outside of normal movement
     * (e.g., initial spawn, teleport, editor placement).
     */
    syncPosition(x: number, y: number): void {
        this._tileX = x;
        this._tileY = y;
        this._prevTileX = x;
        this._prevTileY = y;
        this._progress = 0;
        // Preserve current facing direction on position sync (teleport/spawn)
    }

    /**
     * Handle being pushed by another unit.
     * Only updates position and visual state - path management is handled by caller.
     * IMPORTANT: Caller must ensure unit is NOT mid-transit to prevent teleporting.
     */
    handlePush(newX: number, newY: number): void {
        // ASSERT: We should not be mid-transit when pushed
        // If we are, log it and handle gracefully
        if (this.isInTransit) {
            console.warn(`[MovementController] handlePush called mid-transit for entity ${this.entityId}! ` +
                `Visual pos: (${this._prevTileX},${this._prevTileY}) -> (${this._tileX},${this._tileY}) @ ${this._progress.toFixed(2)}`);
        }

        // When not mid-transit, prevTile === currTile, so visual is at currTile
        // Set up push animation: from current tile to pushed position
        this._prevTileX = this._tileX;
        this._prevTileY = this._tileY;
        this._tileX = newX;
        this._tileY = newY;
        this._progress = 0;

        // Update facing direction based on push direction
        this._direction = getApproxDirection(this._prevTileX, this._prevTileY, this._tileX, this._tileY);

        // Set state to moving so the renderer interpolates this forced move
        this._state = 'moving';
    }

    /**
     * Insert a detour tile at the current path position.
     */
    insertDetour(tile: TileCoord): void {
        this._path.splice(this._pathIndex, 0, tile);
    }

    /**
     * Replace path with a new prefix and keep remaining suffix.
     */
    replacePathPrefix(newPrefix: TileCoord[], suffixStartIndex: number): void {
        const suffix = this._path.slice(suffixStartIndex);
        this._path = [...newPrefix, ...suffix];
        this._pathIndex = 0;
    }

    /**
     * Replace entire remaining path.
     */
    replacePath(newPath: TileCoord[]): void {
        this._path = [...newPath];
        this._pathIndex = 0;
    }

}
