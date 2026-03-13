/**
 * CommandJournal — append-only log of game commands annotated with tick numbers.
 *
 * Records every simulation-affecting command executed during a game session.
 * Selection commands are excluded because they don't affect simulation state.
 *
 * The journal is the canonical save format for the deterministic replay system:
 * given a keyframe snapshot at tick K and journal entries from that point
 * onward, the game state at any later tick can be reconstructed exactly.
 *
 * Lifecycle:
 * - Created fresh for a new game session
 * - `record(command)` called from GameCore.execute() for every command
 * - `advanceTick()` called from GameCore.tick() once per simulation tick
 * - `truncateFrom(index)` called when restoring from a keyframe
 * - `toData()` / `fromData()` for IndexedDB persistence
 */

import type { Command } from '../commands/command-types';
import { type CommandJournalData, type JournalEntry, SELECTION_COMMAND_TYPES } from './replay-types';

export class CommandJournal {
    private entries: JournalEntry[] = [];
    private currentTick: number = 0;

    // ─── Tick tracking ──────────────────────────────────────────────────────

    /**
     * Advance the internal tick counter by one.
     * Called once per simulation tick from GameCore.tick().
     */
    advanceTick(): void {
        this.currentTick++;
    }

    /**
     * The current simulation tick (number of ticks elapsed since journal start).
     */
    getTick(): number {
        return this.currentTick;
    }

    // ─── Recording ──────────────────────────────────────────────────────────

    /**
     * Record a command at the current tick.
     * Selection commands are silently skipped — they don't affect simulation state.
     */
    record(command: Command): void {
        if (SELECTION_COMMAND_TYPES.has(command.type)) {
            return;
        }

        this.entries.push({ tick: this.currentTick, command });
    }

    // ─── Querying ───────────────────────────────────────────────────────────

    /**
     * All journal entries in chronological order.
     */
    getEntries(): readonly JournalEntry[] {
        return this.entries;
    }

    /**
     * Journal entries starting at the given journal index (inclusive).
     * Used by the replay engine to get commands since a keyframe.
     *
     * @param index - The journal index to start from (0-based, as stored in Keyframe.journalIndex)
     * @throws If index is out of range
     */
    getEntriesFrom(index: number): readonly JournalEntry[] {
        if (index < 0 || index > this.entries.length) {
            throw new Error(
                `CommandJournal.getEntriesFrom: index ${index} out of range (journal has ${this.entries.length} entries)`
            );
        }

        return this.entries.slice(index);
    }

    /**
     * Number of entries currently in the journal.
     * Use this as the journalIndex when creating a keyframe.
     */
    get length(): number {
        return this.entries.length;
    }

    // ─── Mutation ───────────────────────────────────────────────────────────

    /**
     * Truncate all entries at and after the given index.
     * Called when restoring from a keyframe — entries after the keyframe's
     * journalIndex become stale and must be discarded before replay.
     *
     * @param index - First index to remove (entries[index] and beyond are deleted)
     * @throws If index is out of range
     */
    truncateFrom(index: number): void {
        if (index < 0 || index > this.entries.length) {
            throw new Error(
                `CommandJournal.truncateFrom: index ${index} out of range (journal has ${this.entries.length} entries)`
            );
        }

        this.entries = this.entries.slice(0, index);
    }

    /**
     * Clear all entries and reset tick counter to zero.
     * Used when starting a fresh session.
     */
    clear(): void {
        this.entries = [];
        this.currentTick = 0;
    }

    // ─── Serialization ──────────────────────────────────────────────────────

    /**
     * Serialize the journal to a plain data object for IndexedDB persistence.
     * The caller provides map metadata (mapId, settings, initialSeed) since the
     * journal itself doesn't hold those — they belong to the session.
     */
    toData(mapId: string, settings: CommandJournalData['settings'], initialSeed: number): CommandJournalData {
        return {
            mapId,
            settings,
            initialSeed,
            entries: this.entries.slice(),
        };
    }

    /**
     * Restore journal state from a persisted data object.
     * Replaces all current entries and resets tick to the last entry's tick
     * (or 0 if empty). The replay engine will advance ticks as it replays.
     *
     * @param data - Previously serialized journal data
     * @param currentTick - The tick to restore the counter to (typically the keyframe tick)
     */
    fromData(data: CommandJournalData, currentTick: number): void {
        this.entries = data.entries.slice();
        this.currentTick = currentTick;
    }
}
