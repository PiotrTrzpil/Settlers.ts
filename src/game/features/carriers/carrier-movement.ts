/**
 * CarrierMovementController - Handles carrier movement commands.
 *
 * Responsibilities:
 * - Issue movement commands to the movement system
 * - Find approach positions for buildings (adjacent walkable tiles)
 * - Track pending movements for arrival handling
 *
 * Design decisions:
 * - Does NOT handle carrier state changes (status, jobs) - that's CarrierSystem's job
 * - Uses movement system's moveUnit() for pathfinding - doesn't implement own pathfinding
 * - Pending movements are cleared by the system after arrival is handled
 */

import type { GameState } from '../../game-state';
import type { CarrierManager } from './carrier-manager';
import { CarrierStatus } from './carrier-state';
import { getAllNeighbors, hexDistance } from '../../systems/hex-directions';
import { EntityType } from '../../entity';

/**
 * Tracks a carrier's pending movement destination.
 */
export interface PendingMovement {
    carrierId: number;
    targetBuildingId: number;
    /** 'pickup' | 'deliver' | 'return_home' */
    movementType: 'pickup' | 'deliver' | 'return_home';
    /** Position carrier is moving towards (for validation) */
    targetX: number;
    targetY: number;
}

/**
 * Result of a movement start operation.
 */
export interface MovementStartResult {
    success: boolean;
    /** Reason for failure if success is false */
    failureReason?: 'carrier_not_found' | 'building_not_found' | 'no_approach_position' | 'pathfinding_failed';
}

/**
 * Controller that manages carrier movement commands.
 *
 * This controller doesn't implement movement itself - it issues commands
 * to the existing MovementSystem. It tracks pending movements to handle
 * arrival events appropriately.
 */
export class CarrierMovementController {
    private carrierManager: CarrierManager;

    /** Map of carrierId -> pending movement info */
    private pendingMovements: Map<number, PendingMovement> = new Map();

    constructor(carrierManager: CarrierManager) {
        this.carrierManager = carrierManager;
    }

    /**
     * Start movement to a building for pickup.
     *
     * @param carrierId Entity ID of the carrier
     * @param targetBuildingId Entity ID of the building to pick up from
     * @param gameState Game state for position lookup
     * @returns Result with success flag and failure reason if applicable
     */
    startPickupMovement(
        carrierId: number,
        targetBuildingId: number,
        gameState: GameState,
    ): MovementStartResult {
        const result = this.startMovementToBuilding(
            carrierId,
            targetBuildingId,
            'pickup',
            gameState,
        );

        if (result.success) {
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
        }

        return result;
    }

    /**
     * Start movement to a building for delivery.
     *
     * @param carrierId Entity ID of the carrier
     * @param targetBuildingId Entity ID of the building to deliver to
     * @param gameState Game state for position lookup
     * @returns Result with success flag and failure reason if applicable
     */
    startDeliveryMovement(
        carrierId: number,
        targetBuildingId: number,
        gameState: GameState,
    ): MovementStartResult {
        const result = this.startMovementToBuilding(
            carrierId,
            targetBuildingId,
            'deliver',
            gameState,
        );

        if (result.success) {
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
        }

        return result;
    }

    /**
     * Start movement back to the carrier's home tavern.
     *
     * @param carrierId Entity ID of the carrier
     * @param gameState Game state for position lookup
     * @returns Result with success flag and failure reason if applicable
     */
    startReturnMovement(carrierId: number, gameState: GameState): MovementStartResult {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) {
            return { success: false, failureReason: 'carrier_not_found' };
        }

        const result = this.startMovementToBuilding(
            carrierId,
            carrier.homeBuilding,
            'return_home',
            gameState,
        );

        if (result.success) {
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
        }

        return result;
    }

    /**
     * Cancel a pending movement for a carrier.
     * Does NOT stop the actual movement (unit will continue to destination),
     * but clears the pending movement record so arrival won't be handled.
     *
     * @param carrierId Entity ID of the carrier
     * @returns true if a pending movement was cancelled
     */
    cancelMovement(carrierId: number): boolean {
        return this.pendingMovements.delete(carrierId);
    }

    /**
     * Internal method to start movement to any building.
     */
    private startMovementToBuilding(
        carrierId: number,
        targetBuildingId: number,
        movementType: 'pickup' | 'deliver' | 'return_home',
        gameState: GameState,
    ): MovementStartResult {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) {
            return { success: false, failureReason: 'carrier_not_found' };
        }

        const targetBuilding = gameState.getEntity(targetBuildingId);
        if (!targetBuilding) {
            return { success: false, failureReason: 'building_not_found' };
        }

        // Get carrier's current position for smarter approach selection
        const carrierEntity = gameState.getEntity(carrierId);
        const carrierX = carrierEntity?.x ?? 0;
        const carrierY = carrierEntity?.y ?? 0;

        // Find an adjacent walkable tile to approach the building
        const approachPos = this.findApproachPosition(
            targetBuilding.x,
            targetBuilding.y,
            carrierX,
            carrierY,
            gameState,
        );

        if (!approachPos) {
            return { success: false, failureReason: 'no_approach_position' };
        }

        // Issue movement command to the movement system
        const moveSuccess = gameState.movement.moveUnit(
            carrierId,
            approachPos.x,
            approachPos.y,
        );

        if (!moveSuccess) {
            return { success: false, failureReason: 'pathfinding_failed' };
        }

        // Track this pending movement
        this.pendingMovements.set(carrierId, {
            carrierId,
            targetBuildingId,
            movementType,
            targetX: approachPos.x,
            targetY: approachPos.y,
        });

        return { success: true };
    }

    /**
     * Find an adjacent walkable tile to approach a building.
     *
     * Prioritizes tiles closest to the carrier's current position.
     * Returns null if no walkable neighbor exists.
     *
     * @param buildingX Building anchor X coordinate
     * @param buildingY Building anchor Y coordinate
     * @param carrierX Carrier's current X coordinate
     * @param carrierY Carrier's current Y coordinate
     * @param gameState Game state for terrain and occupancy checks
     * @returns Approach position or null if none found
     */
    findApproachPosition(
        buildingX: number,
        buildingY: number,
        carrierX: number,
        carrierY: number,
        gameState: GameState,
    ): { x: number; y: number } | null {
        const neighbors = getAllNeighbors({ x: buildingX, y: buildingY });

        // Filter to walkable tiles (not occupied by buildings)
        const walkable = neighbors.filter(pos => {
            // Check bounds
            if (pos.x < 0 || pos.y < 0) return false;

            // Check if tile is occupied by a building
            const occupant = gameState.getEntityAt(pos.x, pos.y);
            if (occupant && occupant.type === EntityType.Building) {
                return false;
            }

            // Units on the tile are OK - pathfinding/movement system handles them
            return true;
        });

        if (walkable.length === 0) {
            return null;
        }

        // Sort by distance to carrier and pick closest
        walkable.sort((a, b) => {
            const distA = hexDistance(a.x, a.y, carrierX, carrierY);
            const distB = hexDistance(b.x, b.y, carrierX, carrierY);
            return distA - distB;
        });

        return walkable[0];
    }

    /**
     * Get the pending movement for a carrier.
     * Used by the system to handle arrival events.
     */
    getPendingMovement(carrierId: number): PendingMovement | undefined {
        return this.pendingMovements.get(carrierId);
    }

    /**
     * Clear a pending movement after arrival is handled.
     */
    clearPendingMovement(carrierId: number): void {
        this.pendingMovements.delete(carrierId);
    }

    /**
     * Check if a carrier has a pending movement.
     */
    hasPendingMovement(carrierId: number): boolean {
        return this.pendingMovements.has(carrierId);
    }

    /**
     * Get all carriers with pending movements.
     * Useful for debugging.
     */
    getAllPendingMovements(): IterableIterator<PendingMovement> {
        return this.pendingMovements.values();
    }

    /**
     * Clear all pending movements.
     */
    clear(): void {
        this.pendingMovements.clear();
    }
}
