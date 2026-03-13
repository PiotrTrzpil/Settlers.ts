/**
 * Synchronous replay engine — replays a command journal against a restored GameCore.
 *
 * Usage:
 *   1. Restore a GameCore from a keyframe snapshot (via game-state-persistence).
 *   2. Call replay(game, entries, fromTick, toTick) to fast-forward to target tick.
 *   3. The returned ReplayResult confirms the final tick and command count.
 *
 * All event handlers remain active during replay — they are part of the simulation.
 * Only rendering, sound, and UI are excluded (GameCore is already headless).
 */

import type { GameCore } from '../game-core';
import type { JournalEntry, ReplayResult } from './replay-types';

/** Maximum ticks that can be replayed in a single call (~5 minutes at 30 tps). */
const MAX_REPLAY_TICKS = 9_000;

/**
 * Replay journal entries against a GameCore that has been restored from a keyframe.
 *
 * @param game      - GameCore instance restored from the keyframe at `fromTick`
 * @param entries   - Journal entries from `journalIndex` of the keyframe onward
 * @param fromTick  - The tick the keyframe was taken at (starting simulation tick)
 * @param toTick    - The target tick to replay up to (inclusive)
 * @returns ReplayResult with final tick and command count
 * @throws Error if the replay window exceeds MAX_REPLAY_TICKS or inputs are invalid
 */
export function replay(
    game: GameCore,
    entries: readonly JournalEntry[],
    fromTick: number,
    toTick: number
): ReplayResult {
    validateReplayRange(fromTick, toTick);

    // Build a tick-indexed map of commands for O(1) lookup per tick.
    const commandsByTick = indexEntriesByTick(entries, fromTick, toTick);

    let commandsReplayed = 0;
    let currentTick = fromTick;

    while (currentTick < toTick) {
        currentTick++;

        // Advance simulation by one tick (all tick systems run, events fire).
        game.tick(1);

        // Inject any commands recorded at this tick.
        const tickCommands = commandsByTick.get(currentTick);
        if (tickCommands !== undefined) {
            for (const cmd of tickCommands) {
                game.execute(cmd);
                commandsReplayed++;
            }
        }
    }

    return { tick: currentTick, commandsReplayed };
}

/**
 * Validate that the replay range is legal.
 *
 * @throws Error on invalid or oversized range
 */
function validateReplayRange(fromTick: number, toTick: number): void {
    if (fromTick < 0) {
        throw new Error(`replay: fromTick must be >= 0, got ${fromTick}`);
    }
    if (toTick < fromTick) {
        throw new Error(`replay: toTick (${toTick}) must be >= fromTick (${fromTick})`);
    }

    const tickCount = toTick - fromTick;
    if (tickCount > MAX_REPLAY_TICKS) {
        throw new Error(
            `replay: window of ${tickCount} ticks exceeds MAX_REPLAY_TICKS (${MAX_REPLAY_TICKS}). ` +
                `Take a new keyframe closer to toTick (${toTick}) to reduce the replay window.`
        );
    }
}

/**
 * Build a Map from tick number to the ordered list of commands at that tick.
 *
 * Entries outside [fromTick+1, toTick] are skipped — they belong to a prior
 * replay window or a future window not yet reached.
 */
function indexEntriesByTick(
    entries: readonly JournalEntry[],
    fromTick: number,
    toTick: number
): Map<number, JournalEntry['command'][]> {
    const byTick = new Map<number, JournalEntry['command'][]>();

    for (const entry of entries) {
        const { tick, command } = entry;

        // Only include ticks within (fromTick, toTick] — fromTick itself is the
        // already-restored keyframe state; commands at fromTick are already applied.
        if (tick <= fromTick || tick > toTick) {
            continue;
        }

        let bucket = byTick.get(tick);
        if (bucket === undefined) {
            bucket = [];
            byTick.set(tick, bucket);
        }
        bucket.push(command);
    }

    return byTick;
}
