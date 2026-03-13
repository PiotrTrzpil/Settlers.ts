import type { GameCore } from '@/game/game-core';
import type { CliArgs, CliCommand, CliContext, CliResult } from './types';
import { resolveBuilding, resolveUnit, resolveMaterial } from './enum-resolver';
import { createFormatter } from './formatter';

/** A captured console log entry. */
export interface LogEntry {
    level: 'log' | 'warn' | 'error';
    time: number;
    msg: string;
}

const MAX_LOG_ENTRIES = 200;

function isNumeric(s: string): boolean {
    return s.length > 0 && !Number.isNaN(Number(s));
}

/**
 * Parse a token list into positional args and --flags.
 * `--key value` → { key: value }, `--flag` → { flag: true }.
 */
function parseArgs(tokens: string[]): CliArgs {
    const positional: (string | number)[] = [];
    const flags: Record<string, string | number | boolean> = {};
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i]!;
        if (!tok.startsWith('--')) {
            positional.push(isNumeric(tok) ? Number(tok) : tok);
            continue;
        }
        const key = tok.slice(2);
        const next = tokens[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags[key] = isNumeric(next) ? Number(next) : next;
            i++;
        } else {
            flags[key] = true;
        }
    }
    return { _: positional, ...flags };
}

/**
 * In-browser CLI engine: parses text commands, dispatches to registered handlers,
 * and returns compact text results for LLM consumption.
 */
export class GameCli {
    private readonly commands = new Map<string, CliCommand>();
    private readonly game: GameCore;
    private readonly fmt = createFormatter();
    private readonly logBuffer: LogEntry[] = [];
    private logCursor = 0;
    /** Sticky player override. null = use game.currentPlayer. */
    private playerOverride: number | null = null;

    constructor(game: GameCore, commands: CliCommand[]) {
        this.game = game;
        for (const cmd of commands) {
            this.registerCommand(cmd);
        }
        this.installConsoleCapture();
    }

    /** Get the effective CLI player (per-command --p > sticky override > game default). */
    get currentPlayer(): number {
        return this.playerOverride ?? this.game.currentPlayer;
    }

    /** Set or clear the sticky player override. Validates the player exists. */
    setPlayer(player: number | null): void {
        if (player !== null && !this.game.playerRaces.has(player)) {
            const available = [...this.game.playerRaces.keys()].sort((a, b) => a - b);
            throw new Error(`player ${player} not found. available: ${available.join(', ')}`);
        }
        this.playerOverride = player;
    }

    /** Whether the current player is a sticky override (vs game default). */
    get isPlayerOverride(): boolean {
        return this.playerOverride !== null;
    }

    /** Get new log entries since last call, up to `limit`. */
    drainLogs(limit: number): LogEntry[] {
        const entries = this.logBuffer.slice(this.logCursor, this.logCursor + limit);
        this.logCursor += entries.length;
        return entries;
    }

    /** Get recent log entries (tail of buffer). */
    recentLogs(count: number): LogEntry[] {
        return this.logBuffer.slice(-count);
    }

    private installConsoleCapture(): void {
        if (typeof window === 'undefined') {
            return;
        }
        const levels = ['log', 'warn', 'error'] as const;
        for (const level of levels) {
            const original = console[level].bind(console);
            console[level] = (...args: unknown[]) => {
                original(...args);
                const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
                this.logBuffer.push({ level, time: Date.now(), msg });
                if (this.logBuffer.length > MAX_LOG_ENTRIES) {
                    this.logBuffer.shift();
                }
            };
        }
    }

    /** Single entry point: parse input, dispatch to handler, return result. */
    run(input: string): CliResult {
        const trimmed = input.trim();
        if (trimmed.length === 0) {
            return { ok: false, output: 'empty command' };
        }

        const firstSpace = trimmed.indexOf(' ');
        const commandName = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
        const rawArgs = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1);
        const args = parseArgs(rawArgs.split(/\s+/).filter(s => s.length > 0));

        const command = this.commands.get(commandName);
        if (!command) {
            return { ok: false, output: `unknown command '${commandName}'. try 'help'` };
        }

        const player = typeof args['p'] === 'number' ? args['p'] : this.currentPlayer;

        const ctx: CliContext = {
            game: this.game,
            player,
            rawArgs,
            resolveBuilding,
            resolveUnit,
            resolveMaterial,
            fmt: this.fmt,
        };

        try {
            return command.execute(args, ctx);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, output: message };
        }
    }

    /** Convenience: run a command and return just the output string. */
    runText(input: string): string {
        return this.run(input).output;
    }

    /** Get all registered commands (unique by primary name, for help listing). */
    getCommands(): CliCommand[] {
        const seen = new Set<string>();
        const result: CliCommand[] = [];
        for (const cmd of this.commands.values()) {
            if (seen.has(cmd.name)) {
                continue;
            }
            seen.add(cmd.name);
            result.push(cmd);
        }
        return result;
    }

    registerCommand(cmd: CliCommand): void {
        this.commands.set(cmd.name, cmd);
        for (const alias of cmd.aliases) {
            this.commands.set(alias, cmd);
        }
    }
}
