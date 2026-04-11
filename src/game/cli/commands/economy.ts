/**
 * Economy commands — logistics, carrier, production, and diagnostics for the CLI.
 *
 * All commands delegate to the shared logistics-snapshot module for data gathering,
 * ensuring consistency with the Vue debug panel.
 */

import type { CliArgs, CliCommand, CliContext, CliResult } from '../types';
import {
    type SnapshotConfig,
    type DemandSummary,
    gatherDemands,
    gatherCarriers,
    gatherProductionBuildings,
    gatherPiles,
    gatherWorkers,
    gatherTransportJobs,
    detectBottlenecks,
    createEmptyStats,
} from '@/game/features/logistics/logistics-snapshot';
import { EntityType } from '@/game/entity';
import { BuildingType, isStorageBuilding } from '@/game/buildings/building-type';
import { EMaterialType } from '@/game/economy/material-type';
import { SlotKind } from '@/game/core/pile-kind';
import type { GameState } from '@/game/game-state';
import { ok } from './helpers';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSnapshotConfig(ctx: CliContext): SnapshotConfig {
    const svc = ctx.game.services;
    return {
        gameState: ctx.game.state,
        demandQueue: svc.demandQueue,
        carrierRegistry: svc.carrierRegistry,
        logisticsDispatcher: svc.logisticsDispatcher,
        workerStateQuery: svc.settlerTaskSystem,
        inventoryManager: svc.inventoryManager,
        unitReservation: svc.unitReservation,
        constructionSiteManager: svc.constructionSiteManager,
    };
}

function limitArg(args: CliArgs): number {
    return typeof args['n'] === 'number' ? args['n'] : 30;
}

// ─── carriers ────────────────────────────────────────────────────────────────

function carriersCommand(): CliCommand {
    return {
        name: 'carriers',
        aliases: ['cr'],
        usage: 'carriers [--p N] [--n N]',
        desc: 'Carrier status: idle/busy, carrying, transport job',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const config = buildSnapshotConfig(ctx);
            const limit = limitArg(args);
            const stats = createEmptyStats();
            const carriers = gatherCarriers(config, ctx.player, stats, { limit });

            const lines: string[] = [];
            lines.push(ctx.fmt.section('Carriers', `${stats.carrierCount} total`));
            lines.push(`idle: ${stats.idleCarriers}  busy: ${stats.busyCarriers}`);
            if (stats.unregisteredCarriers > 0) {
                lines.push(`unregistered: ${stats.unregisteredCarriers} (no hub or hubs full)`);
            }
            lines.push('');

            if (carriers.length === 0) {
                lines.push('no carriers');
                return ok(lines.join('\n'));
            }

            const rows = carriers.map(c => [
                String(c.entityId),
                `${c.x},${c.y}`,
                c.status,
                c.carryingMaterial ? `${c.carryingMaterial}x${c.carryingAmount}` : '-',
                // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
                c.jobPhase ?? '-',
                // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
                c.jobMaterial ?? '-',
                c.jobDest !== null ? String(c.jobDest) : '-',
            ]);

            lines.push(ctx.fmt.table(rows, ['id', 'pos', 'status', 'carrying', 'phase', 'job-mat', 'dest']));
            return ok(lines.join('\n'));
        },
    };
}

// ─── reqs ────────────────────────────────────────────────────────────────────

function reqsCommand(): CliCommand {
    return {
        name: 'reqs',
        aliases: ['requests'],
        usage: 'reqs [--p N] [--n N]',
        desc: 'Pending demands and active transport jobs',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const config = buildSnapshotConfig(ctx);
            const limit = limitArg(args);
            const stats = createEmptyStats();
            const { demands } = gatherDemands(config, ctx.player, stats, {
                limit,
                diagnose: true,
            });

            const lines: string[] = [];
            lines.push(ctx.fmt.section('Demands', `${stats.demandCount} pending, ${stats.activeJobCount} active jobs`));
            if (stats.stalledCount > 0) {
                lines.push(`stalled: ${stats.stalledCount}`);
            }
            lines.push('');

            if (demands.length > 0) {
                lines.push('--- Pending Demands ---');
                const rows = demands.map((r: DemandSummary) => [
                    String(r.id),
                    `${r.buildingType}#${r.buildingId}`,
                    r.material,
                    r.priority,
                    `${r.age}s`,
                    // eslint-disable-next-line no-restricted-syntax -- nullable field with display/config default
                    r.reason ?? '-',
                ]);
                lines.push(ctx.fmt.table(rows, ['id', 'building', 'material', 'priority', 'age', 'reason']));
            } else {
                lines.push('no active demands');
            }

            return ok(lines.join('\n'));
        },
    };
}

// ─── piles ───────────────────────────────────────────────────────────────────

function pilesCommand(): CliCommand {
    return {
        name: 'piles',
        aliases: [],
        usage: 'piles [--p N] [--n N] [--kind free|output|input|storage|construction]',
        desc: 'Material piles on the ground',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const config = buildSnapshotConfig(ctx);
            const limit = limitArg(args);
            const kindFilter = typeof args['kind'] === 'string' ? args['kind'] : undefined;
            const piles = gatherPiles(config, ctx.player, { limit, kindFilter });

            if (piles.length === 0) {
                return ok('no piles');
            }

            const totals = new Map<string, number>();
            let totalQty = 0;
            for (const p of piles) {
                // eslint-disable-next-line no-restricted-syntax -- accumulating map totals; 0 is the correct initial value for a new key
                totals.set(p.material, (totals.get(p.material) ?? 0) + p.quantity);
                totalQty += p.quantity;
            }

            const lines: string[] = [];
            lines.push(ctx.fmt.section('Piles', `${piles.length} stacks, ${totalQty} items`));

            const rows = piles.map(p => [
                String(p.entityId),
                p.material,
                String(p.quantity),
                p.kind,
                p.buildingId !== null ? String(p.buildingId) : '-',
                `${p.x},${p.y}`,
            ]);
            lines.push(ctx.fmt.table(rows, ['id', 'material', 'qty', 'kind', 'building', 'pos']));

            lines.push('');
            const summaryParts = [...totals.entries()].map(([mat, qty]) => `${mat}x${qty}`);
            lines.push(`totals: ${summaryParts.join(', ')}`);

            return ok(lines.join('\n'));
        },
    };
}

// ─── workers ─────────────────────────────────────────────────────────────────

function workersCommand(): CliCommand {
    return {
        name: 'workers',
        aliases: ['wk'],
        usage: 'workers [--p N] [--n N] [--state idle|working|interrupted]',
        desc: 'Worker status: state, assigned building, job',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const config = buildSnapshotConfig(ctx);
            const limit = limitArg(args);
            const stateFilter = typeof args['state'] === 'string' ? args['state'] : undefined;
            const workers = gatherWorkers(config, ctx.player, { limit, stateFilter });

            if (workers.length === 0) {
                return ok('no workers');
            }

            const byState = new Map<string, number>();
            for (const w of workers) {
                // eslint-disable-next-line no-restricted-syntax -- accumulating map totals; 0 is the correct initial value for a new key
                byState.set(w.state, (byState.get(w.state) ?? 0) + 1);
            }

            const lines: string[] = [];
            const stateParts = [...byState.entries()].map(([s, n]) => `${s.toLowerCase()}: ${n}`);
            lines.push(ctx.fmt.section('Workers', `${workers.length} total — ${stateParts.join(', ')}`));
            lines.push('');

            const rows = workers.map(w => {
                const bldg = w.assignedBuildingType ? `${w.assignedBuildingType}#${w.assignedBuilding}` : '-';
                return [String(w.entityId), w.unitType, w.state, bldg, `${w.x},${w.y}`];
            });
            lines.push(ctx.fmt.table(rows, ['id', 'type', 'state', 'building', 'pos']));

            return ok(lines.join('\n'));
        },
    };
}

// ─── jobs ────────────────────────────────────────────────────────────────────

function jobsCommand(): CliCommand {
    return {
        name: 'jobs',
        aliases: [],
        usage: 'jobs [--p N] [--n N]',
        desc: 'Active transport jobs (carrier → material → destination)',
        execute(args: CliArgs, ctx: CliContext): CliResult {
            const config = buildSnapshotConfig(ctx);
            const limit = limitArg(args);
            const jobs = gatherTransportJobs(config, ctx.player, { limit });

            if (jobs.length === 0) {
                return ok('no active transport jobs');
            }

            const lines: string[] = [];
            lines.push(ctx.fmt.section('Transport Jobs', `${jobs.length} active`));
            lines.push('');

            const rows = jobs.map(j => [
                String(j.id),
                String(j.carrierId),
                j.material,
                j.phase,
                String(j.sourceBuilding),
                String(j.destBuilding),
            ]);
            lines.push(ctx.fmt.table(rows, ['job', 'carrier', 'material', 'phase', 'source', 'dest']));

            return ok(lines.join('\n'));
        },
    };
}

// ─── diag ────────────────────────────────────────────────────────────────────

const SEVERITY_PREFIX: Record<string, string> = {
    critical: 'CRITICAL',
    warning: 'WARNING',
    info: 'OK',
};

function diagCommand(): CliCommand {
    return {
        name: 'diag',
        aliases: ['diagnose'],
        usage: 'diag [--p N]',
        desc: 'Detect economy bottlenecks and show actionable diagnostics',
        execute(_args: CliArgs, ctx: CliContext): CliResult {
            const config = buildSnapshotConfig(ctx);
            const diags = detectBottlenecks(config, ctx.player);

            const lines: string[] = [];
            lines.push(ctx.fmt.section('Economy Diagnostics'));
            lines.push('');

            for (const d of diags) {
                const prefix = SEVERITY_PREFIX[d.severity] ?? d.severity.toUpperCase();
                lines.push(`[${prefix}] ${d.message}`);
            }

            return ok(lines.join('\n'));
        },
    };
}

// ─── enhanced econ ───────────────────────────────────────────────────────────

function econDetailCommand(): CliCommand {
    return {
        name: 'econ',
        aliases: ['economy'],
        usage: 'econ [--p N]',
        desc: 'Economy summary: buildings, materials, production, carriers, diagnostics',
        execute(_args: CliArgs, ctx: CliContext): CliResult {
            const config = buildSnapshotConfig(ctx);
            const { player } = ctx;
            const lines: string[] = [];

            formatBuildingCounts(ctx.game.state, player, ctx, lines);
            lines.push('');
            formatStorageMaterials(ctx.game.state, player, ctx, lines);
            formatProductionStatus(config, player, ctx, lines);
            formatCarrierAndPileSummary(config, player, lines);
            formatBottleneckWarnings(config, player, lines);

            return ok(lines.join('\n'));
        },
    };
}

function formatBuildingCounts(state: GameState, player: number, ctx: CliContext, lines: string[]): void {
    const counts = new Map<BuildingType, number>();
    for (const e of state.entityIndex.query(EntityType.Building, player)) {
        // eslint-disable-next-line no-restricted-syntax -- accumulating map totals; 0 is the correct initial value for a new key
        counts.set(e.subType as BuildingType, (counts.get(e.subType as BuildingType) ?? 0) + 1);
    }
    if (counts.size > 0) {
        lines.push(ctx.fmt.section('Buildings'));
        const rows = [...counts.entries()].map(([bt, n]) => [String(bt) || `#${bt}`, String(n)]);
        lines.push(ctx.fmt.table(rows, ['type', 'count']));
    } else {
        lines.push('no buildings');
    }
}

function isOutputSlotWithMaterial(slot: {
    kind: SlotKind;
    materialType: EMaterialType;
    currentAmount: number;
}): boolean {
    if (slot.kind !== SlotKind.Output && slot.kind !== SlotKind.Storage) {
        return false;
    }
    return slot.materialType !== EMaterialType.NO_MATERIAL && slot.currentAmount > 0;
}

function formatStorageMaterials(state: GameState, player: number, ctx: CliContext, lines: string[]): void {
    const totals = new Map<EMaterialType, number>();
    const invManager = ctx.game.services.inventoryManager;
    for (const e of state.entityIndex.query(EntityType.Building, player)) {
        if (!isStorageBuilding(e.subType as BuildingType)) {
            continue;
        }
        if (!invManager.hasSlots(e.id)) {
            continue;
        }
        for (const slot of invManager.getSlots(e.id)) {
            if (!isOutputSlotWithMaterial(slot)) {
                continue;
            }
            // eslint-disable-next-line no-restricted-syntax -- accumulating map totals; 0 is the correct initial value for a new key
            totals.set(slot.materialType, (totals.get(slot.materialType) ?? 0) + slot.currentAmount);
        }
    }
    if (totals.size > 0) {
        lines.push(ctx.fmt.section('Materials (storage)'));
        const rows = [...totals.entries()].map(([mt, n]) => [mt, String(n)]);
        lines.push(ctx.fmt.table(rows, ['material', 'total']));
    } else {
        lines.push('no materials in storage');
    }
}

function formatProductionStatus(config: SnapshotConfig, player: number, ctx: CliContext, lines: string[]): void {
    const buildings = gatherProductionBuildings(config, player);
    if (buildings.length === 0) {
        return;
    }

    lines.push('');
    lines.push(ctx.fmt.section('Production'));
    const rows = buildings.map(b => {
        const inputStr =
            b.inputs.length > 0 ? b.inputs.map(s => `${s.material} ${s.current}/${s.max}`).join(', ') : '-';
        const outputStr =
            b.outputs.length > 0 ? b.outputs.map(s => `${s.material} ${s.current}/${s.max}`).join(', ') : '-';
        let status = 'ok';
        if (b.isConstructing) {
            status = 'building';
        } else if (b.outputFull) {
            status = 'FULL';
        }
        return [`${b.type}#${b.entityId}`, inputStr, outputStr, status];
    });
    lines.push(ctx.fmt.table(rows, ['building', 'input', 'output', 'status']));
}

function formatCarrierAndPileSummary(config: SnapshotConfig, player: number, lines: string[]): void {
    const stats = createEmptyStats();
    gatherCarriers(config, player, stats);
    const piles = gatherPiles(config, player);

    lines.push('');
    if (piles.length > 0) {
        const pileTotals = new Map<string, number>();
        for (const p of piles) {
            // eslint-disable-next-line no-restricted-syntax -- accumulating map totals; 0 is the correct initial value for a new key
            pileTotals.set(p.material, (pileTotals.get(p.material) ?? 0) + p.quantity);
        }
        const parts = [...pileTotals.entries()].map(([m, q]) => `${m}x${q}`);
        lines.push(`ground piles: ${piles.length} stacks (${parts.join(', ')})`);
    }
    lines.push(`carriers: ${stats.idleCarriers} idle / ${stats.busyCarriers} busy (${stats.carrierCount} total)`);
}

function formatBottleneckWarnings(config: SnapshotConfig, player: number, lines: string[]): void {
    const diags = detectBottlenecks(config, player);
    const warnings = diags.filter(d => d.severity !== 'info');
    if (warnings.length === 0) {
        return;
    }

    lines.push('');
    for (const d of warnings) {
        const prefix = SEVERITY_PREFIX[d.severity] ?? d.severity.toUpperCase();
        lines.push(`[${prefix}] ${d.message}`);
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create all economy/logistics CLI commands.
 */
export function createEconomyCommands(): CliCommand[] {
    return [
        carriersCommand(),
        reqsCommand(),
        pilesCommand(),
        workersCommand(),
        jobsCommand(),
        diagCommand(),
        econDetailCommand(),
    ];
}
