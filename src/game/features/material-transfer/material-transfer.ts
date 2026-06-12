/**
 * MaterialTransfer — Unified material movement & conservation.
 *
 * Single service that owns all cross-container material movement:
 * produce, pickUpOutput/pickUpInput, drop. Building deposits go through
 * BuildingInventoryManager (depositDelivery for carriers, depositOutput for
 * workers). External code MUST NOT write to
 * entity.carrying directly — only MaterialTransfer sets/clears it.
 *
 * Safety net: onEntityRemoved drops carried material as a free pile
 * so material is never silently lost.
 */

import type { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import type { EventBus } from '../../event-bus';
import type { CommandExecutor, CommandResult } from '../../commands';
import { type Entity, type Tile, setCarrying, clearCarrying } from '../../entity';
import { findNearestTile } from '../../systems/spatial-search';
import { createLogger } from '@/utilities/logger';

const log = createLogger('MaterialTransfer');

export class MaterialTransfer {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly executeCommand: CommandExecutor;
    private readonly eventBus: EventBus;

    constructor(
        gameState: GameState,
        inventoryManager: BuildingInventoryManager,
        executeCommand: CommandExecutor,
        eventBus: EventBus
    ) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
        this.executeCommand = executeCommand;
        this.eventBus = eventBus;
    }

    /**
     * Material appears from nothing onto a carrier (resource gathering).
     * Sets entity.carrying.
     */
    produce(carrierId: number, material: EMaterialType, amount: number): void {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'MaterialTransfer.produce');
        setCarrying(entity, material, amount);
    }

    /**
     * Carrier transport pickup: withdraw from the source building's
     * output/storage/free slots + set entity.carrying atomically.
     * @returns Amount picked up (0 = failed).
     */
    pickUpOutput(carrierId: number, fromBuilding: number, material: EMaterialType, amount: number): number {
        return this.withdrawOntoCarrier(carrierId, material, () =>
            this.inventoryManager.withdrawOutput(fromBuilding, material, amount)
        );
    }

    /**
     * Worker fetch: withdraw from the building's input slots (production
     * inputs consumed by the worker) + set entity.carrying atomically.
     * @returns Amount picked up (0 = failed).
     */
    pickUpInput(carrierId: number, fromBuilding: number, material: EMaterialType, amount: number): number {
        return this.withdrawOntoCarrier(carrierId, material, () =>
            this.inventoryManager.withdrawInput(fromBuilding, material, amount)
        );
    }

    private withdrawOntoCarrier(carrierId: number, material: EMaterialType, withdraw: () => number): number {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'MaterialTransfer.pickUp');
        const withdrawn = withdraw();
        if (withdrawn === 0) {
            return 0;
        }
        setCarrying(entity, material, withdrawn);
        return withdrawn;
    }

    /**
     * Drop whatever the carrier is holding as a free pile at its current position.
     * No-op if carrier isn't carrying anything.
     * Clears entity.carrying.
     */
    drop(carrierId: number): void {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'MaterialTransfer.drop');
        if (!entity.carrying) {
            return;
        }

        const { material, amount } = entity.carrying;
        clearCarrying(entity);

        this.placePileNear(entity, material, amount);
    }

    /**
     * Safety net for entity removal. If entity was carrying material, drops it
     * as a free pile. Registered at CLEANUP_PRIORITY.EARLY so it runs before
     * logistics cleanup.
     */
    onEntityRemoved(_entityId: number, entity: Entity): void {
        if (!entity.carrying) {
            return;
        }

        const { material, amount } = entity.carrying;
        clearCarrying(entity);

        this.placePileNear(entity, material, amount);
    }

    /**
     * Place a free pile at or near the given position.
     * If the tile is occupied, searches nearby tiles within radius 3.
     */
    private placePileNear(pos: Tile, material: EMaterialType, amount: number): void {
        const result = this.tryPlacePile(pos.x, pos.y, material, amount);
        if (result.success) {
            return;
        }

        const free = findNearestTile(pos, 3, tile => !this.gameState.getGroundEntityAt(tile));
        if (free) {
            this.tryPlacePile(free.x, free.y, material, amount);
        } else {
            log.warn(`placePileNear: no free tile near (${pos.x}, ${pos.y}) — ${amount}x ${material} lost`);
        }
    }

    private tryPlacePile(x: number, y: number, material: EMaterialType, amount: number): CommandResult {
        return this.executeCommand({ type: 'place_pile', materialType: material, amount, x, y });
    }
}
