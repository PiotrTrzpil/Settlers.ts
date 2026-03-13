/**
 * CLI action commands — mutations that execute game commands.
 * Each factory returns a CliCommand; all deps come via CliContext.
 */

import type { CliArgs, CliCommand, CliContext, CliResult } from '../types';
import type { Command } from '@/game/commands/command-types';
import { ProductionMode } from '@/game/features/production-control';
import { StorageDirection } from '@/game/systems/inventory/storage-filter-manager';
import { ok, fail } from './helpers';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Execute a command and return ok/fail CliResult. */
function exec(ctx: CliContext, cmd: Command): CliResult {
    const result = ctx.game.execute(cmd);
    return result.success ? ok('ok') : fail(result.error!);
}

/** Parse a positional as a required integer, throw with context on failure. */
function reqInt(args: CliArgs, index: number, label: string): number {
    const raw = args._[index];
    if (raw === undefined) {
        throw new Error(`missing required argument: ${label}`);
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) {
        throw new Error(`${label} must be an integer, got '${raw}'`);
    }
    return n;
}

/** Parse a positional as an optional integer with a default. */
function optInt(args: CliArgs, index: number, defaultVal: number): number {
    const raw = args._[index];
    if (raw === undefined) {
        return defaultVal;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) {
        throw new Error(`expected integer, got '${raw}'`);
    }
    return n;
}

/** Parse a required string positional. */
function reqStr(args: CliArgs, index: number, label: string): string {
    const raw = args._[index];
    if (raw === undefined) {
        throw new Error(`missing required argument: ${label}`);
    }
    return String(raw);
}

// ─── Production mode resolution ─────────────────────────────────────────────

const PRODUCTION_MODES: Record<string, ProductionMode> = {
    even: ProductionMode.Even,
    proportional: ProductionMode.Proportional,
    manual: ProductionMode.Manual,
};

function resolveProductionMode(input: string): ProductionMode {
    const mode = PRODUCTION_MODES[input.toLowerCase()];
    if (mode === undefined) {
        throw new Error(`unknown production mode '${input}'. valid: ${Object.keys(PRODUCTION_MODES).join(', ')}`);
    }
    return mode;
}

// ─── Storage direction resolution ───────────────────────────────────────────

function resolveStorageDirection(input: string): StorageDirection | null {
    switch (input.toLowerCase()) {
        case 'import':
            return StorageDirection.Import;
        case 'export':
            return StorageDirection.Export;
        case 'null':
            return null;
        default:
            throw new Error(`unknown storage direction '${input}'. valid: import, export, null`);
    }
}

// ─── Command factories ──────────────────────────────────────────────────────

function buildCommand(): CliCommand {
    return {
        name: 'b',
        aliases: ['build'],
        usage: 'b <Type> <x> <y> [--done] [--p N]',
        desc: 'Place a building',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const typeName = reqStr(args, 0, 'BuildingType');
            const x = reqInt(args, 1, 'x');
            const y = reqInt(args, 2, 'y');
            const buildingType = ctx.resolveBuilding(typeName);
            return exec(ctx, {
                type: 'place_building',
                buildingType,
                x,
                y,
                player: ctx.player,
                completed: !!args['done'],
                spawnWorker: true,
            });
        },
    };
}

function recruitCommand(): CliCommand {
    return {
        name: 'r',
        aliases: ['recruit'],
        usage: 'r <UnitType> [count=1] [--p N]',
        desc: 'Recruit a specialist unit',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const typeName = reqStr(args, 0, 'UnitType');
            const count = optInt(args, 1, 1);
            const unitType = ctx.resolveUnit(typeName);
            const race = ctx.game.playerRaces.get(ctx.player);
            if (race === undefined) {
                throw new Error(`no race found for player ${ctx.player}`);
            }
            return exec(ctx, {
                type: 'recruit_specialist',
                unitType,
                count,
                player: ctx.player,
                race,
                nearX: 0,
                nearY: 0,
            });
        },
    };
}

function moveCommand(): CliCommand {
    return {
        name: 'mv',
        aliases: ['move'],
        usage: 'mv <entityId> <x> <y>',
        desc: 'Move a unit to a position',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const entityId = reqInt(args, 0, 'entityId');
            const targetX = reqInt(args, 1, 'x');
            const targetY = reqInt(args, 2, 'y');
            return exec(ctx, { type: 'move_unit', entityId, targetX, targetY });
        },
    };
}

function removeCommand(): CliCommand {
    return {
        name: 'rm',
        aliases: ['remove'],
        usage: 'rm <entityId>',
        desc: 'Remove an entity',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const entityId = reqInt(args, 0, 'entityId');
            return exec(ctx, { type: 'remove_entity', entityId });
        },
    };
}

function garrisonCommand(): CliCommand {
    return {
        name: 'gar',
        aliases: ['garrison'],
        usage: 'gar <buildingId> <unitId1> [unitId2...]',
        desc: 'Garrison units into a building',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            if (args._.length < 2) {
                throw new Error('usage: gar <buildingId> <unitId1> [unitId2...]');
            }
            const buildingId = reqInt(args, 0, 'buildingId');
            const unitIds = args._.slice(1).map((v: string | number, i: number) => {
                const n = Number(v);
                if (!Number.isInteger(n)) {
                    throw new Error(`unitId[${i}] must be an integer, got '${v}'`);
                }
                return n;
            });
            return exec(ctx, { type: 'garrison_units', buildingId, unitIds });
        },
    };
}

function ungarrisonCommand(): CliCommand {
    return {
        name: 'ugar',
        aliases: ['ungarrison'],
        usage: 'ugar <buildingId> <unitId>',
        desc: 'Remove a unit from garrison',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const buildingId = reqInt(args, 0, 'buildingId');
            const unitId = reqInt(args, 1, 'unitId');
            return exec(ctx, { type: 'ungarrison_unit', buildingId, unitId });
        },
    };
}

function productionCommand(): CliCommand {
    return {
        name: 'prod',
        aliases: ['production'],
        usage: 'prod <buildingId> <mode>',
        desc: 'Set building production mode (even|proportional|manual)',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const buildingId = reqInt(args, 0, 'buildingId');
            const modeStr = reqStr(args, 1, 'mode');
            const mode = resolveProductionMode(modeStr);
            return exec(ctx, { type: 'set_production_mode', buildingId, mode });
        },
    };
}

function recipeCommand(): CliCommand {
    return {
        name: 'recipe',
        aliases: [],
        usage: 'recipe <buildingId> <idx> <weight>',
        desc: 'Set recipe proportion weight',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const buildingId = reqInt(args, 0, 'buildingId');
            const recipeIndex = reqInt(args, 1, 'recipeIndex');
            const weight = reqInt(args, 2, 'weight');
            return exec(ctx, { type: 'set_recipe_proportion', buildingId, recipeIndex, weight });
        },
    };
}

function storageFilterCommand(): CliCommand {
    return {
        name: 'sf',
        aliases: ['storfilter'],
        usage: 'sf <buildingId> <material> <import|export|null>',
        desc: 'Set storage area material filter',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const buildingId = reqInt(args, 0, 'buildingId');
            const materialName = reqStr(args, 1, 'material');
            const dirStr = reqStr(args, 2, 'direction');
            const material = ctx.resolveMaterial(materialName);
            const direction = resolveStorageDirection(dirStr);
            return exec(ctx, { type: 'set_storage_filter', buildingId, material, direction });
        },
    };
}

function spawnCommand(): CliCommand {
    return {
        name: 'spawn',
        aliases: [],
        usage: 'spawn <UnitType> <x> <y> [--p N]',
        desc: 'Spawn a unit (debug)',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const typeName = reqStr(args, 0, 'UnitType');
            const x = reqInt(args, 1, 'x');
            const y = reqInt(args, 2, 'y');
            const unitType = ctx.resolveUnit(typeName);
            return exec(ctx, { type: 'spawn_unit', unitType, x, y, player: ctx.player });
        },
    };
}

function pileCommand(): CliCommand {
    return {
        name: 'pile',
        aliases: [],
        usage: 'pile <material> <amount> <x> <y>',
        desc: 'Place a material pile (debug)',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const materialName = reqStr(args, 0, 'material');
            const amount = reqInt(args, 1, 'amount');
            const x = reqInt(args, 2, 'x');
            const y = reqInt(args, 3, 'y');
            const materialType = ctx.resolveMaterial(materialName);
            return exec(ctx, { type: 'place_pile', materialType, amount, x, y });
        },
    };
}

function selectCommand(): CliCommand {
    return {
        name: 'sel',
        aliases: ['select'],
        usage: 'sel <entityId>',
        desc: 'Select an entity',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const entityId = reqInt(args, 0, 'entityId');
            return exec(ctx, { type: 'select', entityId });
        },
    };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Create all action CLI commands. */
export function createActionCommands(): CliCommand[] {
    return [
        buildCommand(),
        recruitCommand(),
        moveCommand(),
        removeCommand(),
        garrisonCommand(),
        ungarrisonCommand(),
        productionCommand(),
        recipeCommand(),
        storageFilterCommand(),
        spawnCommand(),
        pileCommand(),
        selectCommand(),
    ];
}
