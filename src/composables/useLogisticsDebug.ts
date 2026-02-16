/**
 * Composable for gathering logistics debug data.
 *
 * Provides reactive state with counts and summaries from the logistics system,
 * updated on a 500ms interval.
 */

import { ref, onUnmounted, type Ref } from 'vue';
import type { Game } from '@/game/game';
import type { CarrierState } from '@/game/features/carriers/carrier-state';
import { CarrierStatus, FatigueLevel, getFatigueLevel } from '@/game/features/carriers/carrier-state';
import type { ResourceRequest } from '@/game/features/logistics/resource-request';
import { RequestPriority, RequestStatus } from '@/game/features/logistics/resource-request';
import type { InventoryReservation } from '@/game/features/logistics/inventory-reservation';
import type { ServiceArea } from '@/game/features/service-areas/service-area';
import type { CarrierManager } from '@/game/features/carriers/carrier-manager';
import { EMaterialType } from '@/game/economy';
import { EntityType, type Entity } from '@/game/entity';
import { UnitType } from '@/game/unit-types';

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
}

/** Summary of a carrier's current state */
export interface CarrierSummary {
    entityId: number;
    status: string;
    fatigue: number;
    fatigueLevel: string;
    homeBuilding: number;
    carryingMaterial: string | null;
    carryingAmount: number;
    hasJob: boolean;
    jobType: string | null;
}

/** Summary of an inventory reservation */
export interface ReservationSummary {
    id: number;
    buildingId: number;
    material: string;
    amount: number;
    requestId: number;
}

/** Summary of a hub's capacity */
export interface HubSummary {
    buildingId: number;
    carrierCount: number;
    capacity: number;
    isFull: boolean;
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

    /** Hub stats */
    hubCount: number;
    totalHubCapacity: number;
    hubsAtCapacity: number;

    /** Carriers by status */
    idleCarriers: number;
    walkingCarriers: number;
    pickingUpCarriers: number;
    deliveringCarriers: number;
    restingCarriers: number;

    /** Carriers by fatigue level */
    freshCarriers: number;
    tiredCarriers: number;
    exhaustedCarriers: number;
    collapsedCarriers: number;

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
    hubs: HubSummary[];
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
        hubCount: 0,
        totalHubCapacity: 0,
        hubsAtCapacity: 0,
        idleCarriers: 0,
        walkingCarriers: 0,
        pickingUpCarriers: 0,
        deliveringCarriers: 0,
        restingCarriers: 0,
        freshCarriers: 0,
        tiredCarriers: 0,
        exhaustedCarriers: 0,
        collapsedCarriers: 0,
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
        hubs: [],
    };
}

/** Human-readable status names for display */
export const CARRIER_STATUS_NAMES: Record<CarrierStatus, string> = {
    [CarrierStatus.Idle]: 'Idle',
    [CarrierStatus.Walking]: 'Walking',
    [CarrierStatus.PickingUp]: 'PickingUp',
    [CarrierStatus.Delivering]: 'Delivering',
    [CarrierStatus.Resting]: 'Resting',
};

/** Human-readable fatigue level names for display */
export const FATIGUE_LEVEL_NAMES: Record<FatigueLevel, string> = {
    [FatigueLevel.Fresh]: 'Fresh',
    [FatigueLevel.Tired]: 'Tired',
    [FatigueLevel.Exhausted]: 'Exhausted',
    [FatigueLevel.Collapsed]: 'Collapsed',
};

/** CSS class suffixes for carrier status styling */
export const CARRIER_STATUS_CLASSES: Record<CarrierStatus, string> = {
    [CarrierStatus.Idle]: 'idle',
    [CarrierStatus.Walking]: 'walking',
    [CarrierStatus.PickingUp]: 'pickingup',
    [CarrierStatus.Delivering]: 'delivering',
    [CarrierStatus.Resting]: 'resting',
};

/** CSS class suffixes for fatigue level styling */
export const FATIGUE_LEVEL_CLASSES: Record<FatigueLevel, string> = {
    [FatigueLevel.Fresh]: 'fresh',
    [FatigueLevel.Tired]: 'tired',
    [FatigueLevel.Exhausted]: 'exhausted',
    [FatigueLevel.Collapsed]: 'collapsed',
};

const PRIORITY_NAMES: Record<RequestPriority, 'High' | 'Normal' | 'Low'> = {
    [RequestPriority.High]: 'High',
    [RequestPriority.Normal]: 'Normal',
    [RequestPriority.Low]: 'Low',
};

/** Maps status to stats property key for counting */
const STATUS_STAT_KEYS: Record<CarrierStatus, keyof LogisticsStats> = {
    [CarrierStatus.Idle]: 'idleCarriers',
    [CarrierStatus.Walking]: 'walkingCarriers',
    [CarrierStatus.PickingUp]: 'pickingUpCarriers',
    [CarrierStatus.Delivering]: 'deliveringCarriers',
    [CarrierStatus.Resting]: 'restingCarriers',
};

/** Maps fatigue level to stats property key for counting */
const FATIGUE_STAT_KEYS: Record<FatigueLevel, keyof LogisticsStats> = {
    [FatigueLevel.Fresh]: 'freshCarriers',
    [FatigueLevel.Tired]: 'tiredCarriers',
    [FatigueLevel.Exhausted]: 'exhaustedCarriers',
    [FatigueLevel.Collapsed]: 'collapsedCarriers',
};

function formatMaterial(materialType: number): string {
    return EMaterialType[materialType] ?? `#${materialType}`;
}

function gatherRequests(
    requests: Iterable<ResourceRequest>,
    now: number,
    stats: LogisticsStats
): { pending: RequestSummary[]; inProgress: RequestSummary[] } {
    const pending: RequestSummary[] = [];
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
        };

        if (request.assignedCarrier !== null) {
            inProgress.push(summary);
            stats.inProgressCount++;
            if (request.assignedAt !== null && now - request.assignedAt > STALL_THRESHOLD_MS) {
                stats.stalledCount++;
            }
        } else if (request.status === RequestStatus.Pending) {
            pending.push(summary);
            stats.pendingCount++;
        }
    }

    // Sort pending by priority then age (oldest first)
    pending.sort((a, b) => {
        const priorityOrder = { High: 0, Normal: 1, Low: 2 };
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return pDiff !== 0 ? pDiff : b.age - a.age;
    });

    return { pending, inProgress };
}

function gatherCarriers(
    allCarriers: Iterable<CarrierState>,
    getEntity: (id: number) => Entity | undefined,
    stats: LogisticsStats
): CarrierSummary[] {
    const carriers: CarrierSummary[] = [];

    for (const carrier of allCarriers) {
        const fatigueLevel = getFatigueLevel(carrier.fatigue);
        const entity = getEntity(carrier.entityId);
        const carrying = entity?.carrying;

        carriers.push({
            entityId: carrier.entityId,
            status: CARRIER_STATUS_NAMES[carrier.status],
            fatigue: Math.round(carrier.fatigue),
            fatigueLevel: FATIGUE_LEVEL_NAMES[fatigueLevel],
            homeBuilding: carrier.homeBuilding,
            carryingMaterial: carrying ? formatMaterial(carrying.material) : null,
            carryingAmount: carrying?.amount ?? 0,
            hasJob: carrier.currentJob !== null,
            jobType: carrier.currentJob?.type ?? null,
        });

        stats.carrierCount++;
        (stats[STATUS_STAT_KEYS[carrier.status]] as number)++;
        (stats[FATIGUE_STAT_KEYS[fatigueLevel]] as number)++;
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
            id: reservation.id,
            buildingId: reservation.buildingId,
            material: formatMaterial(reservation.materialType),
            amount: reservation.amount,
            requestId: reservation.requestId,
        });
    }

    stats.reservationCount = reservations.length;
    reservations.sort((a, b) => a.id - b.id);
    return reservations;
}

function gatherHubs(
    serviceAreas: Iterable<ServiceArea>,
    carrierManager: CarrierManager,
    stats: LogisticsStats
): HubSummary[] {
    const hubs: HubSummary[] = [];

    for (const area of serviceAreas) {
        const carrierCount = carrierManager.getCarrierCountForHub(area.buildingId);
        const isFull = carrierCount >= area.capacity;

        hubs.push({
            buildingId: area.buildingId,
            carrierCount,
            capacity: area.capacity,
            isFull,
        });

        stats.hubCount++;
        stats.totalHubCapacity += area.capacity;
        if (isFull) {
            stats.hubsAtCapacity++;
        }
    }

    hubs.sort((a, b) => a.buildingId - b.buildingId);
    return hubs;
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

        const gameLoop = game.gameLoop;
        const gameState = game.state;
        const stats = createEmptyStats();
        const now = Date.now();

        // Gather requests
        const { pending, inProgress } = gatherRequests(gameLoop.requestManager.getAllRequests(), now, stats);

        // Gather carriers
        const carriers = gatherCarriers(gameLoop.carrierManager.getAllCarriers(), id => gameState.getEntity(id), stats);

        // Count unregistered carriers (carrier units without entity.carrier)
        for (const entity of gameState.entities) {
            if (entity.type === EntityType.Unit && entity.subType === UnitType.Carrier && !entity.carrier) {
                stats.unregisteredCarriers++;
            }
        }

        // Gather reservations
        const reservations = gatherReservations(
            gameLoop.logisticsDispatcher.getReservationManager().getAllReservations(),
            stats
        );

        // Gather hubs
        const hubs = gatherHubs(gameLoop.serviceAreaManager.getAllServiceAreas(), gameLoop.carrierManager, stats);

        state.value = {
            stats,
            pendingRequests: pending.slice(0, MAX_LIST_ITEMS),
            inProgressRequests: inProgress.slice(0, MAX_LIST_ITEMS),
            carriers: carriers.slice(0, MAX_LIST_ITEMS),
            reservations: reservations.slice(0, MAX_LIST_ITEMS),
            hubs: hubs.slice(0, MAX_LIST_ITEMS),
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
