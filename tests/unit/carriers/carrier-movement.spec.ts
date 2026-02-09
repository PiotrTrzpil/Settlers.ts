/**
 * Tests for CarrierMovementController and CarrierAnimationController.
 *
 * Tests movement command issuance, approach position finding,
 * animation timing, and state transitions.
 */
/* eslint-disable max-lines-per-function */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CarrierManager,
    CarrierMovementController,
    CarrierAnimationController,
    CarrierStatus,
    PICKUP_ANIMATION_DURATION_MS,
    DROP_ANIMATION_DURATION_MS,
} from '@/game/features/carriers';
import { EMaterialType } from '@/game/economy';
import { createGameState, addBuilding, addUnit } from '../helpers/test-game';
import { createTestMap } from '../helpers/test-map';
import type { GameState } from '@/game/game-state';
import type { TestMap } from '../helpers/test-map';
import { BuildingType } from '@/game/entity';

describe('CarrierMovementController', () => {
    let carrierManager: CarrierManager;
    let movementController: CarrierMovementController;
    let gameState: GameState;
    let testMap: TestMap;

    beforeEach(() => {
        carrierManager = new CarrierManager();
        movementController = new CarrierMovementController(carrierManager);
        gameState = createGameState();
        testMap = createTestMap(64, 64);
        gameState.setTerrainData(
            testMap.groundType,
            testMap.groundHeight,
            testMap.mapSize.width,
            testMap.mapSize.height,
        );
    });

    // ---------------------------------------------------------------------------
    // Approach Position Finding
    // ---------------------------------------------------------------------------

    describe('findApproachPosition', () => {
        it('should find an adjacent walkable tile', () => {
            // Add a building at (10, 10)
            addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);

            // Carrier at (5, 5) approaching building at (10, 10)
            const pos = movementController.findApproachPosition(10, 10, 5, 5, gameState);

            expect(pos).not.toBeNull();
            // Should be one of the 6 hex neighbors of (10, 10)
            // Neighbors are: (11,9), (11,10), (10,11), (9,11), (9,10), (10,9)
            if (pos) {
                const dx = Math.abs(pos.x - 10);
                const dy = Math.abs(pos.y - 10);
                expect(dx + dy).toBeLessThanOrEqual(2);
            }
        });

        it('should not include tiles occupied by buildings', () => {
            // Add buildings at (10, 10) and all its neighbors except one
            addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 11, 9, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 11, 10, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 10, 11, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 9, 11, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 9, 10, BuildingType.WoodcutterHut, 0);
            // Leave (10, 9) free

            // Carrier at (10, 5) approaching from north
            const pos = movementController.findApproachPosition(10, 10, 10, 5, gameState);

            // Only (10, 9) should be available
            expect(pos).toEqual({ x: 10, y: 9 });
        });

        it('should return null if all neighbors are blocked', () => {
            // Add building at (10, 10) and all its neighbors
            addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 11, 9, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 11, 10, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 10, 11, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 9, 11, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 9, 10, BuildingType.WoodcutterHut, 0);
            addBuilding(gameState, 10, 9, BuildingType.WoodcutterHut, 0);

            // Carrier at (5, 5), all neighbors blocked
            const pos = movementController.findApproachPosition(10, 10, 5, 5, gameState);

            expect(pos).toBeNull();
        });
    });

    // ---------------------------------------------------------------------------
    // Pending Movement Tracking
    // ---------------------------------------------------------------------------

    describe('pending movement tracking', () => {
        it('should track pending movements after starting pickup', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const target = addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);
            const { entity: carrier } = addUnit(gameState, 6, 6);
            carrierManager.createCarrier(carrier.id, tavern.id);

            movementController.startPickupMovement(carrier.id, target.id, gameState);

            expect(movementController.hasPendingMovement(carrier.id)).toBe(true);
            const pending = movementController.getPendingMovement(carrier.id);
            expect(pending).toBeDefined();
            expect(pending?.carrierId).toBe(carrier.id);
            expect(pending?.targetBuildingId).toBe(target.id);
            expect(pending?.movementType).toBe('pickup');
            // Also has targetX/targetY for approach position
            expect(typeof pending?.targetX).toBe('number');
            expect(typeof pending?.targetY).toBe('number');
        });

        it('should track pending movements after starting delivery', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const target = addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);
            const { entity: carrier } = addUnit(gameState, 6, 6);
            carrierManager.createCarrier(carrier.id, tavern.id);

            movementController.startDeliveryMovement(carrier.id, target.id, gameState);

            expect(movementController.hasPendingMovement(carrier.id)).toBe(true);
            const pending = movementController.getPendingMovement(carrier.id);
            expect(pending?.movementType).toBe('deliver');
        });

        it('should track pending movements after starting return home', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const { entity: carrier } = addUnit(gameState, 10, 10);
            carrierManager.createCarrier(carrier.id, tavern.id);

            movementController.startReturnMovement(carrier.id, gameState);

            expect(movementController.hasPendingMovement(carrier.id)).toBe(true);
            const pending = movementController.getPendingMovement(carrier.id);
            expect(pending?.movementType).toBe('return_home');
            expect(pending?.targetBuildingId).toBe(tavern.id);
        });

        it('should clear pending movement', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const target = addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);
            const { entity: carrier } = addUnit(gameState, 6, 6);
            carrierManager.createCarrier(carrier.id, tavern.id);

            movementController.startPickupMovement(carrier.id, target.id, gameState);
            movementController.clearPendingMovement(carrier.id);

            expect(movementController.hasPendingMovement(carrier.id)).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // Status Updates
    // ---------------------------------------------------------------------------

    describe('status updates', () => {
        it('should set carrier status to Walking when starting pickup', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const target = addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);
            const { entity: carrier } = addUnit(gameState, 6, 6);
            carrierManager.createCarrier(carrier.id, tavern.id);

            movementController.startPickupMovement(carrier.id, target.id, gameState);

            expect(carrierManager.getCarrier(carrier.id)?.status).toBe(CarrierStatus.Walking);
        });

        it('should set carrier status to Walking when starting delivery', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const target = addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);
            const { entity: carrier } = addUnit(gameState, 6, 6);
            carrierManager.createCarrier(carrier.id, tavern.id);

            movementController.startDeliveryMovement(carrier.id, target.id, gameState);

            expect(carrierManager.getCarrier(carrier.id)?.status).toBe(CarrierStatus.Walking);
        });

        it('should set carrier status to Walking when starting return home', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const { entity: carrier } = addUnit(gameState, 10, 10);
            carrierManager.createCarrier(carrier.id, tavern.id);

            movementController.startReturnMovement(carrier.id, gameState);

            expect(carrierManager.getCarrier(carrier.id)?.status).toBe(CarrierStatus.Walking);
        });
    });

    // ---------------------------------------------------------------------------
    // Error Cases
    // ---------------------------------------------------------------------------

    describe('error cases', () => {
        it('should return failure result if carrier does not exist', () => {
            const target = addBuilding(gameState, 10, 10, BuildingType.WoodcutterHut, 0);

            const result = movementController.startPickupMovement(999, target.id, gameState);

            expect(result.success).toBe(false);
            expect(result.failureReason).toBe('carrier_not_found');
        });

        it('should return failure result if target building does not exist', () => {
            const tavern = addBuilding(gameState, 5, 5, BuildingType.ResidenceSmall, 0);
            const { entity: carrier } = addUnit(gameState, 6, 6);
            carrierManager.createCarrier(carrier.id, tavern.id);

            const result = movementController.startPickupMovement(carrier.id, 999, gameState);

            expect(result.success).toBe(false);
            expect(result.failureReason).toBe('building_not_found');
        });
    });
});

// ---------------------------------------------------------------------------
// Animation Controller Tests
// ---------------------------------------------------------------------------

describe('CarrierAnimationController', () => {
    let animationController: CarrierAnimationController;
    let gameState: GameState;

    beforeEach(() => {
        animationController = new CarrierAnimationController();
        gameState = createGameState();
    });

    // ---------------------------------------------------------------------------
    // Animation Timing
    // ---------------------------------------------------------------------------

    describe('animation timing', () => {
        it('should track pickup animation timer', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            // Initialize animation state on entity
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            const startTime = 1000;
            animationController.playPickupAnimation(carrier.id, gameState, startTime);

            expect(animationController.hasActiveAnimation(carrier.id)).toBe(true);
            expect(animationController.getActiveAnimationType(carrier.id)).toBe('pickup');
        });

        it('should track drop animation timer', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            const startTime = 1000;
            animationController.playDropAnimation(carrier.id, gameState, startTime);

            expect(animationController.hasActiveAnimation(carrier.id)).toBe(true);
            expect(animationController.getActiveAnimationType(carrier.id)).toBe('drop');
        });

        it('should report animation incomplete before duration', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            const startTime = 1000;
            animationController.playPickupAnimation(carrier.id, gameState, startTime);

            // Check before duration elapsed
            const checkTime = startTime + PICKUP_ANIMATION_DURATION_MS - 100;
            expect(animationController.isAnimationComplete(carrier.id, checkTime)).toBe(false);
        });

        it('should report animation complete after duration', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            const startTime = 1000;
            animationController.playPickupAnimation(carrier.id, gameState, startTime);

            // Check after duration elapsed
            const checkTime = startTime + PICKUP_ANIMATION_DURATION_MS + 100;
            expect(animationController.isAnimationComplete(carrier.id, checkTime)).toBe(true);
        });

        it('should report remaining time correctly', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            const startTime = 1000;
            animationController.playDropAnimation(carrier.id, gameState, startTime);

            const checkTime = startTime + 100;
            const remaining = animationController.getRemainingAnimationTime(carrier.id, checkTime);
            expect(remaining).toBe(DROP_ANIMATION_DURATION_MS - 100);
        });

        it('should return 0 remaining time after completion', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            const startTime = 1000;
            animationController.playDropAnimation(carrier.id, gameState, startTime);

            const checkTime = startTime + DROP_ANIMATION_DURATION_MS + 500;
            const remaining = animationController.getRemainingAnimationTime(carrier.id, checkTime);
            expect(remaining).toBe(0);
        });
    });

    // ---------------------------------------------------------------------------
    // Timer Management
    // ---------------------------------------------------------------------------

    describe('timer management', () => {
        it('should clear animation timer', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            animationController.playPickupAnimation(carrier.id, gameState, 1000);
            animationController.clearAnimationTimer(carrier.id);

            expect(animationController.hasActiveAnimation(carrier.id)).toBe(false);
        });

        it('should get all carriers with active animations', () => {
            const { entity: carrier1 } = addUnit(gameState, 5, 5);
            const { entity: carrier2 } = addUnit(gameState, 10, 10);
            carrier1.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };
            carrier2.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            animationController.playPickupAnimation(carrier1.id, gameState, 1000);
            animationController.playDropAnimation(carrier2.id, gameState, 1000);

            const activeCarriers = animationController.getCarriersWithActiveAnimations();
            expect(activeCarriers).toContain(carrier1.id);
            expect(activeCarriers).toContain(carrier2.id);
            expect(activeCarriers).toHaveLength(2);
        });

        it('should clear all timers', () => {
            const { entity: carrier1 } = addUnit(gameState, 5, 5);
            const { entity: carrier2 } = addUnit(gameState, 10, 10);
            carrier1.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };
            carrier2.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            animationController.playPickupAnimation(carrier1.id, gameState, 1000);
            animationController.playDropAnimation(carrier2.id, gameState, 1000);
            animationController.clear();

            expect(animationController.getCarriersWithActiveAnimations()).toHaveLength(0);
        });
    });

    // ---------------------------------------------------------------------------
    // Animation Sequences
    // ---------------------------------------------------------------------------

    describe('animation sequences', () => {
        it('should set carrying animation with material type', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'default',
                currentFrame: 0,
                elapsedMs: 0,
                direction: 0,
                playing: false,
            };

            animationController.setCarryingAnimation(carrier.id, EMaterialType.LOG, gameState);

            // Animation state should be updated to the carry sequence
            expect(carrier.animationState.sequenceKey).toBe('carry_0'); // LOG is 0
            expect(carrier.animationState.playing).toBe(true);
        });

        it('should clear carrying animation', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            carrier.animationState = {
                sequenceKey: 'carry_0',
                currentFrame: 5,
                elapsedMs: 500,
                direction: 2,
                playing: true,
            };

            animationController.clearCarryingAnimation(carrier.id, gameState);

            expect(carrier.animationState.sequenceKey).toBe('walk');
            expect(carrier.animationState.currentFrame).toBe(0);
            expect(carrier.animationState.playing).toBe(true);
        });
    });

    // ---------------------------------------------------------------------------
    // Edge Cases
    // ---------------------------------------------------------------------------

    describe('edge cases', () => {
        it('should report complete when no animation active', () => {
            expect(animationController.isAnimationComplete(999, 5000)).toBe(true);
        });

        it('should return 0 remaining time when no animation active', () => {
            expect(animationController.getRemainingAnimationTime(999, 5000)).toBe(0);
        });

        it('should return undefined animation type when no animation active', () => {
            expect(animationController.getActiveAnimationType(999)).toBeUndefined();
        });

        it('should handle entity without animation state gracefully', () => {
            const { entity: carrier } = addUnit(gameState, 5, 5);
            // Don't set animationState

            // Should not throw
            animationController.setCarryingAnimation(carrier.id, EMaterialType.LOG, gameState);
            animationController.clearCarryingAnimation(carrier.id, gameState);
            animationController.playPickupAnimation(carrier.id, gameState, 1000);
            animationController.playDropAnimation(carrier.id, gameState, 1000);
        });
    });
});
