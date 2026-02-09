/**
 * CarrierMovementController - Handles carrier movement commands.
 *
 * Responsibilities:
 * - Issue movement commands to the movement system
 * - Find approach positions for buildings (adjacent walkable tiles)
 * - Track pending movements for arrival handling
 */

import type { GameState } from '../../game-state';
import type { CarrierManager } from './carrier-manager';
import { CarrierStatus } from './carrier-state';
import { getAllNeighbors } from '../../systems/hex-directions';
import { EntityType } from '../../entity';

/**
 * Tracks a carrier's pending movement destination.
 */
export interface PendingMovement {
    carrierId: number;
    targetBuildingId: number;
    /** 'pickup' | 'deliver' | 'return_home' */
    movementType: 'pickup' | 'deliver' | 'return_home';
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
     * @returns true if movement was successfully started
     */
    startPickupMovement(
        carrierId: number,
        targetBuildingId: number,
        gameState: GameState,
    ): boolean {
        const result = this.startMovementToBuilding(
            carrierId,
            targetBuildingId,
            'pickup',
            gameState,
        );

        if (result) {
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
     * @returns true if movement was successfully started
     */
    startDeliveryMovement(
        carrierId: number,
        targetBuildingId: number,
        gameState: GameState,
    ): boolean {
        const result = this.startMovementToBuilding(
            carrierId,
            targetBuildingId,
            'deliver',
            gameState,
        );

        if (result) {
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
        }

        return result;
    }

    /**
     * Start movement back to the carrier's home tavern.
     *
     * @param carrierId Entity ID of the carrier
     * @param gameState Game state for position lookup
     * @returns true if movement was successfully started
     */
    startReturnMovement(carrierId: number, gameState: GameState): boolean {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return false;

        const result = this.startMovementToBuilding(
            carrierId,
            carrier.homeBuilding,
            'return_home',
            gameState,
        );

        if (result) {
            this.carrierManager.setStatus(carrierId, CarrierStatus.Walking);
        }

        return result;
    }

    /**
     * Internal method to start movement to any building.
     */
    private startMovementToBuilding(
        carrierId: number,
        targetBuildingId: number,
        movementType: 'pickup' | 'deliver' | 'return_home',
        gameState: GameState,
    ): boolean {
        const carrier = this.carrierManager.getCarrier(carrierId);
        if (!carrier) return false;

        const targetBuilding = gameState.getEntity(targetBuildingId);
        if (!targetBuilding) return false;

        // Find an adjacent walkable tile to approach the building
        const approachPos = this.findApproachPosition(
            targetBuilding.x,
            targetBuilding.y,
            gameState,
        );

        if (!approachPos) {
            // No walkable tile adjacent to the building
            return false;
        }

        // Issue movement command to the movement system
        const moveSuccess = gameState.movement.moveUnit(
            carrierId,
            approachPos.x,
            approachPos.y,
        );

        if (!moveSuccess) {
            return false;
        }

        // Track this pending movement
        this.pendingMovements.set(carrierId, {
            carrierId,
            targetBuildingId,
            movementType,
        });

        return true;
    }

    /**
     * Find an adjacent walkable tile to approach a building.
     *
     * Prioritizes tiles closer to center of map (arbitrary but consistent).
     * Returns null if no walkable neighbor exists.
     *
     * @param buildingX Building anchor X coordinate
     * @param buildingY Building anchor Y coordinate
     * @param gameState Game state for terrain and occupancy checks
     * @returns Approach position or null if none found
     */
    findApproachPosition(
        buildingX: number,
        buildingY: number,
        gameState: GameState,
    ): { x: number; y: number } | null {
        const neighbors = getAllNeighbors({ x: buildingX, y: buildingY });

        // Filter to walkable, unoccupied tiles
        const walkable = neighbors.filter(pos => {
            // Check bounds (assume movement system handles this, but be safe)
            if (pos.x < 0 || pos.y < 0) return false;

            // Check if tile is passable terrain
            // We need the terrain data from the movement system
            // For now, check if a unit is NOT occupying the tile
            const occupied = gameState.tileOccupancy.has(`${pos.x},${pos.y}`);
            if (occupied) {
                // Check if it's occupied by a building (can't walk there)
                // or by a unit (might be able to wait or push)
                const occupant = gameState.getEntityAt(pos.x, pos.y);
                if (occupant && occupant.type === EntityType.Building) {
                    return false;
                }
            }

            return true;
        });

        if (walkable.length === 0) {
            return null;
        }

        // Return the first available position (could prioritize by distance to carrier)
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
