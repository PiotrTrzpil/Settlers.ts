/**
 * Carrier Job Completion Handlers
 *
 * Pure functions that handle the completion of each phase of a carrier's job.
 * These functions update state through the CarrierManager API and return
 * information about what job should come next.
 *
 * Design principles:
 * - Pure functions with explicit dependencies
 * - All state changes go through manager APIs (no direct mutation)
 * - Return result objects for caller to decide next action
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
    /** The next job to assign (caller is responsible for assignment) */
    nextJob: CarrierJob | null;
    /** Error message if unsuccessful */
    error?: string;
    /** Amount actually transferred (for pickup/delivery) */
    amountTransferred?: number;
}

/**
 * Handle completion of a pickup job.
 * Withdraws material from source building and updates carrier carrying state.
 *
 * IMPORTANT: This function does NOT assign the next job. The caller is responsible
 * for assigning the returned nextJob to maintain clean separation of concerns.
 *
 * @param carrier The carrier state (read-only reference)
 * @param carrierManager Manager to update carrier state
 * @param inventoryManager Manager to handle inventory transfers
 * @param destinationBuildingId Building to deliver to (for creating deliver job)
 * @param eventBus Optional event bus for emitting events
 * @returns Result with success status and next job to assign
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

    // Verify source building has inventory
    const inventory = inventoryManager.getInventory(job.fromBuilding);
    if (!inventory) {
        // Building no longer exists or has no inventory
        carrierManager.completeJob(carrier.entityId);
        return {
            success: false,
            nextJob: { type: 'return_home' },
            error: 'Source building has no inventory (may have been destroyed)',
        };
    }

    // Withdraw material from source building
    const withdrawn = inventoryManager.withdrawOutput(
        job.fromBuilding,
        job.material,
        job.amount,
    );

    if (withdrawn === 0) {
        // Material no longer available - job fails
        carrierManager.completeJob(carrier.entityId);
        return {
            success: false,
            nextJob: { type: 'return_home' },
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

    // Create deliver job for caller to assign
    const deliverJob: CarrierJob = {
        type: 'deliver',
        toBuilding: destinationBuildingId,
        material: job.material,
        amount: withdrawn,
    };

    return {
        success: true,
        nextJob: deliverJob,
        amountTransferred: withdrawn,
    };
}

/**
 * Handle completion of a deliver job.
 * Deposits material to destination building and clears carrier carrying state.
 *
 * IMPORTANT: This function does NOT assign the next job. The caller is responsible
 * for assigning the returned nextJob.
 *
 * @param carrier The carrier state (read-only reference)
 * @param carrierManager Manager to update carrier state
 * @param inventoryManager Manager to handle inventory transfers
 * @param eventBus Optional event bus for emitting events
 * @returns Result with success status and next job to assign
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

    // Verify destination building has inventory
    const inventory = inventoryManager.getInventory(job.toBuilding);
    if (!inventory) {
        // Building no longer exists - drop goods and return home
        // TODO: In future, could drop goods on ground as stacked resource
        carrierManager.setCarrying(carrier.entityId, null, 0);
        carrierManager.completeJob(carrier.entityId);

        eventBus?.emit('carrier:deliveryComplete', {
            entityId: carrier.entityId,
            material: job.material,
            amount: 0,
            toBuilding: job.toBuilding,
            overflow: job.amount, // All goods lost
        });

        return {
            success: false,
            nextJob: { type: 'return_home' },
            error: 'Destination building has no inventory (may have been destroyed)',
        };
    }

    // Deposit material to destination building
    const deposited = inventoryManager.depositInput(
        job.toBuilding,
        job.material,
        job.amount,
    );

    // Calculate overflow
    const overflow = job.amount - deposited;

    // TODO: Handle overflow properly - for now goods are lost
    // Future: drop on ground, find alternative destination, or return to source

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

    return {
        success: true,
        nextJob: { type: 'return_home' },
        amountTransferred: deposited,
    };
}

/**
 * Handle completion of a return_home job.
 * Sets carrier to idle status, ready for new jobs.
 *
 * @param carrier The carrier state (read-only reference)
 * @param carrierManager Manager to update carrier state
 * @param eventBus Optional event bus for emitting events
 * @returns Result with success status (nextJob is always null)
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
 * @param carrier The carrier state (read-only reference)
 * @param carrierManager Manager to update carrier state
 * @param inventoryManager Manager to handle inventory transfers
 * @param destinationBuildingId For pickup jobs, the building to deliver to
 * @param eventBus Optional event bus for emitting events
 * @returns Result with success status and next job to assign
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
