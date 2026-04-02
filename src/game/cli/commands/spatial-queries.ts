/**
 * Spatial query CLI commands — find and at.
 *
 * Extracted from queries.ts to stay under file size limits.
 */

import type { CliArgs, CliCommand, CliContext, CliResult } from '../types';
import { EntityType, tileKey, Tile } from '@/game/entity';
import type { GameState } from '@/game/game-state';
import { isPassable } from '@/game/terrain';
import { getGroundTypeName } from '@/resources/map/s4-types';
import { ok, fail, entityTypeName, posText, tableWithLimit } from './helpers';

/** Try resolving as BuildingType, then UnitType. Returns null on failure. */
function resolveEntitySubType(
    name: string,
    ctx: CliContext
): { entityType: EntityType; subType: number | string } | null {
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

/** Parse --near X,Y argument into coordinates. */
function parseNearArg(args: CliArgs): Tile | null {
    const nearArg = args['near'];
    if (typeof nearArg !== 'string') {
        return null;
    }
    const parts = nearArg.split(',');
    if (parts.length !== 2) {
        return null;
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
    }
    return { x, y };
}

// ─── find command ─────────────────────────────────────────────────────────────

export function findCommand(): CliCommand {
    return {
        name: 'find',
        aliases: [],
        usage: 'find <BuildingType|UnitType> [--p N] [--n N] [--near X,Y] [--radius R]',
        desc: 'Find entities of a given type. --near X,Y filters by proximity (default radius 10)',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            // eslint-disable-next-line no-restricted-syntax -- CLI positional arg is optional; '' is the correct default when no argument provided
            const name = String(args._[0] ?? '');
            if (!name) {
                return fail('usage: find <Type> [--near X,Y] [--radius R] [--p N] [--n N]');
            }
            const limit = typeof args['n'] === 'number' ? args['n'] : 30;

            const resolved = resolveEntitySubType(name, ctx);
            if (!resolved) {
                return fail("'" + name + "' is not a valid BuildingType or UnitType");
            }

            const near = parseNearArg(args);
            const radius = typeof args['radius'] === 'number' ? args['radius'] : 10;

            const rows: string[][] = [];
            for (const e of ctx.game.state.entityIndex.ofTypeAndPlayer(resolved.entityType, ctx.player)) {
                if (e.subType !== resolved.subType) {
                    continue;
                }
                if (near) {
                    const dx = e.x - near.x;
                    const dy = e.y - near.y;
                    if (dx * dx + dy * dy > radius * radius) {
                        continue;
                    }
                }
                rows.push([String(e.id), posText(e)]);
            }

            if (rows.length === 0) {
                const msg = near
                    ? 'no ' + name + ' found within radius ' + radius + ' of ' + near.x + ',' + near.y
                    : 'no ' + name + ' found';
                return ok(msg);
            }
            return ok(tableWithLimit(rows, ['id', 'pos'], limit, ctx));
        },
    };
}

// ─── at command ───────────────────────────────────────────────────────────────

function formatControllerInfo(state: GameState, entityId: number): string {
    const ctrl = state.movement.getController(entityId);
    if (!ctrl) {
        return '';
    }
    const goalStr = ctrl.goal ? ctrl.goal.x + ',' + ctrl.goal.y : 'none';
    return ' state=' + ctrl.state + ' goal=' + goalStr;
}

function describeTileInfo(
    x: number,
    y: number,
    state: GameState,
    terrain: { getType(x: number, y: number): number }
): string[] {
    const lines: string[] = [];
    const key = tileKey(x, y);
    const gt = terrain.getType(x, y);
    const passable = isPassable(gt);
    const inOccupancy = state.buildingOccupancy.has(key);
    const inFootprint = state.buildingFootprint.has(key);
    lines.push(
        'tile (' +
            x +
            ',' +
            y +
            '): ' +
            getGroundTypeName(gt) +
            ' passable=' +
            passable +
            ' buildingOccupancy=' +
            inOccupancy +
            ' buildingFootprint=' +
            inFootprint
    );

    const groundEntity = state.getGroundEntityAt(x, y);
    if (groundEntity) {
        lines.push(
            'ground: ' + entityTypeName(groundEntity) + ' id=' + groundEntity.id + ' at ' + posText(groundEntity)
        );
    }

    const unitEntity = state.getUnitAt(x, y);
    if (unitEntity) {
        lines.push(
            'unit: ' + entityTypeName(unitEntity) + ' id=' + unitEntity.id + formatControllerInfo(state, unitEntity.id)
        );
    }
    return lines;
}

function describeNearbyEntities(x: number, y: number, searchRadius: number, state: GameState): string[] {
    const lines: string[] = [];
    const nearby = state.getEntitiesInRadius(x, y, searchRadius);
    const nearbyUnits = nearby.filter(e => e.type === EntityType.Unit && !(e.x === x && e.y === y));
    const nearbyBuildings = nearby.filter(e => e.type === EntityType.Building);

    if (nearbyBuildings.length > 0) {
        lines.push('\nnearby buildings (r=' + searchRadius + '):');
        for (const b of nearbyBuildings.slice(0, 10)) {
            lines.push('  ' + entityTypeName(b) + ' id=' + b.id + ' at ' + posText(b));
        }
    }

    if (nearbyUnits.length > 0) {
        lines.push('\nnearby units (r=' + searchRadius + '):');
        for (const u of nearbyUnits.slice(0, 10)) {
            const ctrl = state.movement.getController(u.id);
            const stateStr = ctrl ? ' ' + ctrl.state : '';
            const hiddenStr = u.hidden ? ' hidden' : '';
            lines.push('  ' + entityTypeName(u) + ' id=' + u.id + ' at ' + posText(u) + stateStr + hiddenStr);
        }
    }
    return lines;
}

export function atCommand(): CliCommand {
    return {
        name: 'at',
        aliases: [],
        usage: 'at <x> <y> [--radius R]',
        desc: 'Show tile info and entities at/near a position',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const x = Number(args._[0]);
            const y = Number(args._[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return fail('usage: at <x> <y> [--radius R]');
            }
            const radius = typeof args['radius'] === 'number' ? args['radius'] : 0;
            const { state, terrain } = ctx.game;

            const lines = describeTileInfo(x, y, state, terrain);
            const searchRadius = Math.max(radius, 2);
            lines.push(...describeNearbyEntities(x, y, searchRadius, state));

            return ok(lines.join('\n'));
        },
    };
}
