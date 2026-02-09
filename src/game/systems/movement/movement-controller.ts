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

    constructor(entityId: number, x: number, y: number, speed: number) {
        this.entityId = entityId;
        this._tileX = x;
        this._tileY = y;
        this._prevTileX = x;
        this._prevTileY = y;
        this._speed = speed;
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

    // === Path Management ===

    /**
     * Start following a new path from stationary state.
     * Progress starts at 0; the unit will move after (1/speed) seconds.
     */
    startPath(path: TileCoord[]): void {
        if (path.length === 0) return;

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

        this._path = [...path];
        this._pathIndex = 0;
        this._state = 'moving';
        this._blockedTime = 0;

        // Don't touch progress or prevTile - keep smooth motion
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
     * @returns The accumulated progress (may be > 1 if multiple moves are pending)
     */
    advanceProgress(deltaSec: number): number {
        // Only advance if moving or in visual transit
        if (this._state === 'moving' || this.isInTransit) {
            this._progress += this._speed * deltaSec;
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
        // Don't reset _lastDirection here, as we might want to preserve facing if just snapping position?
        // But if it's a spawn, 0 is a fine default.
    }

    /**
     * Handle being pushed by another unit.
     * Sets up smooth interpolation to the new position.
     */
    handlePush(newX: number, newY: number): void {
        // Capture old position for interpolation
        this._prevTileX = this._tileX;
        this._prevTileY = this._tileY;

        // Update to new position
        this._tileX = newX;
        this._tileY = newY;

        // Clear path (pushed units lose their current path)
        this._path = [];
        this._pathIndex = 0;

        // Start from 0 progress for smooth transition
        this._progress = 0;

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

    // === Direction Calculation ===

    /** Last calculated movement direction (0-5 for 6 hex directions) */
    private _lastDirection: number = EDirection.EAST;

    /**
     * Compute the movement direction from previous to current tile.
     * Returns a direction index 0-5 matching EDirection (hex grid directions).
     * If stationary, returns the last known direction.
     */
    computeMovementDirection(): number {
        const dx = this._tileX - this._prevTileX;
        const dy = this._tileY - this._prevTileY;

        // If not moving (visually), return last known direction
        if (dx === 0 && dy === 0) {
            return this._lastDirection;
        }

        // Use hex grid direction calculation for 6 directions
        const newDir = getApproxDirection(this._prevTileX, this._prevTileY, this._tileX, this._tileY);
        this._lastDirection = newDir;
        return newDir;
    }
}
