/**
 * Carrier Job Completion Handlers
 *
 * Handles the completion of each phase of a carrier's job:
 * - Pickup: Transfer material from building to carrier, create deliver job
 * - Deliver: Transfer material from carrier to building, return home or idle
 * - Return Home: Set carrier to idle state
 */

import type { EventBus } from '../../event-bus';
import type { CarrierManager } from './carrier-manager';
import type { CarrierState, CarrierJob } from './carrier-state';
import { CarrierStatus } from './carrier-state';
import type { BuildingInventoryManager } from '../inventory';

/**
 * Result of a job completion operation.
 */
export interface JobCompletionResult {
    /** Whether the completion was successful */
    success: boolean;
    /** The next job assigned (if any) */
    nextJob: CarrierJob | null;
    /** Error message if unsuccessful */
    error?: string;
}

/**
 * Handle completion of a pickup job.
 * Withdraws material from source building, updates carrier carrying state,
 * and creates a deliver job.
 *
 * @param carrier The carrier state
 * @param carrierManager Manager to update carrier state
 * @param inventoryManager Manager to handle inventory transfers
 * @param destinationBuildingId Building to deliver to
 * @param eventBus Optional event bus for emitting events
 * @returns Result of the completion
 */
export function handlePickupCompletion(
    carrier: CarrierState,
    carrierManager: CarrierManager,
    inventoryManager: BuildingInventoryManager,
    destinationBuildingId: number,
    eventBus?: EventBus,
): JobCompletionResult {
    const job = carrier.currentJob;

    if (!job || job.type !== 'pickup') {
        return {
            success: false,
            nextJob: null,
            error: 'Carrier does not have a pickup job',
        };
    }

    // Withdraw material from source building
    const withdrawn = inventoryManager.withdrawOutput(
        job.fromBuilding,
        job.material,
        job.amount,
    );

    if (withdrawn === 0) {
        // Material no longer available - cancel job and return home
        carrierManager.completeJob(carrier.entityId);
        const returnJob: CarrierJob = { type: 'return_home' };
        carrierManager.assignJob(carrier.entityId, returnJob);

        return {
            success: false,
            nextJob: returnJob,
            error: 'Material no longer available at source',
        };
    }

    // Update carrier to be carrying the material
    carrierManager.setCarrying(carrier.entityId, job.material, withdrawn);

    // Complete pickup job
    carrierManager.completeJob(carrier.entityId);

    // Emit pickup complete event
    eventBus?.emit('carrier:pickupComplete', {
        entityId: carrier.entityId,
        material: job.material,
        amount: withdrawn,
        fromBuilding: job.fromBuilding,
    });

    // Create deliver job
    const deliverJob: CarrierJob = {
        type: 'deliver',
        toBuilding: destinationBuildingId,
        material: job.material,
        amount: withdrawn,
    };

    // Assign the deliver job (bypass canAssignJobTo check since we're transitioning)
    const carrierState = carrierManager.getCarrier(carrier.entityId);
    if (carrierState) {
        carrierState.currentJob = deliverJob;
    }

    return {
        success: true,
        nextJob: deliverJob,
    };
}

/**
 * Handle completion of a deliver job.
 * Deposits material to destination building, clears carrier carrying state,
 * and creates a return_home job or sets to idle.
 *
 * @param carrier The carrier state
 * @param carrierManager Manager to update carrier state
 * @param inventoryManager Manager to handle inventory transfers
 * @param eventBus Optional event bus for emitting events
 * @returns Result of the completion
 */
export function handleDeliveryCompletion(
    carrier: CarrierState,
    carrierManager: CarrierManager,
    inventoryManager: BuildingInventoryManager,
    eventBus?: EventBus,
): JobCompletionResult {
    const job = carrier.currentJob;

    if (!job || job.type !== 'deliver') {
        return {
            success: false,
            nextJob: null,
            error: 'Carrier does not have a deliver job',
        };
    }

    // Deposit material to destination building
    const deposited = inventoryManager.depositInput(
        job.toBuilding,
        job.material,
        job.amount,
    );

    // Handle overflow - if building can't accept all, drop on ground (for now just log)
    const overflow = job.amount - deposited;
    if (overflow > 0) {
        // TODO: Handle overflow - drop goods or find alternative destination
        console.warn(
            `Carrier ${carrier.entityId} could not deliver ${overflow} ${job.material} - destination full`,
        );
    }

    // Clear carrier carrying state
    carrierManager.setCarrying(carrier.entityId, null, 0);

    // Complete deliver job
    carrierManager.completeJob(carrier.entityId);

    // Emit delivery complete event
    eventBus?.emit('carrier:deliveryComplete', {
        entityId: carrier.entityId,
        material: job.material,
        amount: deposited,
        toBuilding: job.toBuilding,
        overflow,
    });

    // Create return_home job
    const returnJob: CarrierJob = { type: 'return_home' };
    const carrierState = carrierManager.getCarrier(carrier.entityId);
    if (carrierState) {
        carrierState.currentJob = returnJob;
    }

    return {
        success: true,
        nextJob: returnJob,
    };
}

/**
 * Handle completion of a return_home job.
 * Sets carrier to idle status, ready for new jobs.
 *
 * @param carrier The carrier state
 * @param carrierManager Manager to update carrier state
 * @param eventBus Optional event bus for emitting events
 * @returns Result of the completion
 */
export function handleReturnHomeCompletion(
    carrier: CarrierState,
    carrierManager: CarrierManager,
    eventBus?: EventBus,
): JobCompletionResult {
    const job = carrier.currentJob;

    if (!job || job.type !== 'return_home') {
        return {
            success: false,
            nextJob: null,
            error: 'Carrier does not have a return_home job',
        };
    }

    // Complete return_home job
    carrierManager.completeJob(carrier.entityId);

    // Set carrier to idle
    carrierManager.setStatus(carrier.entityId, CarrierStatus.Idle);

    // Emit return home complete event
    eventBus?.emit('carrier:returnedHome', {
        entityId: carrier.entityId,
        homeBuilding: carrier.homeBuilding,
    });

    return {
        success: true,
        nextJob: null,
    };
}

/**
 * Handle job completion based on current job type.
 * Dispatches to the appropriate completion handler.
 *
 * @param carrier The carrier state
 * @param carrierManager Manager to update carrier state
 * @param inventoryManager Manager to handle inventory transfers
 * @param destinationBuildingId For pickup jobs, the building to deliver to
 * @param eventBus Optional event bus for emitting events
 * @returns Result of the completion
 */
export function handleJobCompletion(
    carrier: CarrierState,
    carrierManager: CarrierManager,
    inventoryManager: BuildingInventoryManager,
    destinationBuildingId?: number,
    eventBus?: EventBus,
): JobCompletionResult {
    const job = carrier.currentJob;

    if (!job) {
        return {
            success: false,
            nextJob: null,
            error: 'Carrier has no current job',
        };
    }

    switch (job.type) {
    case 'pickup':
        if (destinationBuildingId === undefined) {
            return {
                success: false,
                nextJob: null,
                error: 'Pickup completion requires destinationBuildingId',
            };
        }
        return handlePickupCompletion(
            carrier,
            carrierManager,
            inventoryManager,
            destinationBuildingId,
            eventBus,
        );

    case 'deliver':
        return handleDeliveryCompletion(
            carrier,
            carrierManager,
            inventoryManager,
            eventBus,
        );

    case 'return_home':
        return handleReturnHomeCompletion(carrier, carrierManager, eventBus);

    default:
        return {
            success: false,
            nextJob: null,
            error: `Unknown job type: ${(job as CarrierJob).type}`,
        };
    }
}
