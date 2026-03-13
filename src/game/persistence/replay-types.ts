/**
 * Shared types for the deterministic replay persistence system.
 *
 * These contracts are used by: command-journal, keyframe-manager,
 * replay-engine, indexed-db-store, save/load integration, and
 * the determinism validator.
 */

import type { Command } from '../commands/command-types';
import type { GameStateSnapshot } from '../state/game-state-persistence';

// ─── Command Journal ────────────────────────────────────────

/** A command annotated with the tick it was executed on */
export interface JournalEntry {
    /** Simulation tick when this command was executed */
    tick: number;
    /** The command payload (already JSON-serializable) */
    command: Command;
}

/** Serialized journal — the canonical save format */
export interface CommandJournalData {
    /** Map identifier */
    mapId: string;
    /** Game settings that affect simulation (e.g. pathStraightness) */
    settings: SimulationSettings;
    /** Initial RNG seed */
    initialSeed: number;
    /** Ordered command entries */
    entries: JournalEntry[];
}

// ─── Keyframes ──────────────────────────────────────────────

/** A snapshot annotated with its tick number */
export interface Keyframe {
    /** Tick number this keyframe represents */
    tick: number;
    /** Full state snapshot (existing GameStateSnapshot format) */
    snapshot: GameStateSnapshot;
    /** Number of journal entries consumed up to this keyframe */
    journalIndex: number;
}

// ─── IndexedDB Schema ──────────────────────────────────────

/** One save session in IndexedDB */
export interface SaveSession {
    id: string;
    mapId: string;
    createdAt: number;
    updatedAt: number;
    /** Current tick count */
    currentTick: number;
}

// ─── Simulation Settings (determinism-affecting) ───────────

/**
 * Settings that affect simulation outcome — must match for replay.
 * Currently only pathStraightness affects determinism
 * (controls hex-line direction run length).
 */
export interface SimulationSettings {
    pathStraightness: number;
}

// ─── Replay Engine ─────────────────────────────────────────

export interface ReplayResult {
    /** Final tick reached */
    tick: number;
    /** Number of commands replayed */
    commandsReplayed: number;
}

// ─── Determinism Validator ─────────────────────────────────

/** Hash of game state for determinism comparison */
export interface StateHash {
    tick: number;
    entityCount: number;
    /** CRC32 of sorted entity (id, x, y, subType, player) tuples */
    entityHash: number;
    /** RNG state */
    rngState: number;
}

// ─── Selection command types (excluded from journal) ───────

/** Command types that don't affect simulation state — excluded from journal */
export const SELECTION_COMMAND_TYPES: ReadonlySet<string> = new Set([
    'select',
    'select_at_tile',
    'toggle_selection',
    'select_area',
    'select_multiple',
    'select_same_unit_type',
]);
