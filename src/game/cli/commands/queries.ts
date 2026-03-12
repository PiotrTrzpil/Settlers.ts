/**
 * Query commands — read-only state inspection for the CLI.
 *
 * Each factory function returns a CliCommand. The top-level export
 * `createQueryCommands` bundles them all and receives a callback that
 * lists every registered command (used by `help`).
 */

import type { CliArgs, CliCommand, CliContext, CliResult } from '../types';
import type { LogEntry } from '../cli';
import { Race } from '@/game/core/race';
import { EntityType, type Entity } from '@/game/entity';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType, UNIT_TYPE_CONFIG, isUnitTypeMilitary } from '@/game/core/unit-types';
import { EMaterialType } from '@/game/economy/material-type';
import { BuildingConstructionPhase } from '@/game/features/building-construction';
import { SlotKind } from '@/game/core/pile-kind';
import type { GameState } from '@/game/game-state';
import { resolveViewport, parseLayers, type MapSizePreset } from '../map-symbols';
import { renderMapText } from '../map-renderer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(output: string): CliResult {
    return { ok: true, output };
}

function fail(output: string): CliResult {
    return { ok: false, output };
}

function buildingStatusText(buildingId: number, ctx: CliContext): string {
    const site = ctx.game.services.constructionSiteManager.getSite(buildingId);
    if (!site) return 'ready';
    return BuildingConstructionPhase[site.phase];
}

function buildingTypeName(subType: number): string {
    return BuildingType[subType as BuildingType];
}

function unitTypeName(subType: number): string {
    return UNIT_TYPE_CONFIG[subType as UnitType].name;
}

function entityTypeName(entity: Entity): string {
    if (entity.type === EntityType.Building) return buildingTypeName(entity.subType);
    if (entity.type === EntityType.Unit) return unitTypeName(entity.subType);
    return EntityType[entity.type];
}

function carryingText(entity: Entity): string {
    if (!entity.carrying) return '-';
    return `${EMaterialType[entity.carrying.material]}x${entity.carrying.amount}`;
}

function posText(entity: Entity): string {
    return `${entity.x},${entity.y}`;
}

// ─── ls sub-handlers ──────────────────────────────────────────────────────────

function limitRows(rows: string[][], limit: number): { rows: string[][]; truncated: number } {
    if (limit <= 0 || rows.length <= limit) return { rows, truncated: 0 };
    return { rows: rows.slice(0, limit), truncated: rows.length - limit };
}

function tableWithLimit(rows: string[][], headers: string[], limit: number, ctx: CliContext): string {
    const { rows: limited, truncated } = limitRows(rows, limit);
    let out = ctx.fmt.table(limited, headers);
    if (truncated > 0) out += `\n... ${truncated} more (use --n to show more)`;
    return out;
}

function lsBuildings(state: GameState, player: number, limit: number, ctx: CliContext): CliResult {
    const rows: string[][] = [];
    for (const e of state.entityIndex.ofTypeAndPlayer(EntityType.Building, player)) {
        rows.push([String(e.id), entityTypeName(e), posText(e), buildingStatusText(e.id, ctx)]);
    }
    if (rows.length === 0) return ok('no buildings');
    return ok(tableWithLimit(rows, ['id', 'type', 'pos', 'status'], limit, ctx));
}

function lsUnits(state: GameState, player: number, militaryOnly: boolean, limit: number, ctx: CliContext): CliResult {
    const rows: string[][] = [];
    for (const e of state.entityIndex.ofTypeAndPlayer(EntityType.Unit, player)) {
        if (militaryOnly && !isUnitTypeMilitary(e.subType as UnitType)) continue;
        rows.push([String(e.id), entityTypeName(e), posText(e), carryingText(e)]);
    }
    if (rows.length === 0) return ok(militaryOnly ? 'no military units' : 'no units');
    return ok(tableWithLimit(rows, ['id', 'type', 'pos', 'carrying'], limit, ctx));
}

// ─── Command factories ───────────────────────────────────────────────────────

function lsCommand(): CliCommand {
    return {
        name: 'ls',
        aliases: ['list'],
        usage: 'ls [buildings|units|military] [--p N] [--n N]',
        desc: 'List entities by type (--n limits rows, default 30)',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const subCmd = String(args._[0] ?? 'buildings').toLowerCase();
            const { player } = ctx;
            const { state } = ctx.game;
            const limit = typeof args['n'] === 'number' ? args['n'] : 30;

            if (subCmd === 'buildings') return lsBuildings(state, player, limit, ctx);
            if (subCmd === 'units') return lsUnits(state, player, false, limit, ctx);
            if (subCmd === 'military') return lsUnits(state, player, true, limit, ctx);
            return fail(`unknown ls subcommand '${subCmd}'. use: buildings, units, military`);
        },
    };
}

function invCommand(): CliCommand {
    return {
        name: 'inv',
        aliases: ['inventory'],
        usage: 'inv <buildingId>',
        desc: 'Show building inventory',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const id = Number(args._[0]);
            if (!Number.isFinite(id)) return fail('usage: inv <buildingId>');

            const entity = ctx.game.state.getEntity(id);
            if (!entity) return fail(`entity ${id} not found`);
            if (entity.type !== EntityType.Building) return fail(`entity ${id} is not a building`);

            const invMgr = ctx.game.services.inventoryManager;
            if (!invMgr.hasSlots(id)) return ok('no inventory');
            const slots = invMgr.getSlots(id);

            const rows: string[][] = [];
            for (const slot of slots) {
                if (slot.materialType === EMaterialType.NO_MATERIAL) continue;
                if (slot.kind === SlotKind.Input) {
                    rows.push(['in', EMaterialType[slot.materialType], `${slot.currentAmount}/${slot.maxCapacity}`]);
                } else if (slot.kind === SlotKind.Output || slot.kind === SlotKind.Storage) {
                    rows.push(['out', EMaterialType[slot.materialType], `${slot.currentAmount}/${slot.maxCapacity}`]);
                }
            }
            if (rows.length === 0) return ok('inventory empty');
            return ok(ctx.fmt.table(rows, ['dir', 'material', 'amt']));
        },
    };
}

function entityCommand(): CliCommand {
    return {
        name: 'e',
        aliases: ['entity'],
        usage: 'e <entityId>',
        desc: 'Show entity details',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const id = Number(args._[0]);
            if (!Number.isFinite(id)) return fail('usage: e <entityId>');

            const entity = ctx.game.state.getEntity(id);
            if (!entity) return fail(`entity ${id} not found`);

            const entries: [string, string | number][] = [
                ['id', entity.id],
                ['type', EntityType[entity.type]],
                ['subType', entityTypeName(entity)],
                ['pos', posText(entity)],
                ['player', entity.player],
            ];

            if (entity.carrying) entries.push(['carrying', carryingText(entity)]);
            if (entity.hidden) entries.push(['hidden', 'true']);
            if (entity.type === EntityType.Building) {
                entries.push(['status', buildingStatusText(entity.id, ctx)]);
            }

            return ok(ctx.fmt.kv(entries));
        },
    };
}

const SIZE_PRESET_NAMES = new Set<string>(['sm', 'md', 'lg', 'xl']);

function mapCommand(): CliCommand {
    return {
        name: 'map',
        aliases: [],
        usage: 'map <x> <y> [radius|sm|md|lg|xl] [--layer terrain,buildings,units,objects,piles]',
        desc: 'Text grid of terrain and entities around a point',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const cx = Number(args._[0]);
            const cy = Number(args._[1]);
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
                return fail('usage: map <x> <y> [radius|sm|md|lg|xl] [--layer ...]');
            }

            const sizeArg = String(args._[2] ?? 'sm');
            const sizeOrRadius: MapSizePreset | number = SIZE_PRESET_NAMES.has(sizeArg)
                ? (sizeArg as MapSizePreset)
                : Number(sizeArg);
            if (typeof sizeOrRadius === 'number' && !Number.isFinite(sizeOrRadius)) {
                return fail(`invalid size '${sizeArg}'. Use sm|md|lg|xl or a number.`);
            }

            const layerArg = typeof args['layer'] === 'string' ? args['layer'] : undefined;
            let layers;
            try {
                layers = parseLayers(layerArg);
            } catch (err: unknown) {
                return fail(err instanceof Error ? err.message : String(err));
            }

            const viewport = resolveViewport(cx, cy, sizeOrRadius, ctx.game.terrain);
            return ok(renderMapText(ctx.game, viewport, layers));
        },
    };
}

function findCommand(): CliCommand {
    return {
        name: 'find',
        aliases: [],
        usage: 'find <BuildingType|UnitType> [--p N] [--n N]',
        desc: 'Find entities of a given type (--n limits rows, default 30)',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const name = String(args._[0] ?? '');
            if (!name) return fail('usage: find <BuildingType|UnitType> [--p N] [--n N]');
            const limit = typeof args['n'] === 'number' ? args['n'] : 30;

            const resolved = resolveEntitySubType(name, ctx);
            if (!resolved) return fail(`'${name}' is not a valid BuildingType or UnitType`);

            const rows: string[][] = [];
            for (const e of ctx.game.state.entityIndex.ofTypeAndPlayer(resolved.entityType, ctx.player)) {
                if (e.subType !== resolved.subType) continue;
                rows.push([String(e.id), posText(e)]);
            }

            if (rows.length === 0) return ok(`no ${name} found`);
            return ok(tableWithLimit(rows, ['id', 'pos'], limit, ctx));
        },
    };
}

/** Try resolving as BuildingType, then UnitType. Returns null on failure. */
function resolveEntitySubType(name: string, ctx: CliContext): { entityType: EntityType; subType: number } | null {
    try {
        return { entityType: EntityType.Building, subType: ctx.resolveBuilding(name) };
    } catch {
        // not a building — try unit
    }
    try {
        return { entityType: EntityType.Unit, subType: ctx.resolveUnit(name) };
    } catch {
        return null;
    }
}

function tickCommand(): CliCommand {
    return {
        name: 'tick',
        aliases: [],
        usage: 'tick',
        desc: 'Show current tick and game status',
        execute(_args: CliArgs, ctx: CliContext): CliResult {
            const tick = ctx.game.services.tickScheduler.currentTick;
            // Game subclass has _gameLoop with running/paused state
            const game = ctx.game as unknown as Record<string, unknown>;
            const loop = game['_gameLoop'] as { isRunning?: boolean; ticksPaused?: boolean } | undefined;
            if (!loop) return ok(`tick=${tick}`);
            let status = 'stopped';
            if (loop.isRunning) status = loop.ticksPaused ? 'paused' : 'running';
            return ok(`tick=${tick} status=${status}`);
        },
    };
}

function helpCommand(allCommands: () => CliCommand[]): CliCommand {
    return {
        name: 'help',
        aliases: ['h'],
        usage: 'help [command]',
        desc: 'List all commands or show specific command usage',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const cmdName = String(args._[0] ?? '').toLowerCase();

            if (cmdName) {
                const found = allCommands().find(c => c.name === cmdName || c.aliases.includes(cmdName));
                if (!found) return fail(`unknown command '${cmdName}'`);
                const aliasStr = found.aliases.length > 0 ? ` (aliases: ${found.aliases.join(', ')})` : '';
                return ok(`${found.usage}\n${found.desc}${aliasStr}`);
            }

            const rows: string[][] = [];
            for (const c of allCommands()) {
                rows.push([c.name, c.usage, c.desc]);
            }
            return ok(ctx.fmt.table(rows, ['cmd', 'usage', 'desc']));
        },
    };
}

// ─── log command ──────────────────────────────────────────────────────────────

interface LogAccessor {
    drainLogs(limit: number): LogEntry[];
    recentLogs(count: number): LogEntry[];
}

function formatLogEntry(e: LogEntry): string {
    const ts = new Date(e.time).toISOString().slice(11, 23);
    const lvl = e.level === 'log' ? '' : `[${e.level.toUpperCase()}] `;
    return `${ts} ${lvl}${e.msg}`;
}

function logCommand(logs: LogAccessor): CliCommand {
    return {
        name: 'log',
        aliases: ['logs'],
        usage: 'log [--n N] [--tail] [--level warn|error]',
        desc: 'Show new console logs (--tail shows recent instead of new)',
        execute(args: CliArgs): CliResult {
            const limit = typeof args['n'] === 'number' ? args['n'] : 50;
            const useTail = !!args['tail'];
            const levelFilter = typeof args['level'] === 'string' ? args['level'] : null;

            let entries = useTail ? logs.recentLogs(limit) : logs.drainLogs(limit);

            if (levelFilter) {
                entries = entries.filter(e => e.level === levelFilter);
            }

            if (entries.length === 0) return ok('no new logs');
            return ok(entries.map(formatLogEntry).join('\n'));
        },
    };
}

// ─── js eval command ──────────────────────────────────────────────────────────

/** JSON.stringify replacer that handles circular refs and caps depth. */
function safeStringify(value: unknown, maxDepth = 10): string {
    const seen = new WeakSet();
    let depth = 0;
    return JSON.stringify(
        value,
        function (_key, val: unknown) {
            if (typeof val === 'function') return '[Function]';
            if (val instanceof Map) {
                if (depth >= maxDepth) return `[Map(${val.size})]`;
                return Object.fromEntries(val);
            }
            if (val instanceof Set) return `[Set(${val.size})]`;
            if (val instanceof WeakMap || val instanceof WeakRef) return '[WeakRef]';
            if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
                if (depth >= maxDepth) return Array.isArray(val) ? `[Array(${val.length})]` : '[Object]';
                depth++;
                return val;
            }
            return val;
        },
        2
    );
}

/** Build the scope object for js eval — short names for common systems. */
function buildJsScope(ctx: CliContext): Record<string, unknown> {
    const { game } = ctx;
    const s = game.services;
    return {
        game,
        state: game.state,
        services: s,
        terrain: game.terrain,
        movement: s.movement,
        inventory: s.inventoryManager,
        construction: s.constructionSiteManager,
        tasks: s.settlerTaskSystem,
        combat: s.combatSystem,
        garrison: s.garrisonManager,
        territory: s.territoryManager,
        recruit: s.recruitSystem,
        logistics: s.logisticsDispatcher,
        demands: s.demandQueue,
        carriers: s.carrierRegistry,
        storage: s.storageFilterManager,
    };
}

function jsCommand(): CliCommand {
    const scopeNames: string[] = [];
    return {
        name: 'js',
        aliases: ['eval'],
        usage: 'js <expression>',
        desc: 'Eval JS expression (scope: game state services terrain movement inventory tasks combat ...)',
        execute(_args: CliArgs, ctx: CliContext): CliResult {
            const expr = ctx.rawArgs.trim();
            if (!expr) {
                const scope = buildJsScope(ctx);
                return ok('Available: ' + Object.keys(scope).join(', '));
            }
            try {
                const scope = buildJsScope(ctx);
                if (scopeNames.length === 0) scopeNames.push(...Object.keys(scope));
                const fn = new Function(...scopeNames, `return (${expr})`);
                const result = fn(...scopeNames.map(k => scope[k]));
                if (result === undefined) return ok('undefined');
                if (typeof result === 'string') return ok(result);
                return ok(safeStringify(result));
            } catch (err: unknown) {
                return fail(err instanceof Error ? err.message : String(err));
            }
        },
    };
}

// ─── player command ───────────────────────────────────────────────────────────

interface PlayerAccessor {
    get currentPlayer(): number;
    get isPlayerOverride(): boolean;
    setPlayer(player: number | null): void;
}

function playerCommand(cli: PlayerAccessor): CliCommand {
    return {
        name: 'player',
        aliases: ['pl'],
        usage: 'player [<N>|reset]',
        desc: 'Show or set the active player for all commands',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const arg = args._[0];

            // player reset — clear override
            if (arg === 'reset') {
                cli.setPlayer(null);
                const race = Race[ctx.game.playerRaces.get(ctx.game.currentPlayer)!];
                return ok(`player=${ctx.game.currentPlayer} (${race}) [default]`);
            }

            // player <N> — set override
            if (arg !== undefined) {
                const n = Number(arg);
                if (!Number.isInteger(n)) return fail(`player index must be an integer, got '${arg}'`);
                try {
                    cli.setPlayer(n);
                } catch (err: unknown) {
                    return fail(err instanceof Error ? err.message : String(err));
                }
                const race = Race[ctx.game.playerRaces.get(n)!];
                return ok(`player=${n} (${race}) [override]`);
            }

            // player — show current
            const p = cli.currentPlayer;
            const race = Race[ctx.game.playerRaces.get(p)!];
            const tag = cli.isPlayerOverride ? 'override' : 'default';
            return ok(`player=${p} (${race}) [${tag}]`);
        },
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create all query commands.
 * @param allCommands Callback returning every registered CliCommand (used by `help`)
 * @param logs Accessor for the CLI's console log buffer
 * @param cli Player accessor for get/set current player
 */
export function createQueryCommands(
    allCommands: () => CliCommand[],
    logs: LogAccessor,
    cli: PlayerAccessor
): CliCommand[] {
    return [
        lsCommand(),
        invCommand(),
        entityCommand(),
        mapCommand(),
        findCommand(),
        tickCommand(),
        logCommand(logs),
        jsCommand(),
        playerCommand(cli),
        helpCommand(allCommands),
    ];
}
