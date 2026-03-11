/**
 * Logistics Snapshot — pure data-gathering functions for economy/logistics diagnostics.
 *
 * Shared between the Vue debug panel (useLogisticsDebug composable) and the game CLI.
 * No Vue or browser dependencies — works in any JS environment.
 */

import type { GameState } from '../../game-state';
import type { RequestManager } from './request-manager';
import type { CarrierRegistry } from '../../systems/carrier-registry';
import type { LogisticsDispatcher } from './logistics-dispatcher';
import type { SettlerTaskSystem } from '../settler-tasks/settler-task-system';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { UnitReservationRegistry } from '../../systems/unit-reservation';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import type { ResourceRequest } from './resource-request';
import { RequestPriority, RequestStatus } from './resource-request';
import { EMaterialType } from '../../economy/material-type';
import { EntityType } from '../../entity';
import { UnitType, UNIT_TYPE_CONFIG, isUnitTypeMilitary } from '../../core/unit-types';
import { BuildingType } from '../../buildings/building-type';
import { SlotKind, type PileKind } from '../../core/pile-kind';
import { SettlerState } from '../settler-tasks/types';
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
    requestManager: RequestManager;
    carrierRegistry: CarrierRegistry;
    logisticsDispatcher: LogisticsDispatcher;
    settlerTaskSystem: SettlerTaskSystem;
    inventoryManager: BuildingInventoryManager;
    unitReservation: UnitReservationRegistry;
    constructionSiteManager: ConstructionSiteManager;
}

// ─── Logistics interfaces (extracted from useLogisticsDebug) ─────────────────

export interface LogisticsStats {
    pendingCount: number;
    inProgressCount: number;
    stalledCount: number;
    carrierCount: number;
    unregisteredCarriers: number;
    idleCarriers: number;
    busyCarriers: number;
    reservationCount: number;
}

export interface RequestSummary {
    id: number;
    buildingId: number;
    buildingType: string;
    material: string;
    materialType: number;
    priority: 'High' | 'Normal' | 'Low';
    age: number;
    inProgress: boolean;
    carrierId: number | null;
    sourceBuildingId: number | null;
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

export interface ReservationSummary {
    buildingId: number;
    material: string;
    amount: number;
    requestId: number;
}

export interface LogisticsDebugState {
    stats: LogisticsStats;
    pendingRequests: RequestSummary[];
    inProgressRequests: RequestSummary[];
    carriers: CarrierSummary[];
    reservations: ReservationSummary[];
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

export interface BottleneckDiag {
    severity: 'critical' | 'warning' | 'info';
    message: string;
    relatedEntities: number[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STALL_THRESHOLD_SEC = 30;

const PRIORITY_NAMES: Record<RequestPriority, 'High' | 'Normal' | 'Low'> = {
    [RequestPriority.High]: 'High',
    [RequestPriority.Normal]: 'Normal',
    [RequestPriority.Low]: 'Low',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatMaterial(materialType: number): string {
    return EMaterialType[materialType] || `#${materialType}`;
}

function buildingTypeNameSafe(subType: number): string {
    return BuildingType[subType as BuildingType] || `#${subType}`;
}

function unitTypeNameSafe(subType: number): string {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- subType is arbitrary number, not necessarily a valid UnitType
    return UNIT_TYPE_CONFIG[subType as UnitType]?.name ?? `#${subType}`;
}

function pileKindName(kind: PileKind): string {
    return kind.kind;
}

function pileOwnerBuilding(kind: PileKind): number | null {
    return kind.kind !== SlotKind.Free ? kind.buildingId : null;
}

export function createEmptyStats(): LogisticsStats {
    return {
        pendingCount: 0,
        inProgressCount: 0,
        stalledCount: 0,
        carrierCount: 0,
        unregisteredCarriers: 0,
        idleCarriers: 0,
        busyCarriers: 0,
        reservationCount: 0,
    };
}

export function createEmptyState(): LogisticsDebugState {
    return {
        stats: createEmptyStats(),
        pendingRequests: [],
        inProgressRequests: [],
        carriers: [],
        reservations: [],
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
        reservationManager: config.logisticsDispatcher.getReservationManager(),
        getActiveJobId: config.settlerTaskSystem.getActiveJobId.bind(config.settlerTaskSystem),
        isReserved: config.unitReservation.isReserved.bind(config.unitReservation),
    };
}

function entityLabel(gameState: GameState, id: number, nameOf: (sub: number) => string): string {
    const e = gameState.getEntity(id);
    return e ? `${nameOf(e.subType)}#${id}` : `#${id}`;
}

function isNonCarrierWorker(subType: number): boolean {
    return subType !== UnitType.Carrier && !isUnitTypeMilitary(subType as UnitType);
}

// ─── Request sorting ─────────────────────────────────────────────────────────

const PRIORITY_ORDER = { High: 0, Normal: 1, Low: 2 } as const;

function sortPendingIndices(pending: RequestSummary[]): number[] {
    const indices = pending.map((_, i) => i);
    indices.sort((a, b) => {
        const pDiff = PRIORITY_ORDER[pending[a]!.priority] - PRIORITY_ORDER[pending[b]!.priority];
        return pDiff !== 0 ? pDiff : pending[b]!.age - pending[a]!.age;
    });
    return indices;
}

// ─── Core logistics snapshot functions ───────────────────────────────────────

export interface GatherRequestsResult {
    pending: RequestSummary[];
    rawPending: ResourceRequest[];
    inProgress: RequestSummary[];
}

function categorizeRequest(
    request: ResourceRequest,
    gameState: GameState,
    player: number,
    now: number,
    pending: RequestSummary[],
    rawPending: ResourceRequest[],
    inProgress: RequestSummary[],
    stats: LogisticsStats
): void {
    const building = gameState.getEntity(request.buildingId);
    if (!building || building.player !== player) return;

    const summary: RequestSummary = {
        id: request.id,
        buildingId: request.buildingId,
        buildingType: buildingTypeNameSafe(building.subType),
        material: formatMaterial(request.materialType),
        materialType: request.materialType,
        priority: PRIORITY_NAMES[request.priority],
        age: Math.max(0, Math.floor(now - request.timestamp)),
        inProgress: request.assignedCarrier !== null,
        carrierId: request.assignedCarrier,
        sourceBuildingId: request.sourceBuilding,
        reason: null,
    };

    if (request.assignedCarrier !== null) {
        inProgress.push(summary);
        stats.inProgressCount++;
        if (request.assignedAt !== null && now - request.assignedAt > STALL_THRESHOLD_SEC) {
            stats.stalledCount++;
        }
    } else if (request.status === RequestStatus.Pending) {
        pending.push(summary);
        rawPending.push(request);
        stats.pendingCount++;
    }
}

/**
 * Gather and categorize all resource requests for a player.
 * Optionally runs fulfillment diagnostics on pending requests.
 */
export function gatherRequests(
    config: SnapshotConfig,
    player: number,
    stats: LogisticsStats,
    options?: { limit?: number; diagnose?: boolean }
): GatherRequestsResult {
    const { gameState, requestManager } = config;
    const now = requestManager.getGameTime();
    const limit = options?.limit ?? 0;

    const pending: RequestSummary[] = [];
    const rawPending: ResourceRequest[] = [];
    const inProgress: RequestSummary[] = [];

    for (const request of requestManager.getAllRequests()) {
        categorizeRequest(request, gameState, player, now, pending, rawPending, inProgress, stats);
    }

    const indices = sortPendingIndices(pending);
    const sortedPending = indices.map(i => pending[i]!);
    const sortedRawPending = indices.map(i => rawPending[i]!);

    if (options?.diagnose !== false) {
        const diagConfig = buildDiagConfig(config);
        const diagLimit = limit > 0 ? Math.min(sortedRawPending.length, limit) : sortedRawPending.length;
        for (let i = 0; i < diagLimit; i++) {
            sortedPending[i]!.reason =
                UNFULFILLED_REASON_LABELS[diagnoseUnfulfilledRequest(sortedRawPending[i]!, diagConfig)];
        }
    }

    return {
        pending: applyLimit(sortedPending, limit),
        rawPending: applyLimit(sortedRawPending, limit),
        inProgress: applyLimit(inProgress, limit),
    };
}

function buildCarrierSummary(
    id: number,
    entity: { x: number; y: number; carrying?: { material: EMaterialType; amount: number } },
    settlerTaskSystem: SettlerTaskSystem,
    logisticsDispatcher: LogisticsDispatcher
): CarrierSummary {
    const carrying = entity.carrying;
    const activeJobId = settlerTaskSystem.getActiveJobId(id);
    const job = logisticsDispatcher.activeJobs.get(id);

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
    const { gameState, carrierRegistry, logisticsDispatcher, settlerTaskSystem } = config;
    const carriers: CarrierSummary[] = [];

    for (const [id, , entity] of query(carrierRegistry.store, gameState.store)) {
        if (entity.player !== player) continue;
        const summary = buildCarrierSummary(id, entity, settlerTaskSystem, logisticsDispatcher);
        carriers.push(summary);
        stats.carrierCount++;
        if (summary.hasJob) {
            stats.busyCarriers++;
        } else {
            stats.idleCarriers++;
        }
    }

    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.Unit, player)) {
        if (entity.subType === UnitType.Carrier && !carrierRegistry.has(entity.id)) {
            stats.unregisteredCarriers++;
        }
    }

    carriers.sort((a, b) => a.entityId - b.entityId);
    return applyLimit(carriers, options?.limit ?? 0);
}

/**
 * Gather inventory reservations for a player.
 */
export function gatherReservations(
    config: SnapshotConfig,
    player: number,
    stats: LogisticsStats,
    options?: { limit?: number }
): ReservationSummary[] {
    const { gameState, logisticsDispatcher } = config;
    const reservations: ReservationSummary[] = [];

    for (const reservation of logisticsDispatcher.getReservationManager().getAllReservations()) {
        const building = gameState.getEntity(reservation.buildingId);
        if (!building || building.player !== player) continue;

        reservations.push({
            buildingId: reservation.buildingId,
            material: formatMaterial(reservation.materialType),
            amount: reservation.amount,
            requestId: reservation.requestId,
        });
    }

    stats.reservationCount = reservations.length;
    reservations.sort((a, b) => a.requestId - b.requestId);
    return applyLimit(reservations, options?.limit ?? 0);
}

/**
 * Full logistics snapshot — convenience wrapper used by Vue composable.
 */
export function gatherLogisticsSnapshot(
    config: SnapshotConfig,
    player: number,
    options?: { limit?: number }
): LogisticsDebugState {
    const limit = options?.limit ?? 15;
    const stats = createEmptyStats();
    const { pending, inProgress } = gatherRequests(config, player, stats, { limit, diagnose: true });
    const carriers = gatherCarriers(config, player, stats, { limit });
    const reservations = gatherReservations(config, player, stats, { limit });
    return { stats, pendingRequests: pending, inProgressRequests: inProgress, carriers, reservations };
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
    const { gameState, inventoryManager, settlerTaskSystem, constructionSiteManager } = config;
    const result: ProductionBuildingSummary[] = [];

    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.Building, player)) {
        const inv = inventoryManager.getInventory(entity.id);
        if (!inv) continue;

        const inputs = collectSlots(inv.inputSlots);
        const outputs = collectSlots(inv.outputSlots);
        if (inputs.length === 0 && outputs.length === 0) continue;

        result.push({
            entityId: entity.id,
            type: buildingTypeNameSafe(entity.subType),
            inputs,
            outputs,
            outputFull: outputs.length > 0 && outputs.every(s => s.current >= s.max),
            workerCount: settlerTaskSystem.getWorkersForBuilding(entity.id).size,
            isConstructing: constructionSiteManager.hasSite(entity.id),
        });
    }

    result.sort((a, b) => a.entityId - b.entityId);
    return applyLimit(result, options?.limit ?? 0);
}

function collectSlots(
    slots: readonly { materialType: EMaterialType; currentAmount: number; maxCapacity: number }[]
): SlotSummary[] {
    const result: SlotSummary[] = [];
    for (const slot of slots) {
        if (slot.materialType === EMaterialType.NO_MATERIAL) continue;
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
    const { gameState } = config;
    const kindFilter = options?.kindFilter;
    const result: PileSummary[] = [];

    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.StackedPile, player)) {
        const pileState = gameState.piles.states.get(entity.id);
        if (!pileState) continue;

        const kind = pileKindName(pileState.kind);
        if (kindFilter && kind !== kindFilter) continue;

        result.push({
            entityId: entity.id,
            material: formatMaterial(entity.subType),
            quantity: pileState.quantity,
            kind,
            buildingId: pileOwnerBuilding(pileState.kind),
            x: entity.x,
            y: entity.y,
        });
    }

    result.sort((a, b) => a.entityId - b.entityId);
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
    const { gameState, settlerTaskSystem } = config;
    const stateFilter = options?.stateFilter?.toUpperCase();
    const result: WorkerSummary[] = [];

    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.Unit, player)) {
        if (!isNonCarrierWorker(entity.subType)) continue;
        const workerSummary = buildWorkerSummary(entity.id, entity, settlerTaskSystem, gameState, stateFilter);
        if (workerSummary) result.push(workerSummary);
    }

    result.sort((a, b) => a.entityId - b.entityId);
    return applyLimit(result, options?.limit ?? 0);
}

function buildWorkerSummary(
    entityId: number,
    entity: { subType: number; x: number; y: number },
    settlerTaskSystem: SettlerTaskSystem,
    gameState: GameState,
    stateFilter: string | undefined
): WorkerSummary | null {
    const state = settlerTaskSystem.getSettlerState(entityId);
    if (!state) return null;
    if (stateFilter && state !== stateFilter) return null;

    const assignedBuilding = settlerTaskSystem.getAssignedBuilding(entityId);
    let assignedBuildingType: string | null = null;
    if (assignedBuilding !== null) {
        const bldg = gameState.getEntity(assignedBuilding);
        if (bldg) assignedBuildingType = buildingTypeNameSafe(bldg.subType);
    }

    return {
        entityId,
        unitType: unitTypeNameSafe(entity.subType),
        state,
        assignedBuilding,
        assignedBuildingType,
        jobId: settlerTaskSystem.getActiveJobId(entityId),
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

    for (const [carrierId, job] of logisticsDispatcher.activeJobs) {
        const carrier = gameState.getEntity(carrierId);
        if (!carrier || carrier.player !== player) continue;
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
    return applyLimit(result, options?.limit ?? 0);
}

// ─── Bottleneck detection ────────────────────────────────────────────────────

function scanBuildings(gameState: GameState, inventoryManager: BuildingInventoryManager, player: number) {
    const fullOutputBuildings: number[] = [];

    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.Building, player)) {
        const inv = inventoryManager.getInventory(entity.id);
        if (!inv) continue;
        const outputs = inv.outputSlots.filter(s => s.materialType !== EMaterialType.NO_MATERIAL);
        if (outputs.length > 0 && outputs.every(s => s.currentAmount >= s.maxCapacity)) {
            fullOutputBuildings.push(entity.id);
        }
    }
    return { fullOutputBuildings };
}

function countCarrierStatus(config: SnapshotConfig, player: number) {
    let total = 0;
    let idle = 0;
    for (const [id, , entity] of query(config.carrierRegistry.store, config.gameState.store)) {
        if (entity.player !== player) continue;
        total++;
        if (config.settlerTaskSystem.getActiveJobId(id) === null) idle++;
    }
    return { total, idle };
}

function findIdleWorkers(gameState: GameState, settlerTaskSystem: SettlerTaskSystem, player: number): number[] {
    const idleWorkers: number[] = [];
    for (const entity of gameState.entityIndex.ofTypeAndPlayer(EntityType.Unit, player)) {
        if (!isNonCarrierWorker(entity.subType)) continue;
        if (settlerTaskSystem.getSettlerState(entity.id) === SettlerState.IDLE) {
            idleWorkers.push(entity.id);
        }
    }
    return idleWorkers;
}

/**
 * Detect economy bottlenecks and return actionable diagnostics.
 */
export function detectBottlenecks(config: SnapshotConfig, player: number): BottleneckDiag[] {
    const { gameState, inventoryManager, settlerTaskSystem } = config;
    const diags: BottleneckDiag[] = [];

    const { fullOutputBuildings } = scanBuildings(gameState, inventoryManager, player);
    const carriers = countCarrierStatus(config, player);
    const pendingCount = config.requestManager.getPendingCount();
    const idleWorkers = findIdleWorkers(gameState, settlerTaskSystem, player);

    emitBottleneckDiags(diags, gameState, fullOutputBuildings, carriers, pendingCount, idleWorkers);
    return diags;
}

function emitBottleneckDiags(
    diags: BottleneckDiag[],
    gameState: GameState,
    fullOutputBuildings: number[],
    carriers: { total: number; idle: number },
    pendingCount: number,
    idleWorkers: number[]
): void {
    if (fullOutputBuildings.length > 0) {
        const names = fullOutputBuildings.map(id => entityLabel(gameState, id, buildingTypeNameSafe)).join(', ');
        diags.push({
            severity: 'warning',
            message: `${fullOutputBuildings.length} building(s) with full output: ${names}`,
            relatedEntities: fullOutputBuildings,
        });
    }

    if (carriers.total === 0) {
        diags.push({
            severity: 'critical',
            message: 'No carriers registered — logistics cannot operate',
            relatedEntities: [],
        });
    } else if (carriers.idle > 0 && pendingCount > 0) {
        diags.push({
            severity: 'warning',
            message: `${carriers.idle} idle carrier(s) but ${pendingCount} pending request(s) — check supply/territory`,
            relatedEntities: [],
        });
    }

    if (idleWorkers.length > 0) {
        const names = idleWorkers
            .slice(0, 5)
            .map(id => entityLabel(gameState, id, unitTypeNameSafe))
            .join(', ');
        const suffix = idleWorkers.length > 5 ? ` (+${idleWorkers.length - 5} more)` : '';
        diags.push({
            severity: 'warning',
            message: `${idleWorkers.length} idle worker(s): ${names}${suffix}`,
            relatedEntities: idleWorkers,
        });
    }

    if (diags.length === 0) {
        diags.push({ severity: 'info', message: 'No bottlenecks detected', relatedEntities: [] });
    }
}
