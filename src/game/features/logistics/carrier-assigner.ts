/**
 * CarrierAssigner
 *
 * Finds available carriers for transport jobs and assigns them.
 *
 * Handles the two-phase carrier search:
 * 1. Try carriers from hubs that cover both source and destination (zone-optimal)
 * 2. In global mode, fall back to any remaining player hub
 */

import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { CarrierManager } from '../carriers';
import { CarrierStatus } from '../carriers';
import type { ServiceAreaManager } from '../service-areas';
import type { SettlerTaskSystem } from '../settler-tasks';
import { TransportJob } from './transport-job';
import type { InventoryReservationManager } from './inventory-reservation';
import type { RequestManager } from './request-manager';
import type { BuildingInventoryManager } from '../inventory';
import type { RequestMatchResult } from './request-matcher';
import type { ResourceRequest } from './resource-request';

export interface CarrierAssignerConfig {
    gameState: GameState;
    eventBus: EventBus;
    carrierManager: CarrierManager;
    settlerTaskSystem: SettlerTaskSystem;
    serviceAreaManager: ServiceAreaManager;
    reservationManager: InventoryReservationManager;
    requestManager: RequestManager;
    inventoryManager: BuildingInventoryManager;
}

/** Result of a successful carrier assignment. */
export interface AssignmentSuccess {
    /** The created transport job. */
    transportJob: TransportJob;
    /** Entity ID of the carrier that was assigned. */
    carrierId: number;
}

/**
 * Assigns available carriers to matched transport requests.
 *
 * Creates TransportJob instances that own the reservation and request lifecycle,
 * then assigns the carrier task to fulfill the job.
 */
export class CarrierAssigner {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly carrierManager: CarrierManager;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly serviceAreaManager: ServiceAreaManager;
    private readonly reservationManager: InventoryReservationManager;
    private readonly requestManager: RequestManager;
    private readonly inventoryManager: BuildingInventoryManager;

    /** When false, only search hubs shared by source and destination. */
    globalLogistics = true;

    constructor(config: CarrierAssignerConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.carrierManager = config.carrierManager;
        this.settlerTaskSystem = config.settlerTaskSystem;
        this.serviceAreaManager = config.serviceAreaManager;
        this.reservationManager = config.reservationManager;
        this.requestManager = config.requestManager;
        this.inventoryManager = config.inventoryManager;
    }

    /**
     * Try to assign a carrier to fulfill a matched request.
     *
     * @returns AssignmentSuccess on success, `'no_carrier'` when all carriers are busy, or null on hard failure.
     */
    tryAssign(request: ResourceRequest, match: RequestMatchResult): AssignmentSuccess | 'no_carrier' | null {
        const carrier = this.findAvailableCarrier(match.serviceHubs, match.playerId);
        if (!carrier) {
            return 'no_carrier';
        }

        const transportJob = TransportJob.create(
            request.id,
            match.sourceBuilding,
            request.buildingId,
            request.materialType,
            match.amount,
            carrier.entityId,
            {
                reservationManager: this.reservationManager,
                requestManager: this.requestManager,
                inventoryManager: this.inventoryManager,
            }
        );

        if (!transportJob) {
            this.eventBus.emit('carrier:assignmentFailed', {
                requestId: request.id,
                reason: 'reservation_failed',
                sourceBuilding: match.sourceBuilding,
                destBuilding: request.buildingId,
                material: request.materialType,
                carrierId: carrier.entityId,
            });
            return null;
        }

        const job = this.settlerTaskSystem.buildTransportJob(transportJob, carrier.entityId);
        const success = this.settlerTaskSystem.assignJob(carrier.entityId, job, job.targetPos!);

        if (success) {
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Walking);
            this.eventBus.emit('carrier:assigned', {
                requestId: request.id,
                carrierId: carrier.entityId,
                sourceBuilding: match.sourceBuilding,
                destBuilding: request.buildingId,
                material: request.materialType,
            });
            return { transportJob, carrierId: carrier.entityId };
        }

        this.eventBus.emit('carrier:assignmentFailed', {
            requestId: request.id,
            reason: 'movement_failed',
            sourceBuilding: match.sourceBuilding,
            destBuilding: request.buildingId,
            material: request.materialType,
            carrierId: carrier.entityId,
        });
        transportJob.cancel('assignment_failed');
        return null;
    }

    /**
     * Find an available idle carrier for the given player.
     */
    private findAvailableCarrier(_serviceHubs: number[], playerId: number): { entityId: number } | null {
        for (const carrier of this.carrierManager.getAllCarriers()) {
            const entity = this.gameState.getEntity(carrier.entityId);
            if (!entity || entity.player !== playerId) continue;
            if (this.carrierManager.canAssignJobTo(carrier.entityId)) {
                return { entityId: carrier.entityId };
            }
        }
        return null;
    }
}
