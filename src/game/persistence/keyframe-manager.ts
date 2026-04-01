/**
 * KeyframeManager — periodic state snapshot management for deterministic replay.
 *
 * Takes a snapshot every N ticks (default: 300) and keeps the last 3 in memory.
 * Snapshots use the existing GameStateSnapshot format via a caller-supplied callback —
 * the manager does not know how to create snapshots, it only decides when to.
 *
 * Public API:
 * - maybeTakeKeyframe(tick, journalIndex, snapshotFn) — conditionally take a snapshot
 * - addKeyframe(keyframe) — manually insert a keyframe (e.g. tick-0 initial save)
 * - getLatestKeyframe() — most recent keyframe
 * - getKeyframeAtOrBefore(tick) — best keyframe for replaying to a target tick
 * - clear() — reset all state
 */

import type { GameStateSnapshot } from '../state/game-state-persistence';
import type { Keyframe } from './replay-types';

/** Default interval between keyframes in simulation ticks (~10 seconds at 30 tps). */
export const DEFAULT_KEYFRAME_INTERVAL = 300;

/** Maximum keyframes retained in memory. Oldest is evicted when limit is exceeded. */
const MAX_KEYFRAMES = 3;

export class KeyframeManager {
    private readonly keyframeInterval: number;
    /** Keyframes sorted ascending by tick. Max MAX_KEYFRAMES entries. */
    private readonly keyframes: Keyframe[] = [];

    constructor(keyframeInterval: number = DEFAULT_KEYFRAME_INTERVAL) {
        if (keyframeInterval <= 0) {
            throw new Error(`KeyframeManager: keyframeInterval must be positive, got ${keyframeInterval}`);
        }
        this.keyframeInterval = keyframeInterval;
    }

    /**
     * Conditionally take a keyframe if enough ticks have elapsed since the last one.
     *
     * @param tick - Current simulation tick
     * @param journalIndex - Number of journal entries recorded up to this tick
     * @param snapshotFn - Callback that produces the state snapshot; called only if a keyframe is needed
     * @returns The new keyframe if one was taken, null otherwise
     */
    maybeTakeKeyframe(tick: number, journalIndex: number, snapshotFn: () => GameStateSnapshot): Keyframe | null {
        const lastKeyframe = this.keyframes[this.keyframes.length - 1];
        const lastTick = lastKeyframe?.tick ?? -Infinity;

        if (tick - lastTick < this.keyframeInterval) {
            return null;
        }

        const snapshot = snapshotFn();
        const keyframe: Keyframe = { tick, snapshot, journalIndex };
        this.insertKeyframe(keyframe);
        return keyframe;
    }

    /**
     * Manually insert a keyframe — used for the initial tick-0 save or forced snapshots.
     * Replaces any existing keyframe at the same tick.
     */
    addKeyframe(keyframe: Keyframe): void {
        // Remove any existing keyframe at the same tick before inserting.
        const existing = this.keyframes.findIndex(kf => kf.tick === keyframe.tick);
        if (existing !== -1) {
            this.keyframes.splice(existing, 1);
        }
        this.insertKeyframe(keyframe);
    }

    /**
     * Returns the most recent keyframe, or null if none have been taken yet.
     */
    getLatestKeyframe(): Keyframe | undefined {
        return this.keyframes[this.keyframes.length - 1];
    }

    /**
     * Returns the best keyframe for replaying to the given target tick:
     * the most recent keyframe whose tick is ≤ targetTick.
     *
     * Returns null if no suitable keyframe exists (e.g. all keyframes are after the target tick,
     * or no keyframes have been added yet).
     */
    getKeyframeAtOrBefore(targetTick: number): Keyframe | null {
        // Keyframes are sorted ascending; scan from end to find the latest that fits.
        for (let i = this.keyframes.length - 1; i >= 0; i--) {
            const kf = this.keyframes[i]!;
            if (kf.tick <= targetTick) {
                return kf;
            }
        }
        return null;
    }

    /**
     * Reset all keyframe state. Used when starting a new game or loading a fresh session.
     */
    clear(): void {
        this.keyframes.length = 0;
    }

    /** Number of keyframes currently in memory. */
    get count(): number {
        return this.keyframes.length;
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    /**
     * Insert a keyframe into the sorted list, maintaining ascending tick order.
     * Evicts the oldest keyframe when MAX_KEYFRAMES is exceeded.
     */
    private insertKeyframe(keyframe: Keyframe): void {
        // Insert in ascending tick order (most calls will append at the end).
        let insertAt = this.keyframes.length;
        for (let i = this.keyframes.length - 1; i >= 0; i--) {
            if (this.keyframes[i]!.tick <= keyframe.tick) {
                break;
            }
            insertAt = i;
        }
        this.keyframes.splice(insertAt, 0, keyframe);

        // Evict oldest entries when over the limit.
        while (this.keyframes.length > MAX_KEYFRAMES) {
            this.keyframes.shift();
        }
    }
}
