import { describe, it, expect, beforeEach } from 'vitest';
import {
    RequestManager,
    RequestPriority,
    RequestStatus,
    matchRequestToSupply,
    findAllMatches,
    canPotentiallyFulfill,
    estimateFulfillmentDistance,
    getAvailableSupplies,
    getSuppliesInServiceArea,
    hasAnySupply,
    getTotalSupply,
} from '@/game/features/logistics';
import { EMaterialType } from '@/game/economy/material-type';
import { GameState } from '@/game/game-state';
import { EntityType, BuildingType } from '@/game/entity';
import { ServiceAreaManager } from '@/game/features/service-areas';

describe('Resource Request System', () => {
    let requestManager: RequestManager;

    beforeEach(() => {
        requestManager = new RequestManager();
    });

    describe('RequestManager', () => {
        describe('addRequest', () => {
            it('should create a request with correct properties', () => {
                const request = requestManager.addRequest(
                    100, // buildingId
                    EMaterialType.LOG,
                    5,
                    RequestPriority.Normal,
                );

                expect(request.id).toBe(1);
                expect(request.buildingId).toBe(100);
                expect(request.materialType).toBe(EMaterialType.LOG);
                expect(request.amount).toBe(5);
                expect(request.priority).toBe(RequestPriority.Normal);
                expect(request.status).toBe(RequestStatus.Pending);
                expect(request.assignedCarrier).toBeNull();
                expect(request.sourceBuilding).toBeNull();
            });

            it('should increment request IDs', () => {
                const r1 = requestManager.addRequest(100, EMaterialType.LOG, 1);
                const r2 = requestManager.addRequest(101, EMaterialType.STONE, 2);
                const r3 = requestManager.addRequest(102, EMaterialType.BOARD, 3);

                expect(r1.id).toBe(1);
                expect(r2.id).toBe(2);
                expect(r3.id).toBe(3);
            });

            it('should clamp amount to at least 1', () => {
                const r1 = requestManager.addRequest(100, EMaterialType.LOG, 0);
                const r2 = requestManager.addRequest(100, EMaterialType.LOG, -5);

                expect(r1.amount).toBe(1);
                expect(r2.amount).toBe(1);
            });
        });

        describe('getPendingRequests', () => {
            it('should return requests sorted by priority then timestamp', () => {
                // Add in reverse priority order
                const low = requestManager.addRequest(100, EMaterialType.LOG, 1, RequestPriority.Low);
                const high = requestManager.addRequest(101, EMaterialType.STONE, 1, RequestPriority.High);
                const normal = requestManager.addRequest(102, EMaterialType.BOARD, 1, RequestPriority.Normal);

                const pending = requestManager.getPendingRequests();

                expect(pending.length).toBe(3);
                expect(pending[0].id).toBe(high.id); // High priority first
                expect(pending[1].id).toBe(normal.id); // Then normal
                expect(pending[2].id).toBe(low.id); // Then low
            });

            it('should order same-priority requests by timestamp', () => {
                const r1 = requestManager.addRequest(100, EMaterialType.LOG, 1, RequestPriority.Normal);
                const r2 = requestManager.addRequest(101, EMaterialType.STONE, 1, RequestPriority.Normal);
                const r3 = requestManager.addRequest(102, EMaterialType.BOARD, 1, RequestPriority.Normal);

                const pending = requestManager.getPendingRequests();

                expect(pending[0].id).toBe(r1.id);
                expect(pending[1].id).toBe(r2.id);
                expect(pending[2].id).toBe(r3.id);
            });

            it('should not include in-progress requests', () => {
                const r1 = requestManager.addRequest(100, EMaterialType.LOG, 1);
                requestManager.addRequest(101, EMaterialType.STONE, 1);

                requestManager.assignRequest(r1.id, 200, 300);

                const pending = requestManager.getPendingRequests();

                expect(pending.length).toBe(1);
                expect(pending[0].materialType).toBe(EMaterialType.STONE);
            });
        });

        describe('assignRequest', () => {
            it('should mark request as in-progress', () => {
                const request = requestManager.addRequest(100, EMaterialType.LOG, 5);

                const result = requestManager.assignRequest(request.id, 200, 300);

                expect(result).toBe(true);
                expect(request.status).toBe(RequestStatus.InProgress);
                expect(request.sourceBuilding).toBe(200);
                expect(request.assignedCarrier).toBe(300);
            });

            it('should not assign already in-progress request', () => {
                const request = requestManager.addRequest(100, EMaterialType.LOG, 5);
                requestManager.assignRequest(request.id, 200, 300);

                const result = requestManager.assignRequest(request.id, 201, 301);

                expect(result).toBe(false);
            });

            it('should not assign non-existent request', () => {
                const result = requestManager.assignRequest(999, 200, 300);

                expect(result).toBe(false);
            });
        });

        describe('fulfillRequest', () => {
            it('should mark in-progress request as fulfilled and remove it', () => {
                const request = requestManager.addRequest(100, EMaterialType.LOG, 5);
                requestManager.assignRequest(request.id, 200, 300);

                const result = requestManager.fulfillRequest(request.id);

                expect(result).toBe(true);
                expect(requestManager.getRequest(request.id)).toBeUndefined();
            });

            it('should not fulfill pending request', () => {
                const request = requestManager.addRequest(100, EMaterialType.LOG, 5);

                const result = requestManager.fulfillRequest(request.id);

                expect(result).toBe(false);
            });
        });

        describe('cancelRequestsForBuilding', () => {
            it('should cancel all requests for a building', () => {
                requestManager.addRequest(100, EMaterialType.LOG, 1);
                requestManager.addRequest(100, EMaterialType.STONE, 2);
                requestManager.addRequest(101, EMaterialType.BOARD, 3);

                const cancelled = requestManager.cancelRequestsForBuilding(100);

                expect(cancelled).toBe(2);
                expect(requestManager.getPendingCount()).toBe(1);
            });
        });

        describe('cancelRequestsForCarrier', () => {
            it('should reset in-progress requests to pending', () => {
                const r1 = requestManager.addRequest(100, EMaterialType.LOG, 1);
                const r2 = requestManager.addRequest(101, EMaterialType.STONE, 2);

                requestManager.assignRequest(r1.id, 200, 300);
                requestManager.assignRequest(r2.id, 201, 300); // Same carrier

                const cancelled = requestManager.cancelRequestsForCarrier(300);

                expect(cancelled).toBe(2);
                expect(r1.status).toBe(RequestStatus.Pending);
                expect(r1.assignedCarrier).toBeNull();
                expect(r2.status).toBe(RequestStatus.Pending);
            });
        });

        describe('getRequestsForBuilding', () => {
            it('should return all requests for a building', () => {
                requestManager.addRequest(100, EMaterialType.LOG, 1);
                requestManager.addRequest(100, EMaterialType.STONE, 2);
                requestManager.addRequest(101, EMaterialType.BOARD, 3);

                const requests = requestManager.getRequestsForBuilding(100);

                expect(requests.length).toBe(2);
            });
        });

        describe('hasPendingRequest', () => {
            it('should return true when pending request exists', () => {
                requestManager.addRequest(100, EMaterialType.LOG, 1);

                expect(requestManager.hasPendingRequest(100, EMaterialType.LOG)).toBe(true);
            });

            it('should return false for wrong material', () => {
                requestManager.addRequest(100, EMaterialType.LOG, 1);

                expect(requestManager.hasPendingRequest(100, EMaterialType.STONE)).toBe(false);
            });

            it('should return false for in-progress request', () => {
                const request = requestManager.addRequest(100, EMaterialType.LOG, 1);
                requestManager.assignRequest(request.id, 200, 300);

                expect(requestManager.hasPendingRequest(100, EMaterialType.LOG)).toBe(false);
            });
        });
    });
});

describe('Resource Supply System', () => {
    let gameState: GameState;

    beforeEach(() => {
        gameState = new GameState();
    });

    /**
     * Helper to create a building with inventory.
     * Without GameLoop, we need to manually create the inventory.
     */
    function createBuildingWithInventory(
        buildingType: BuildingType,
        x: number,
        y: number,
        player: number = 0,
    ) {
        const building = gameState.addEntity(EntityType.Building, buildingType, x, y, player);
        gameState.inventoryManager.createInventory(building.id, buildingType);
        return building;
    }

    describe('getAvailableSupplies', () => {
        it('should find buildings with material in output', () => {
            // Create a building with inventory
            const building = createBuildingWithInventory(BuildingType.WoodcutterHut, 10, 10, 0);

            // Deposit some logs in output
            gameState.inventoryManager.depositOutput(building.id, EMaterialType.LOG, 5);

            const supplies = getAvailableSupplies(gameState, EMaterialType.LOG);

            expect(supplies.length).toBe(1);
            expect(supplies[0].buildingId).toBe(building.id);
            expect(supplies[0].materialType).toBe(EMaterialType.LOG);
            expect(supplies[0].availableAmount).toBe(5);
        });

        it('should return empty array when no supplies exist', () => {
            const supplies = getAvailableSupplies(gameState, EMaterialType.LOG);

            expect(supplies.length).toBe(0);
        });

        it('should respect minAmount filter', () => {
            const building = createBuildingWithInventory(BuildingType.WoodcutterHut, 10, 10, 0);
            gameState.inventoryManager.depositOutput(building.id, EMaterialType.LOG, 3);

            const suppliesMin5 = getAvailableSupplies(gameState, EMaterialType.LOG, { minAmount: 5 });
            const suppliesMin2 = getAvailableSupplies(gameState, EMaterialType.LOG, { minAmount: 2 });

            expect(suppliesMin5.length).toBe(0);
            expect(suppliesMin2.length).toBe(1);
        });
    });

    describe('getSuppliesInServiceArea', () => {
        it('should only return supplies within service area', () => {
            const serviceAreaManager = new ServiceAreaManager();

            // Create hub with service area
            const hub = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 10, 10, 0);
            serviceAreaManager.createServiceArea(hub.id, 0, 10, 10, 15);

            // Create building inside service area
            const insideBuilding = createBuildingWithInventory(BuildingType.WoodcutterHut, 15, 10, 0);
            gameState.inventoryManager.depositOutput(insideBuilding.id, EMaterialType.LOG, 5);

            // Create building outside service area
            const outsideBuilding = createBuildingWithInventory(BuildingType.WoodcutterHut, 50, 50, 0);
            gameState.inventoryManager.depositOutput(outsideBuilding.id, EMaterialType.LOG, 5);

            const supplies = getSuppliesInServiceArea(
                gameState,
                EMaterialType.LOG,
                serviceAreaManager,
                hub.id,
            );

            expect(supplies.length).toBe(1);
            expect(supplies[0].buildingId).toBe(insideBuilding.id);
        });
    });

    describe('hasAnySupply', () => {
        it('should return true when supply exists', () => {
            const building = createBuildingWithInventory(BuildingType.WoodcutterHut, 10, 10, 0);
            gameState.inventoryManager.depositOutput(building.id, EMaterialType.LOG, 1);

            expect(hasAnySupply(gameState, EMaterialType.LOG)).toBe(true);
        });

        it('should return false when no supply exists', () => {
            expect(hasAnySupply(gameState, EMaterialType.LOG)).toBe(false);
        });
    });

    describe('getTotalSupply', () => {
        it('should sum supplies across all buildings', () => {
            const b1 = createBuildingWithInventory(BuildingType.WoodcutterHut, 10, 10, 0);
            const b2 = createBuildingWithInventory(BuildingType.WoodcutterHut, 20, 20, 0);

            gameState.inventoryManager.depositOutput(b1.id, EMaterialType.LOG, 5);
            gameState.inventoryManager.depositOutput(b2.id, EMaterialType.LOG, 3);

            const total = getTotalSupply(gameState, EMaterialType.LOG);

            expect(total).toBe(8);
        });
    });
});

describe('Fulfillment Matcher', () => {
    let gameState: GameState;
    let serviceAreaManager: ServiceAreaManager;
    let requestManager: RequestManager;

    beforeEach(() => {
        gameState = new GameState();
        serviceAreaManager = new ServiceAreaManager();
        requestManager = new RequestManager();
    });

    /**
     * Helper to create a building with inventory.
     * Without GameLoop, we need to manually create the inventory.
     */
    function createBuildingWithInventory(
        buildingType: BuildingType,
        x: number,
        y: number,
        player: number = 0,
    ) {
        const building = gameState.addEntity(EntityType.Building, buildingType, x, y, player);
        gameState.inventoryManager.createInventory(building.id, buildingType);
        return building;
    }

    describe('matchRequestToSupply', () => {
        it('should match request to nearest supply within service area', () => {
            // Create hub at center with service area
            const hub = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 20, 20, 0);
            serviceAreaManager.createServiceArea(hub.id, 0, 20, 20, 30);

            // Create destination (sawmill needing logs)
            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 15, 20, 0);

            // Create two woodcutters at different distances
            const nearWoodcutter = createBuildingWithInventory(BuildingType.WoodcutterHut, 18, 20, 0);
            gameState.inventoryManager.depositOutput(nearWoodcutter.id, EMaterialType.LOG, 5);

            const farWoodcutter = createBuildingWithInventory(BuildingType.WoodcutterHut, 25, 20, 0);
            gameState.inventoryManager.depositOutput(farWoodcutter.id, EMaterialType.LOG, 5);

            // Create request
            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);

            // Match
            const match = matchRequestToSupply(request, gameState, serviceAreaManager);

            expect(match).not.toBeNull();
            expect(match!.sourceBuilding).toBe(nearWoodcutter.id);
            expect(match!.distance).toBe(3); // hex distance
        });

        it('should return null when no supply exists', () => {
            const hub = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 20, 20, 0);
            serviceAreaManager.createServiceArea(hub.id, 0, 20, 20, 30);

            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 15, 20, 0);
            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);

            const match = matchRequestToSupply(request, gameState, serviceAreaManager);

            expect(match).toBeNull();
        });

        it('should return null when supply is outside service area', () => {
            const hub = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 20, 20, 0);
            serviceAreaManager.createServiceArea(hub.id, 0, 20, 20, 5); // Small radius

            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 22, 20, 0);

            // Woodcutter far outside service area
            const woodcutter = createBuildingWithInventory(BuildingType.WoodcutterHut, 50, 50, 0);
            gameState.inventoryManager.depositOutput(woodcutter.id, EMaterialType.LOG, 5);

            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);
            const match = matchRequestToSupply(request, gameState, serviceAreaManager);

            expect(match).toBeNull();
        });

        it('should not match source to itself', () => {
            const hub = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 20, 20, 0);
            serviceAreaManager.createServiceArea(hub.id, 0, 20, 20, 30);

            // Building has material in its own output
            const building = createBuildingWithInventory(BuildingType.Sawmill, 15, 20, 0);
            gameState.inventoryManager.depositOutput(building.id, EMaterialType.LOG, 5);

            const request = requestManager.addRequest(building.id, EMaterialType.LOG, 4);
            const match = matchRequestToSupply(request, gameState, serviceAreaManager);

            expect(match).toBeNull();
        });

        it('should work without requiring service area when option is false', () => {
            // No service areas created
            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 15, 20, 0);

            const woodcutter = createBuildingWithInventory(BuildingType.WoodcutterHut, 50, 50, 0);
            gameState.inventoryManager.depositOutput(woodcutter.id, EMaterialType.LOG, 5);

            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);
            const match = matchRequestToSupply(request, gameState, serviceAreaManager, {
                requireServiceArea: false,
            });

            expect(match).not.toBeNull();
            expect(match!.sourceBuilding).toBe(woodcutter.id);
        });
    });

    describe('findAllMatches', () => {
        it('should return all valid matches sorted by distance', () => {
            const hub = gameState.addEntity(EntityType.Building, BuildingType.ResidenceSmall, 20, 20, 0);
            serviceAreaManager.createServiceArea(hub.id, 0, 20, 20, 30);

            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 20, 20, 0);

            // Create woodcutters at distinct distances for reliable ordering
            const wcNear = createBuildingWithInventory(BuildingType.WoodcutterHut, 22, 20, 0);
            gameState.inventoryManager.depositOutput(wcNear.id, EMaterialType.LOG, 3);

            const wcFar = createBuildingWithInventory(BuildingType.WoodcutterHut, 27, 20, 0);
            gameState.inventoryManager.depositOutput(wcFar.id, EMaterialType.LOG, 5);

            const wcMid = createBuildingWithInventory(BuildingType.WoodcutterHut, 24, 20, 0);
            gameState.inventoryManager.depositOutput(wcMid.id, EMaterialType.LOG, 2);

            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);
            const matches = findAllMatches(request, gameState, serviceAreaManager);

            expect(matches.length).toBe(3);
            // Should be sorted by distance (nearest first)
            expect(matches[0].distance).toBe(2);  // wcNear at (22,20)
            expect(matches[1].distance).toBe(4);  // wcMid at (24,20)
            expect(matches[2].distance).toBe(7);  // wcFar at (27,20)
            expect(matches[0].sourceBuilding).toBe(wcNear.id);
            expect(matches[1].sourceBuilding).toBe(wcMid.id);
            expect(matches[2].sourceBuilding).toBe(wcFar.id);
        });
    });

    describe('canPotentiallyFulfill', () => {
        it('should return true when supply exists elsewhere', () => {
            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 15, 20, 0);
            const woodcutter = createBuildingWithInventory(BuildingType.WoodcutterHut, 25, 20, 0);
            gameState.inventoryManager.depositOutput(woodcutter.id, EMaterialType.LOG, 5);

            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);

            expect(canPotentiallyFulfill(request, gameState)).toBe(true);
        });

        it('should return false when destination does not exist', () => {
            const request = requestManager.addRequest(999, EMaterialType.LOG, 4);

            expect(canPotentiallyFulfill(request, gameState)).toBe(false);
        });

        it('should return false when only supply is at destination', () => {
            const building = createBuildingWithInventory(BuildingType.Sawmill, 15, 20, 0);
            gameState.inventoryManager.depositOutput(building.id, EMaterialType.LOG, 5);

            const request = requestManager.addRequest(building.id, EMaterialType.LOG, 4);

            expect(canPotentiallyFulfill(request, gameState)).toBe(false);
        });
    });

    describe('estimateFulfillmentDistance', () => {
        it('should return minimum distance to any supply', () => {
            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 20, 20, 0);

            const wc1 = createBuildingWithInventory(BuildingType.WoodcutterHut, 25, 20, 0);
            gameState.inventoryManager.depositOutput(wc1.id, EMaterialType.LOG, 5);

            const wc2 = createBuildingWithInventory(BuildingType.WoodcutterHut, 22, 20, 0);
            gameState.inventoryManager.depositOutput(wc2.id, EMaterialType.LOG, 5);

            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);
            const distance = estimateFulfillmentDistance(request, gameState);

            expect(distance).toBe(2); // Nearest is wc2 at distance 2
        });

        it('should return Infinity when no supply exists', () => {
            const sawmill = createBuildingWithInventory(BuildingType.Sawmill, 20, 20, 0);
            const request = requestManager.addRequest(sawmill.id, EMaterialType.LOG, 4);

            const distance = estimateFulfillmentDistance(request, gameState);

            expect(distance).toBe(Infinity);
        });
    });
});

describe('Priority and Ordering', () => {
    let requestManager: RequestManager;

    beforeEach(() => {
        requestManager = new RequestManager();
    });

    it('should process high priority requests before normal', () => {
        const normal = requestManager.addRequest(100, EMaterialType.LOG, 1, RequestPriority.Normal);
        const high = requestManager.addRequest(101, EMaterialType.STONE, 1, RequestPriority.High);

        const pending = requestManager.getPendingRequests();

        expect(pending[0].id).toBe(high.id);
        expect(pending[1].id).toBe(normal.id);
    });

    it('should process older requests first at same priority', () => {
        const first = requestManager.addRequest(100, EMaterialType.LOG, 1, RequestPriority.Normal);
        const second = requestManager.addRequest(101, EMaterialType.STONE, 1, RequestPriority.Normal);

        const pending = requestManager.getPendingRequests();

        expect(pending[0].id).toBe(first.id);
        expect(pending[1].id).toBe(second.id);
    });
});
