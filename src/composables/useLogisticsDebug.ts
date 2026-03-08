/**
 * Composable for gathering logistics debug data.
 *
 * Provides reactive state with counts and summaries from the logistics system,
 * updated on a 500ms interval.
 */

import { ref, onUnmounted, type Ref } from 'vue';
import type { Game } from '@/game/game';
import type { ResourceRequest } from '@/game/features/logistics/resource-request';
import { RequestPriority, RequestStatus } from '@/game/features/logistics/resource-request';
import type { InventoryReservation } from '@/game/features/logistics/inventory-reservation';
import { EMaterialType } from '@/game/economy';
import { EntityType, type Entity } from '@/game/entity';
import { UnitType } from '@/game/core/unit-types';
import { query, type ComponentStore } from '@/game/ecs';
import {
    diagnoseUnfulfilledRequest,
    UNFULFILLED_REASON_LABELS,
    type DiagnosticConfig,
} from '@/game/features/logistics/fulfillment-diagnostics';

/** Summary of a pending or in-progress request */
export interface RequestSummary {
    id: number;
    buildingId: number;
    material: string;
    priority: 'High' | 'Normal' | 'Low';
    /** Age in seconds since creation */
    age: number;
    /** Whether this request is assigned to a carrier */
    inProgress: boolean;
    carrierId: number | null;
    sourceBuildingId: number | null;
    /** Why this pending request is not being fulfilled (null for in-progress requests) */
    reason: string | null;
}

/** Summary of a carrier's current state */
export interface CarrierSummary {
    entityId: number;
    status: string;
    carryingMaterial: string | null;
    carryingAmount: number;
    hasJob: boolean;
    jobType: string | null;
}

/** Summary of an inventory reservation */
export interface ReservationSummary {
    buildingId: number;
    material: string;
    amount: number;
    requestId: number;
}

/** Aggregated logistics stats */
export interface LogisticsStats {
    /** Counts */
    pendingCount: number;
    inProgressCount: number;
    stalledCount: number;
    /** Registered carriers (have entity.carrier) */
    carrierCount: number;
    /** Unregistered carrier units (missing entity.carrier - need hub or all hubs full) */
    unregisteredCarriers: number;

    /** Carriers by activity */
    idleCarriers: number;
    busyCarriers: number;

    /** Reservation count */
    reservationCount: number;
}

/** Logistics debug state */
export interface LogisticsDebugState {
    stats: LogisticsStats;
    pendingRequests: RequestSummary[];
    inProgressRequests: RequestSummary[];
    carriers: CarrierSummary[];
    reservations: ReservationSummary[];
}

const STALL_THRESHOLD_MS = 30_000;
const MAX_LIST_ITEMS = 15;

function createEmptyStats(): LogisticsStats {
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

function createEmptyState(): LogisticsDebugState {
    return {
        stats: createEmptyStats(),
        pendingRequests: [],
        inProgressRequests: [],
        carriers: [],
        reservations: [],
    };
}

const PRIORITY_NAMES: Record<RequestPriority, 'High' | 'Normal' | 'Low'> = {
    [RequestPriority.High]: 'High',
    [RequestPriority.Normal]: 'Normal',
    [RequestPriority.Low]: 'Low',
};

function formatMaterial(materialType: number): string {
    return EMaterialType[materialType] ?? `#${materialType}`;
}

function gatherRequests(
    requests: Iterable<ResourceRequest>,
    now: number,
    stats: LogisticsStats
): { pending: RequestSummary[]; rawPending: ResourceRequest[]; inProgress: RequestSummary[] } {
    const pending: RequestSummary[] = [];
    const rawPending: ResourceRequest[] = [];
    const inProgress: RequestSummary[] = [];

    for (const request of requests) {
        const summary: RequestSummary = {
            id: request.id,
            buildingId: request.buildingId,
            material: formatMaterial(request.materialType),
            priority: PRIORITY_NAMES[request.priority],
            age: Math.floor((now - request.timestamp) / 1000),
            inProgress: request.assignedCarrier !== null,
            carrierId: request.assignedCarrier,
            sourceBuildingId: request.sourceBuilding,
            reason: null,
        };

        if (request.assignedCarrier !== null) {
            inProgress.push(summary);
            stats.inProgressCount++;
            if (request.assignedAt !== null && now - request.assignedAt > STALL_THRESHOLD_MS) {
                stats.stalledCount++;
            }
        } else if (request.status === RequestStatus.Pending) {
            pending.push(summary);
            rawPending.push(request);
            stats.pendingCount++;
        }
    }

    // Sort pending by priority then age (oldest first)
    // Sort both arrays in parallel by creating index pairs
    const indices = pending.map((_, i) => i);
    indices.sort((a, b) => {
        const priorityOrder = { High: 0, Normal: 1, Low: 2 };
        const pDiff = priorityOrder[pending[a]!.priority] - priorityOrder[pending[b]!.priority];
        return pDiff !== 0 ? pDiff : pending[b]!.age - pending[a]!.age;
    });
    const sortedPending = indices.map(i => pending[i]!);
    const sortedRawPending = indices.map(i => rawPending[i]!);

    return { pending: sortedPending, rawPending: sortedRawPending, inProgress };
}

function gatherCarriers(
    carrierStore: ComponentStore<{ entityId: number }>,
    entityStore: ComponentStore<Entity>,
    getActiveJobId: (entityId: number) => string | null,
    stats: LogisticsStats
): CarrierSummary[] {
    const carriers: CarrierSummary[] = [];

    for (const [id, , entity] of query(carrierStore, entityStore)) {
        const carrying = entity.carrying;
        const activeJobId = getActiveJobId(id);
        const hasJob = activeJobId !== null;

        carriers.push({
            entityId: id,
            status: hasJob ? 'Busy' : 'Idle',
            carryingMaterial: carrying ? formatMaterial(carrying.material) : null,
            carryingAmount: carrying?.amount ?? 0,
            hasJob,
            jobType: activeJobId,
        });

        stats.carrierCount++;
        if (hasJob) {
            stats.busyCarriers++;
        } else {
            stats.idleCarriers++;
        }
    }

    carriers.sort((a, b) => a.entityId - b.entityId);
    return carriers;
}

function gatherReservations(
    allReservations: Iterable<InventoryReservation>,
    stats: LogisticsStats
): ReservationSummary[] {
    const reservations: ReservationSummary[] = [];

    for (const reservation of allReservations) {
        reservations.push({
            buildingId: reservation.buildingId,
            material: formatMaterial(reservation.materialType),
            amount: reservation.amount,
            requestId: reservation.requestId,
        });
    }

    stats.reservationCount = reservations.length;
    reservations.sort((a, b) => a.requestId - b.requestId);
    return reservations;
}

/**
 * Composable for gathering logistics debug data.
 *
 * @param getGame Function to retrieve the current Game instance
 * @returns Reactive state with logistics debug data
 */
export function useLogisticsDebug(getGame: () => Game | null): {
    state: Ref<LogisticsDebugState>;
    refresh: () => void;
} {
    const state = ref<LogisticsDebugState>(createEmptyState());

    function refresh(): void {
        const game = getGame();
        if (!game) {
            state.value = createEmptyState();
            return;
        }

        const svc = game.services;
        const gameState = game.state;
        const stats = createEmptyStats();
        const now = Date.now();

        // Gather requests
        const { pending, rawPending, inProgress } = gatherRequests(svc.requestManager.getAllRequests(), now, stats);

        // Gather carriers
        const carriers = gatherCarriers(
            svc.carrierRegistry.store,
            gameState.store,
            svc.settlerTaskSystem.getActiveJobId.bind(svc.settlerTaskSystem),
            stats
        );

        // Count unregistered carriers (carrier units without carrier state in manager)
        for (const entity of gameState.entities) {
            if (
                entity.type === EntityType.Unit &&
                entity.subType === UnitType.Carrier &&
                !svc.carrierRegistry.has(entity.id)
            ) {
                stats.unregisteredCarriers++;
            }
        }

        // Gather reservations
        const reservations = gatherReservations(
            svc.logisticsDispatcher.getReservationManager().getAllReservations(),
            stats
        );

        // Diagnose why pending requests are unfulfilled (limit to displayed items to avoid perf issues)
        const diagnosticConfig: DiagnosticConfig = {
            gameState,
            inventoryManager: svc.inventoryManager,
            carrierRegistry: svc.carrierRegistry,
            reservationManager: svc.logisticsDispatcher.getReservationManager(),
            getActiveJobId: svc.settlerTaskSystem.getActiveJobId.bind(svc.settlerTaskSystem),
        };
        const diagnosticLimit = Math.min(rawPending.length, MAX_LIST_ITEMS);
        for (let i = 0; i < diagnosticLimit; i++) {
            const reason = diagnoseUnfulfilledRequest(rawPending[i]!, diagnosticConfig);
            pending[i]!.reason = UNFULFILLED_REASON_LABELS[reason];
        }

        state.value = {
            stats,
            pendingRequests: pending.slice(0, MAX_LIST_ITEMS),
            inProgressRequests: inProgress.slice(0, MAX_LIST_ITEMS),
            carriers: carriers.slice(0, MAX_LIST_ITEMS),
            reservations: reservations.slice(0, MAX_LIST_ITEMS),
        };
    }

    // Initial refresh
    refresh();

    // Set up interval
    const intervalId = setInterval(refresh, 500);

    onUnmounted(() => {
        clearInterval(intervalId);
    });

    return { state, refresh };
}
