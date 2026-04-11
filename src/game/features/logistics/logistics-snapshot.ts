/**
 * Logistics Snapshot — pure data-gathering functions for economy/logistics diagnostics.
 *
 * Shared between the Vue debug panel (useLogisticsDebug composable) and the game CLI.
 * No Vue or browser dependencies — works in any JS environment.
 */

import type { GameState } from '../../game-state';
import type { DemandQueue, DemandEntry } from './demand-queue';
import type { CarrierRegistry } from '../../systems/carrier-registry';
import type { LogisticsDispatcher } from './logistics-dispatcher';
import type { WorkerStateQuery } from '../settler-tasks';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import { DemandPriority } from './demand-queue';
import { EMaterialType } from '../../economy/material-type';
import { EntityType } from '../../entity';
import { UnitType, UNIT_TYPE_CONFIG, isUnitTypeMilitary } from '../../core/unit-types';
import { SlotKind } from '../../core/pile-kind';
import { query } from '../../ecs';
import {
    diagnoseUnfulfilledRequest,
    UNFULFILLED_REASON_LABELS,
    type DiagnosticConfig,
} from './fulfillment-diagnostics';

// ─── Config ──────────────────────────────────────────────────────────────────

/** All service references needed by snapshot functions. */
export interface SnapshotConfig {
    gameState: GameState;
    demandQueue: DemandQueue;
    carrierRegistry: CarrierRegistry;
    logisticsDispatcher: LogisticsDispatcher;
    workerStateQuery: WorkerStateQuery;
    inventoryManager: BuildingInventoryManager;
    unitReservation: UnitReservationRegistry;
    constructionSiteManager: ConstructionSiteManager;
}

// ─── Logistics interfaces ────────────────────────────────────────────────────

export interface LogisticsStats {
    demandCount: number;
    activeJobCount: number;
    stalledCount: number;
    carrierCount: number;
    unregisteredCarriers: number;
    idleCarriers: number;
    busyCarriers: number;
}

export interface DemandSummary {
    id: number;
    buildingId: number;
    buildingType: string;
    material: string;
    materialType: number | string;
    priority: 'High' | 'Normal' | 'Low';
    age: number;
    reason: string | null;
}

export interface CarrierSummary {
    entityId: number;
    x: number;
    y: number;
    status: 'Busy' | 'Idle';
    carryingMaterial: string | null;
    carryingAmount: number;
    hasJob: boolean;
    /** Active job ID from settler task system (null if idle) */
    jobType: string | null;
    /** Material being transported (null if no transport job) */
    jobMaterial: string | null;
    /** Transport phase: reserved, picked-up, etc. (null if no transport job) */
    jobPhase: string | null;
    /** Destination building (null if no transport job) */
    jobDest: number | null;
}

export interface LogisticsDebugState {
    stats: LogisticsStats;
    demands: DemandSummary[];
    carriers: CarrierSummary[];
}

// ─── Economy-wide interfaces ─────────────────────────────────────────────────

export interface SlotSummary {
    material: string;
    current: number;
    max: number;
}

export interface ProductionBuildingSummary {
    entityId: number;
    type: string;
    inputs: SlotSummary[];
    outputs: SlotSummary[];
    outputFull: boolean;
    workerCount: number;
    isConstructing: boolean;
}

export interface PileSummary {
    entityId: number;
    material: string;
    quantity: number;
    kind: string;
    buildingId: number | null;
    x: number;
    y: number;
}

export interface WorkerSummary {
    entityId: number;
    unitType: string;
    state: string;
    assignedBuilding: number | null;
    assignedBuildingType: string | null;
    jobId: string | null;
    x: number;
    y: number;
}

export interface TransportJobSummary {
    id: number;
    carrierId: number;
    material: string;
    phase: string;
    sourceBuilding: number;
    destBuilding: number;
}

export { type BottleneckDiag, detectBottlenecks } from './bottleneck-detection';

// ─── Constants ───────────────────────────────────────────────────────────────

const STALL_THRESHOLD_SEC = 30;

const PRIORITY_NAMES: Record<DemandPriority, 'High' | 'Normal' | 'Low'> = {
    [DemandPriority.High]: 'High',
    [DemandPriority.Normal]: 'Normal',
    [DemandPriority.Low]: 'Low',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatMaterial(materialType: EMaterialType): string {
    return materialType;
}

function buildingTypeNameSafe(subType: number | string): string {
    return String(subType) || `#${subType}`;
}

function unitTypeNameSafe(subType: UnitType): string {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- subType is arbitrary value, not necessarily a valid UnitType
    return UNIT_TYPE_CONFIG[subType]?.name ?? `#${subType}`;
}

export function createEmptyStats(): LogisticsStats {
    return {
        demandCount: 0,
        activeJobCount: 0,
        stalledCount: 0,
        carrierCount: 0,
        unregisteredCarriers: 0,
        idleCarriers: 0,
        busyCarriers: 0,
    };
}

export function createEmptyState(): LogisticsDebugState {
    return {
        stats: createEmptyStats(),
        demands: [],
        carriers: [],
    };
}

function applyLimit<T>(arr: T[], limit: number): T[] {
    return limit > 0 ? arr.slice(0, limit) : arr;
}

function buildDiagConfig(config: SnapshotConfig): DiagnosticConfig {
    return {
        gameState: config.gameState,
        inventoryManager: config.inventoryManager,
        carrierRegistry: config.carrierRegistry,
        jobStore: config.logisticsDispatcher.jobStore,
        getActiveJobId: config.workerStateQuery.getActiveJobId.bind(config.workerStateQuery),
        isReserved: config.unitReservation.isReserved.bind(config.unitReservation),
    };
}

function isNonCarrierWorker(subType: UnitType): boolean {
    return subType !== UnitType.Carrier && !isUnitTypeMilitary(subType);
}

const PRIORITY_ORDER = { High: 0, Normal: 1, Low: 2 } as const;

// ─── Core logistics snapshot functions ───────────────────────────────────────

/**
 * Gather and summarize all demands from the demand queue for a player.
 * Optionally runs fulfillment diagnostics on demands.
 */
export function gatherDemands(
    config: SnapshotConfig,
    player: number,
    stats: LogisticsStats,
    options?: { limit?: number; diagnose?: boolean }
): { demands: DemandSummary[]; rawDemands: DemandEntry[] } {
    const { demandQueue, gameState } = config;
    const now = demandQueue.getGameTime();
    // eslint-disable-next-line no-restricted-syntax -- limit is an optional config field; absent means no limit (0)
    const limit = options?.limit ?? 0;

    const summaries: DemandSummary[] = [];
    const rawDemands: DemandEntry[] = [];

    for (const demand of demandQueue.getAllDemands()) {
        const building = gameState.getEntityOrThrow(
            demand.buildingId,
            'demand destination building in logistics snapshot'
        );
        if (building.player !== player) {
            continue;
        }
        summaries.push({
            id: demand.id,
            buildingId: demand.buildingId,
            buildingType: buildingTypeNameSafe(building.subType),
            material: formatMaterial(demand.materialType),
            materialType: demand.materialType,
            priority: PRIORITY_NAMES[demand.priority],
            age: Math.max(0, Math.floor(now - demand.timestamp)),
            reason: null,
        });
        rawDemands.push(demand);
        stats.demandCount++;
    }

    const indices = summaries.map((_, i) => i);
    indices.sort((a, b) => {
        const pd = PRIORITY_ORDER[summaries[a]!.priority] - PRIORITY_ORDER[summaries[b]!.priority];
        return pd !== 0 ? pd : summaries[b]!.age - summaries[a]!.age;
    });
    const sortedSummaries = indices.map(i => summaries[i]!);
    const sortedRaw = indices.map(i => rawDemands[i]!);

    if (options?.diagnose !== false) {
        const diagConfig = buildDiagConfig(config);
        const diagLimit = limit > 0 ? Math.min(sortedRaw.length, limit) : sortedRaw.length;
        for (let i = 0; i < diagLimit; i++) {
            sortedSummaries[i]!.reason =
                UNFULFILLED_REASON_LABELS[diagnoseUnfulfilledRequest(sortedRaw[i]!, diagConfig)];
        }
    }

    return {
        demands: applyLimit(sortedSummaries, limit),
        rawDemands: applyLimit(sortedRaw, limit),
    };
}

function buildCarrierSummary(
    id: number,
    entity: { x: number; y: number; carrying?: { material: EMaterialType; amount: number } },
    workerStateQuery: WorkerStateQuery,
    logisticsDispatcher: LogisticsDispatcher
): CarrierSummary {
    const carrying = entity.carrying;
    const activeJobId = workerStateQuery.getActiveJobId(id);
    const job = logisticsDispatcher.jobStore.jobs.raw.get(id);

    return {
        entityId: id,
        x: entity.x,
        y: entity.y,
        status: activeJobId !== null ? 'Busy' : 'Idle',
        carryingMaterial: carrying ? formatMaterial(carrying.material) : null,
        carryingAmount: carrying ? carrying.amount : 0,
        hasJob: activeJobId !== null,
        jobType: activeJobId,
        jobMaterial: job ? formatMaterial(job.material) : null,
        jobPhase: job ? job.phase : null,
        jobDest: job ? job.destBuilding : null,
    };
}

/**
 * Gather carrier status for a player.
 * Enriches with active transport job info when available.
 */
export function gatherCarriers(
    config: SnapshotConfig,
    player: number,
    stats: LogisticsStats,
    options?: { limit?: number }
): CarrierSummary[] {
    const { gameState, carrierRegistry, logisticsDispatcher, workerStateQuery } = config;
    const carriers: CarrierSummary[] = [];

    for (const [id, , entity] of query(carrierRegistry.store, gameState.store)) {
        if (entity.player !== player) {
            continue;
        }
        const summary = buildCarrierSummary(id, entity, workerStateQuery, logisticsDispatcher);
        carriers.push(summary);
        stats.carrierCount++;
        if (summary.hasJob) {
            stats.busyCarriers++;
        } else {
            stats.idleCarriers++;
        }
    }

    for (const entity of gameState.entityIndex.query(EntityType.Unit, player)) {
        if (entity.subType === UnitType.Carrier && !carrierRegistry.has(entity.id)) {
            stats.unregisteredCarriers++;
        }
    }

    carriers.sort((a, b) => a.entityId - b.entityId);
    // eslint-disable-next-line no-restricted-syntax -- limit is an optional config field; absent means no limit (0)
    return applyLimit(carriers, options?.limit ?? 0);
}

/**
 * Full logistics snapshot — convenience wrapper used by Vue composable.
 */
export function gatherLogisticsSnapshot(
    config: SnapshotConfig,
    player: number,
    options?: { limit?: number }
): LogisticsDebugState {
    // eslint-disable-next-line no-restricted-syntax -- optional config/prop with sensible default
    const limit = options?.limit ?? 15;
    const stats = createEmptyStats();
    const { demands } = gatherDemands(config, player, stats, { limit, diagnose: true });
    const carriers = gatherCarriers(config, player, stats, { limit });

    // Count active jobs and stalled jobs from job store
    for (const [carrierId, job] of config.logisticsDispatcher.jobStore.jobs.raw) {
        const carrier = config.gameState.getEntityOrThrow(carrierId, 'carrier in active job store');
        if (carrier.player !== player) {
            continue;
        }
        stats.activeJobCount++;
        if (config.demandQueue.getGameTime() - job.createdAt > STALL_THRESHOLD_SEC) {
            stats.stalledCount++;
        }
    }

    return { stats, demands, carriers };
}

// ─── Economy-wide snapshot functions ─────────────────────────────────────────

/**
 * Gather production building status — input/output slot fill levels.
 */
export function gatherProductionBuildings(
    config: SnapshotConfig,
    player: number,
    options?: { limit?: number }
): ProductionBuildingSummary[] {
    const { gameState, inventoryManager, workerStateQuery, constructionSiteManager } = config;
    const result: ProductionBuildingSummary[] = [];

    for (const entity of gameState.entityIndex.query(EntityType.Building, player)) {
        if (!inventoryManager.hasSlots(entity.id)) {
            continue;
        }
        const allSlots = inventoryManager.getSlots(entity.id);

        const inputs = collectSlots(allSlots.filter(s => s.kind === SlotKind.Input));
        const outputs = collectSlots(allSlots.filter(s => s.kind === SlotKind.Output || s.kind === SlotKind.Storage));
        if (inputs.length === 0 && outputs.length === 0) {
            continue;
        }

        result.push({
            entityId: entity.id,
            type: buildingTypeNameSafe(entity.subType),
            inputs,
            outputs,
            outputFull: outputs.length > 0 && outputs.every(s => s.current >= s.max),
            workerCount: workerStateQuery.getWorkersForBuilding(entity.id).size,
            isConstructing: constructionSiteManager.hasSite(entity.id),
        });
    }

    result.sort((a, b) => a.entityId - b.entityId);
    // eslint-disable-next-line no-restricted-syntax -- limit is an optional config field; absent means no limit (0)
    return applyLimit(result, options?.limit ?? 0);
}

function collectSlots(
    slots: readonly { materialType: EMaterialType; currentAmount: number; maxCapacity: number }[]
): SlotSummary[] {
    const result: SlotSummary[] = [];
    for (const slot of slots) {
        if (slot.materialType === EMaterialType.NO_MATERIAL) {
            continue;
        }
        result.push({
            material: formatMaterial(slot.materialType),
            current: slot.currentAmount,
            max: slot.maxCapacity,
        });
    }
    return result;
}

/**
 * Gather material piles on the ground for a player.
 */
export function gatherPiles(
    config: SnapshotConfig,
    player: number,
    options?: { limit?: number; kindFilter?: string }
): PileSummary[] {
    const { gameState, inventoryManager } = config;
    const kindFilter = options?.kindFilter;
    const result: PileSummary[] = [];

    for (const entity of gameState.entityIndex.query(EntityType.StackedPile, player)) {
        const slot = inventoryManager.getSlotByEntityId(entity.id);
        if (!slot || slot.currentAmount === 0) {
            continue;
        }

        const pileKind = inventoryManager.getPileKind(entity.id);
        const kind = pileKind.kind;
        if (kindFilter && kind !== kindFilter) {
            continue;
        }

        result.push({
            entityId: entity.id,
            material: formatMaterial(entity.subType as EMaterialType),
            quantity: slot.currentAmount,
            kind,
            buildingId: pileKind.kind !== SlotKind.Free ? pileKind.buildingId : null,
            x: entity.x,
            y: entity.y,
        });
    }

    result.sort((a, b) => a.entityId - b.entityId);
    // eslint-disable-next-line no-restricted-syntax -- limit is an optional config field; absent means no limit (0)
    return applyLimit(result, options?.limit ?? 0);
}

/**
 * Gather non-carrier worker status for a player.
 */
export function gatherWorkers(
    config: SnapshotConfig,
    player: number,
    options?: { limit?: number; stateFilter?: string }
): WorkerSummary[] {
    const { gameState, workerStateQuery } = config;
    const stateFilter = options?.stateFilter?.toUpperCase();
    const result: WorkerSummary[] = [];

    for (const entity of gameState.entityIndex.query(EntityType.Unit, player)) {
        if (!isNonCarrierWorker(entity.subType as UnitType)) {
            continue;
        }
        const workerSummary = buildWorkerSummary(
            entity.id,
            entity as { subType: UnitType; x: number; y: number },
            workerStateQuery,
            gameState,
            stateFilter
        );
        if (workerSummary) {
            result.push(workerSummary);
        }
    }

    result.sort((a, b) => a.entityId - b.entityId);
    // eslint-disable-next-line no-restricted-syntax -- limit is an optional config field; absent means no limit (0)
    return applyLimit(result, options?.limit ?? 0);
}

function buildWorkerSummary(
    entityId: number,
    entity: { subType: UnitType; x: number; y: number },
    workerStateQuery: WorkerStateQuery,
    gameState: GameState,
    stateFilter: string | undefined
): WorkerSummary | null {
    const state = workerStateQuery.getSettlerState(entityId);
    if (!state) {
        return null;
    }
    if (stateFilter && state !== stateFilter) {
        return null;
    }

    const assignedBuilding = workerStateQuery.getAssignedBuilding(entityId);
    let assignedBuildingType: string | null = null;
    if (assignedBuilding !== null) {
        const bldg = gameState.getEntityOrThrow(assignedBuilding, 'worker assigned building in logistics snapshot');
        assignedBuildingType = buildingTypeNameSafe(bldg.subType);
    }

    return {
        entityId,
        unitType: unitTypeNameSafe(entity.subType),
        state,
        assignedBuilding,
        assignedBuildingType,
        jobId: workerStateQuery.getActiveJobId(entityId),
        x: entity.x,
        y: entity.y,
    };
}

/**
 * Gather active transport jobs.
 */
export function gatherTransportJobs(
    config: SnapshotConfig,
    player: number,
    options?: { limit?: number }
): TransportJobSummary[] {
    const { gameState, logisticsDispatcher } = config;
    const result: TransportJobSummary[] = [];

    for (const [carrierId, job] of logisticsDispatcher.jobStore.jobs.raw) {
        const carrier = gameState.getEntityOrThrow(carrierId, 'carrier in transport job store');
        if (carrier.player !== player) {
            continue;
        }
        result.push({
            id: job.id,
            carrierId,
            material: formatMaterial(job.material),
            phase: job.phase,
            sourceBuilding: job.sourceBuilding,
            destBuilding: job.destBuilding,
        });
    }

    result.sort((a, b) => a.id - b.id);
    // eslint-disable-next-line no-restricted-syntax -- limit is an optional config field; absent means no limit (0)
    return applyLimit(result, options?.limit ?? 0);
}
