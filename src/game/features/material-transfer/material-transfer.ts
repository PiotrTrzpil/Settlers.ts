/**
 * MaterialTransfer — Unified material movement & conservation.
 *
 * Single service that owns all cross-container material movement:
 * produce, pickUp, deliver, drop. External code MUST NOT write to
 * entity.carrying directly — only MaterialTransfer sets/clears it.
 *
 * Safety net: onEntityRemoved drops carried material as a free pile
 * so material is never silently lost.
 */

import type { EMaterialType } from '../../economy/material-type';
import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../inventory';
import type { EventBus } from '../../event-bus';
import type { Command, CommandResult } from '../../commands';
import { setCarrying, clearCarrying } from '../../entity';
import { createLogger } from '@/utilities/logger';

const log = createLogger('MaterialTransfer');

export class MaterialTransfer {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly executeCommand: (cmd: Command) => CommandResult;
    private readonly eventBus: EventBus;

    constructor(
        gameState: GameState,
        inventoryManager: BuildingInventoryManager,
        executeCommand: (cmd: Command) => CommandResult,
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
     * Transfer material from a building inventory slot to a carrier.
     * Withdraws from inventory + sets entity.carrying atomically.
     *
     * @param reserved - true: use withdrawReservedOutput (carrier transport)
     *                   false: use withdrawInput (worker pickup)
     * @returns Amount picked up (0 = failed).
     */
    pickUp(
        carrierId: number,
        fromBuilding: number,
        material: EMaterialType,
        amount: number,
        reserved: boolean
    ): number {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'MaterialTransfer.pickUp');

        const withdrawn = reserved
            ? this.inventoryManager.withdrawReservedOutput(fromBuilding, material, amount)
            : this.inventoryManager.withdrawInput(fromBuilding, material, amount);

        if (withdrawn === 0) return 0;

        setCarrying(entity, material, withdrawn);
        return withdrawn;
    }

    /**
     * Transfer material from a carrier to a building inventory slot.
     * Deposits into inventory + clears entity.carrying atomically.
     *
     * If the destination cannot accept all material, the remainder is
     * dropped as a free pile (no material is ever lost).
     *
     * @param slotType - 'input': depositInput (carrier delivery)
     *                   'output': depositOutput (worker PUT_GOOD)
     * @returns Amount deposited.
     */
    deliver(carrierId: number, toBuilding: number, slotType: 'input' | 'output'): number {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'MaterialTransfer.deliver');
        if (!entity.carrying) {
            throw new Error(`MaterialTransfer.deliver: entity ${carrierId} is not carrying anything`);
        }

        const { material, amount } = entity.carrying;

        const deposited =
            slotType === 'input'
                ? this.inventoryManager.depositInput(toBuilding, material, amount)
                : this.inventoryManager.depositOutput(toBuilding, material, amount);

        clearCarrying(entity);

        // Drop overflow as a free pile — never lose material
        const overflow = amount - deposited;
        if (overflow > 0) {
            log.warn(
                `deliver: ${overflow} of material ${material} overflow at building ${toBuilding}, dropping as free pile`
            );
            this.executeCommand({
                type: 'place_pile',
                materialType: material,
                amount: overflow,
                x: entity.x,
                y: entity.y,
            });
        }

        return deposited;
    }

    /**
     * Drop whatever the carrier is holding as a free pile at its current position.
     * No-op if carrier isn't carrying anything.
     * Clears entity.carrying.
     */
    drop(carrierId: number): void {
        const entity = this.gameState.getEntityOrThrow(carrierId, 'MaterialTransfer.drop');
        if (!entity.carrying) return;

        const { material, amount } = entity.carrying;
        clearCarrying(entity);

        this.executeCommand({
            type: 'place_pile',
            materialType: material,
            amount,
            x: entity.x,
            y: entity.y,
        });
    }

    /**
     * Safety net for entity removal. If entity was carrying material, drops it
     * as a free pile. Registered at CLEANUP_PRIORITY.EARLY so it runs before
     * logistics cleanup.
     */
    onEntityRemoved(entityId: number): void {
        const entity = this.gameState.getEntity(entityId);
        if (!entity?.carrying) return;

        const { material, amount } = entity.carrying;
        clearCarrying(entity);

        this.executeCommand({
            type: 'place_pile',
            materialType: material,
            amount,
            x: entity.x,
            y: entity.y,
        });
    }
}
