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
import type { CarrierManager } from '../carriers';
import { CarrierStatus } from '../carriers';
import type { ServiceAreaManager } from '../service-areas';
import type { SettlerTaskSystem } from '../settler-tasks';
import { buildCarrierJob } from '../settler-tasks';
import { LogHandler } from '@/utilities/log-handler';
import { TransportJob } from './transport-job';
import type { InventoryReservationManager } from './inventory-reservation';
import type { RequestManager } from './request-manager';
import type { BuildingInventoryManager } from '../inventory';
import type { RequestMatchResult } from './request-matcher';
import type { ResourceRequest } from './resource-request';

const log = new LogHandler('CarrierAssigner');

export interface CarrierAssignerConfig {
    gameState: GameState;
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
     * @returns AssignmentSuccess (job + carrierId) on success, or null on failure.
     */
    tryAssign(request: ResourceRequest, match: RequestMatchResult): AssignmentSuccess | null {
        const carrier = this.findAvailableCarrier(match.serviceHubs, match.playerId);
        if (!carrier) {
            log.warn(
                `Request #${request.id}: matched source=${match.sourceBuilding} but no carrier available ` +
                    `(${match.serviceHubs.length} valid hubs: [${match.serviceHubs.join(', ')}])`
            );
            return null;
        }

        const carrierState = this.carrierManager.getCarrierOrThrow(carrier.entityId, 'for delivery assignment');
        const transportJob = TransportJob.create(
            request.id,
            match.sourceBuilding,
            request.buildingId,
            request.materialType,
            match.amount,
            carrierState.homeBuilding,
            carrier.entityId,
            {
                reservationManager: this.reservationManager,
                requestManager: this.requestManager,
                inventoryManager: this.inventoryManager,
            }
        );

        if (!transportJob) {
            return null; // Reservation failed
        }

        const sourceBuilding = this.gameState.getEntityOrThrow(match.sourceBuilding, 'source building for carrier');
        const job = buildCarrierJob(transportJob);
        const success = this.settlerTaskSystem.assignJob(carrier.entityId, job, {
            x: sourceBuilding.x,
            y: sourceBuilding.y,
        });

        if (success) {
            this.carrierManager.setStatus(carrier.entityId, CarrierStatus.Walking);
            return { transportJob, carrierId: carrier.entityId };
        }

        transportJob.cancel('assignment_failed');
        return null;
    }

    /**
     * Find an available carrier from the given service hubs.
     * In global mode, falls back to searching all player hubs if no shared-hub carrier is free.
     * In zone mode, only searches the shared hubs.
     */
    private findAvailableCarrier(serviceHubs: number[], playerId: number): { entityId: number } | null {
        // Try carriers from hubs that cover both source and dest (likely closer)
        const fromShared = this.findIdleCarrierInHubs(serviceHubs, playerId);
        if (fromShared || !this.globalLogistics) return fromShared;

        // Global fallback: search all remaining hubs for this player
        const sharedHubSet = new Set(serviceHubs);
        const remainingHubs = this.serviceAreaManager
            .getServiceAreasForPlayer(playerId)
            .filter(area => !sharedHubSet.has(area.buildingId))
            .map(area => area.buildingId);

        return this.findIdleCarrierInHubs(remainingHubs, playerId);
    }

    /**
     * Find the first idle carrier from the given hub IDs.
     */
    private findIdleCarrierInHubs(hubIds: number[], playerId: number): { entityId: number } | null {
        for (const hubId of hubIds) {
            const hubEntity = this.gameState.getEntity(hubId);
            if (!hubEntity || hubEntity.player !== playerId) continue;

            for (const carrier of this.carrierManager.getCarriersForTavern(hubId)) {
                if (this.carrierManager.canAssignJobTo(carrier.entityId)) {
                    return { entityId: carrier.entityId };
                }
            }
        }
        return null;
    }
}
