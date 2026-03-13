/**
 * Shared helpers for CLI command modules.
 */

import type { CliContext, CliResult } from '../types';
import { EntityType, type Entity } from '@/game/entity';
import { BuildingType } from '@/game/buildings/building-type';
import { UnitType, UNIT_TYPE_CONFIG } from '@/game/core/unit-types';

// ─── Result constructors ─────────────────────────────────────────────────────

export function ok(output: string): CliResult {
    return { ok: true, output };
}

export function fail(output: string): CliResult {
    return { ok: false, output };
}

// ─── Entity display ──────────────────────────────────────────────────────────

export function buildingTypeName(subType: number): string {
    return BuildingType[subType as BuildingType];
}

export function unitTypeName(subType: UnitType): string {
    return UNIT_TYPE_CONFIG[subType].name;
}

export function entityTypeName(entity: Entity): string {
    if (entity.type === EntityType.Building) {
        return buildingTypeName(entity.subType as number);
    }
    if (entity.type === EntityType.Unit) {
        return unitTypeName(entity.subType as UnitType);
    }
    return EntityType[entity.type];
}

export function posText(entity: Entity): string {
    return entity.x + ',' + entity.y;
}

// ─── Table helpers ───────────────────────────────────────────────────────────

export function limitRows(rows: string[][], limit: number): { rows: string[][]; truncated: number } {
    if (limit <= 0 || rows.length <= limit) {
        return { rows, truncated: 0 };
    }
    return { rows: rows.slice(0, limit), truncated: rows.length - limit };
}

export function tableWithLimit(rows: string[][], headers: string[], limit: number, ctx: CliContext): string {
    const { rows: limited, truncated } = limitRows(rows, limit);
    let out = ctx.fmt.table(limited, headers);
    if (truncated > 0) {
        out += '\n... ' + truncated + ' more (use --n to show more)';
    }
    return out;
}
