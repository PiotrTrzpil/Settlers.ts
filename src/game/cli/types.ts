import type { GameCore } from '@/game/game-core';
import type { BuildingType } from '@/game/buildings/building-type';
import type { EMaterialType } from '@/game/economy/material-type';
import type { UnitType } from '@/game/core/unit-types';

/** Result of a CLI command execution. */
export interface CliResult {
    /** true if the command succeeded */
    ok: boolean;
    /** Human/LLM-readable output text */
    output: string;
}

/** Parsed CLI arguments: positional args + named flags. */
export interface CliArgs {
    /** Positional arguments (non-flag tokens). */
    _: (string | number)[];
    /** Named flags (--key value or --flag). Access via args['key']. */
    [key: string]: string | number | boolean | (string | number)[];
}

/** A registered CLI command handler. */
export interface CliCommand {
    /** Primary name (short alias like "b", "mv", "ls") */
    name: string;
    /** Longer aliases (e.g., "build", "move", "list") */
    aliases: string[];
    /** One-line usage string for help */
    usage: string;
    /** Brief description */
    desc: string;
    /** Execute the command. */
    execute(args: CliArgs, ctx: CliContext): CliResult;
}

/** Context passed to every command handler. */
export interface CliContext {
    game: GameCore;
    /** The player index used for commands (defaults to game.currentPlayer, override with --p) */
    player: number;
    /** Raw input string after the command name (unparsed). */
    rawArgs: string;
    /** Resolve a building name to BuildingType (case-insensitive, throws on unknown) */
    resolveBuilding(name: string): BuildingType;
    /** Resolve a unit name to UnitType (case-insensitive, throws on unknown) */
    resolveUnit(name: string): UnitType;
    /** Resolve a material name to EMaterialType (case-insensitive, throws on unknown) */
    resolveMaterial(name: string): EMaterialType;
    /** Format a compact output table */
    fmt: OutputFormatter;
}

/** Compact text table builder. */
export interface OutputFormatter {
    /** Format rows as aligned columns. Headers are optional. */
    table(rows: string[][], headers?: string[]): string;
    /** Format a key-value summary (one per line). */
    kv(entries: [string, string | number][]): string;
}

// ─── WebSocket protocol ───────────────────────────────────────

/** Message from commander (external) → Vite server → executor (browser). */
export interface WsCommandMessage {
    id: number;
    cmd: string;
}

/** Message from executor (browser) → Vite server → commander (external). */
export interface WsResultMessage {
    id: number;
    ok: boolean;
    output: string;
}

/** Registration message from browser to identify as the game executor. */
export interface WsRegisterMessage {
    type: 'register';
    role: 'executor';
}

// ─── Timeline streaming protocol ──────────────────────────────

/** Serializable timeline entry — matches the SQLite schema columns. */
export interface SerializedTimelineEntry {
    tick: number;
    category: string;
    entityId?: number;
    entityType?: string;
    unitId?: number;
    buildingId?: number;
    player?: number;
    x?: number;
    y?: number;
    event: string;
    detail: string;
    level?: string;
    unitType?: string;
    buildingType?: string;
    meta?: string;
}

/** Commander → relay → executor: start streaming timeline entries. */
export interface WsTimelineSubscribe {
    type: 'timeline:subscribe';
}

/** Commander → relay → executor: stop streaming timeline entries. */
export interface WsTimelineUnsubscribe {
    type: 'timeline:unsubscribe';
}

/** Executor → relay → subscribed commanders: batch of timeline entries. */
export interface WsTimelineBatch {
    type: 'timeline:batch';
    entries: SerializedTimelineEntry[];
}

/** Executor → relay → all subscribers: recording stopped (e.g., game destroyed). */
export interface WsTimelineEnd {
    type: 'timeline:end';
}

/** Union of all WS messages that bypass the command/response queue. */
export type WsPushMessage = WsTimelineBatch | WsTimelineEnd;
export type WsControlMessage = WsTimelineSubscribe | WsTimelineUnsubscribe;
