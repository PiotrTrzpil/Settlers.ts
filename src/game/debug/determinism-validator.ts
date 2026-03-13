/**
 * Determinism validator — debug tool for replay-based state comparison.
 *
 * Validates that replaying a command journal from a keyframe produces state
 * identical to the live game at the same tick. Useful in integration tests
 * and manual debugging via the debug panel.
 *
 * Only intended for dev/test use — not shipped in production builds.
 */

import type { IMapLoader } from '@/resources/map/imap-loader';
import type { GameCore } from '../game-core';
import type { Keyframe, JournalEntry, StateHash } from '../persistence/replay-types';
import { replay } from '../persistence/replay-engine';
import { restoreFromSnapshot } from '../state/game-state-persistence';

// ─── CRC32 lookup table ────────────────────────────────────────────────────

/**
 * CRC32 polynomial lookup table (IEEE 802.3).
 * Generated once at module load — values are constants, not security-sensitive.
 */
const CRC32_TABLE: Uint32Array = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c;
    }
    return table;
}

/**
 * Compute CRC32 of a Uint32Array.
 * Used to hash the sorted entity tuple array.
 */
function crc32OfUint32Array(data: Uint32Array): number {
    let crc = 0xffffffff;
    // Process as bytes
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < bytes.length; i++) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]!) & 0xff]!;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// ─── StateHash computation ─────────────────────────────────────────────────

/** Number of fields per entity tuple: (id, x, y, subType, player) */
const ENTITY_TUPLE_WIDTH = 5;

/**
 * Compute a StateHash for the current game state.
 *
 * The hash covers:
 * - Entity count
 * - CRC32 of sorted entity (id, x, y, subType, player) tuples
 * - RNG state
 *
 * Entities are sorted by id before hashing to ensure deterministic order
 * regardless of insertion/removal sequences.
 */
export function computeStateHash(game: GameCore): StateHash {
    const entities = game.state.entities;
    const entityCount = entities.length;

    // Sort by id for deterministic ordering.
    const sorted = entities.slice().sort((a, b) => a.id - b.id);

    // Pack tuples into a flat Uint32Array for fast hashing.
    const tuples = new Uint32Array(entityCount * ENTITY_TUPLE_WIDTH);
    for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i]!;
        const base = i * ENTITY_TUPLE_WIDTH;
        tuples[base + 0] = e.id;
        tuples[base + 1] = e.x;
        tuples[base + 2] = e.y;
        tuples[base + 3] = e.subType;
        tuples[base + 4] = e.player;
    }

    const entityHash = crc32OfUint32Array(tuples);
    const rngState = game.state.rng.getState();

    return {
        tick: currentTick(game),
        entityCount,
        entityHash,
        rngState,
    };
}

// ─── Tick counter helper ───────────────────────────────────────────────────

/**
 * Read the current simulation tick from the game.
 *
 * GameCore.currentTick is added by Subsystem 5 (Save/Load Integration).
 * Cast through `unknown` to avoid a compile-time dependency on the field
 * being present — a missing field produces 0 (hash still works for comparison).
 */
function currentTick(game: GameCore): number {
    return (game as unknown as { currentTick?: number }).currentTick ?? 0;
}

// ─── Validation result ─────────────────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    expected: StateHash;
    actual: StateHash;
    /** Description of the first entity-level mismatch, present only when valid=false */
    firstMismatch?: string;
}

// ─── Validator ─────────────────────────────────────────────────────────────

/**
 * Validate replay determinism.
 *
 * Creates a fresh GameCore from the keyframe snapshot, replays journal entries
 * up to `currentTickCount`, then compares the resulting StateHash against the
 * live game. If they diverge, finds the first entity-level mismatch for
 * debugging.
 *
 * @param liveGame        - The running game instance (source of truth)
 * @param keyframe        - Keyframe to replay from
 * @param journalEntries  - All journal entries (filtered to keyframe.journalIndex onward)
 * @param currentTickCount - Tick number to replay to (should equal currentTick(liveGame))
 * @param mapLoader       - Map loader used to create the fresh GameCore
 */
export function validateDeterminism(
    liveGame: GameCore,
    keyframe: Keyframe,
    journalEntries: readonly JournalEntry[],
    currentTickCount: number,
    mapLoader: IMapLoader
): ValidationResult {
    const actual = computeStateHash(liveGame);

    // Create a fresh game and restore from the keyframe snapshot.
    const freshGame = new (liveGame.constructor as new (loader: IMapLoader) => GameCore)(mapLoader);
    restoreFromSnapshot(freshGame, keyframe.snapshot);

    // Replay journal entries from the keyframe's journal index onward.
    const entriesFromKeyframe = journalEntries.slice(keyframe.journalIndex);
    replay(freshGame, entriesFromKeyframe, keyframe.tick, currentTickCount);

    const expected = computeStateHash(freshGame);

    const valid =
        expected.entityCount === actual.entityCount &&
        expected.entityHash === actual.entityHash &&
        expected.rngState === actual.rngState;

    if (valid) {
        freshGame.destroy();
        return { valid: true, expected, actual };
    }

    const firstMismatch = findFirstEntityMismatch(freshGame, liveGame);
    logDivergence(expected, actual, firstMismatch);
    freshGame.destroy();

    return { valid: false, expected, actual, firstMismatch };
}

// ─── Mismatch diagnostics ──────────────────────────────────────────────────

/**
 * Find the first entity that differs between the replay game and the live game.
 * Compares by id-sorted order across both entity arrays.
 */
function findFirstEntityMismatch(replayGame: GameCore, liveGame: GameCore): string {
    const replayEntities = replayGame.state.entities.slice().sort((a, b) => a.id - b.id);
    const liveEntities = liveGame.state.entities.slice().sort((a, b) => a.id - b.id);

    if (replayEntities.length !== liveEntities.length) {
        return `entity count mismatch: replay=${replayEntities.length} live=${liveEntities.length}`;
    }

    for (let i = 0; i < replayEntities.length; i++) {
        const r = replayEntities[i]!;
        const l = liveEntities[i]!;

        if (r.id !== l.id) {
            return `id mismatch at index ${i}: replay=${r.id} live=${l.id}`;
        }
        if (r.x !== l.x || r.y !== l.y) {
            return `entity ${r.id} position mismatch: replay=(${r.x},${r.y}) live=(${l.x},${l.y})`;
        }
        if (r.subType !== l.subType) {
            return `entity ${r.id} subType mismatch: replay=${r.subType} live=${l.subType}`;
        }
        if (r.player !== l.player) {
            return `entity ${r.id} player mismatch: replay=${r.player} live=${l.player}`;
        }
    }

    return 'rngState mismatch (entities identical)';
}

/**
 * Log divergence details to the console for debugging.
 * Only runs in dev/test — callers should gate on `import.meta.env.DEV` when needed.
 */
function logDivergence(expected: StateHash, actual: StateHash, firstMismatch: string): void {
    console.error('[DeterminismValidator] State diverged after replay!');
    console.error(`  tick:        replay=${expected.tick}  live=${actual.tick}`);
    console.error(`  entityCount: replay=${expected.entityCount}  live=${actual.entityCount}`);
    console.error(
        `  entityHash:  replay=0x${expected.entityHash.toString(16).padStart(8, '0')}  live=0x${actual.entityHash.toString(16).padStart(8, '0')}`
    );
    console.error(`  rngState:    replay=${expected.rngState}  live=${actual.rngState}`);
    console.error(`  firstMismatch: ${firstMismatch}`);
}
