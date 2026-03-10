/**
 * InventoryPileSync — event-driven synchronization between BuildingInventoryManager
 * and pile entities.
 *
 * Listens for inventory changes and entity lifecycle events, then creates, updates,
 * or removes StackedPile pile entities via the command pipeline to keep visual
 * piles in sync with building inventory state.
 *
 * Replaces InventoryVisualizer with a pile-system-aware implementation that uses
 * PileRegistry for entity tracking and PilePositionResolver for position resolution.
 */

import type { GameState } from '../../game-state';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { InventoryChangeCallback } from '../../systems/inventory/building-inventory';
import { BuildingType, EntityType } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import type { Command, CommandResult } from '../../commands';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { createLogger } from '@/utilities/logger';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import type { PileRegistry } from '../../systems/inventory/pile-registry';
import type { PileSlotKey } from '../../systems/inventory/pile-registry';
import type { PilePositionResolver } from '../../systems/inventory/pile-position-resolver';
import type { PileKind, LinkedSlotKind } from '../../core/pile-kind';
import { SlotKind } from '../../core/pile-kind';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import { CONSTRUCTION_PILE_CAPACITY } from '../../systems/inventory/construction-pile-positions';

const log = createLogger('InventoryPileSync');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildKind(slotKind: LinkedSlotKind, buildingId: number): PileKind {
    return { kind: slotKind, buildingId };
}

function extractEntityIdFromResult(result: CommandResult): number {
    const effect = result.effects?.[0];
    if (!effect || effect.type !== 'entity_created') {
        throw new Error('spawn_pile: expected entity_created effect');
    }
    return (effect as { type: 'entity_created'; entityId: number }).entityId;
}

// ─────────────────────────────────────────────────────────────────────────────
// InventoryPileSync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronizes building inventory state to pile entities via the command pipeline.
 *
 * - On inventory change: spawns, updates, or removes pile entities as needed.
 * - On building:completed: removes all construction-phase piles for that building.
 * - On entity removed (building): converts linked piles to free piles (they survive).
 */
export class InventoryPileSync {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly constructionSiteManager: ConstructionSiteManager;
    private readonly pileRegistry: PileRegistry;
    private readonly pilePositionResolver: PilePositionResolver;
    private readonly executeCommand: (cmd: Command) => CommandResult;

    private readonly subscriptions = new EventSubscriptionManager();
    private readonly changeHandler: InventoryChangeCallback;
    private eventBus: EventBus | null = null;

    constructor(
        gameState: GameState,
        inventoryManager: BuildingInventoryManager,
        constructionSiteManager: ConstructionSiteManager,
        pileRegistry: PileRegistry,
        pilePositionResolver: PilePositionResolver,
        executeCommand: (cmd: Command) => CommandResult
    ) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
        this.constructionSiteManager = constructionSiteManager;
        this.pileRegistry = pileRegistry;
        this.pilePositionResolver = pilePositionResolver;
        this.executeCommand = executeCommand;

        this.changeHandler = this.onInventoryChange.bind(this);
        this.inventoryManager.onChange(this.changeHandler);
    }

    /**
     * Subscribe to entity lifecycle events.
     * - building:completed  → clear construction piles before operational phase begins.
     * - entity:removed      → convert linked piles to free piles when building is destroyed.
     */
    registerEvents(eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void {
        this.eventBus = eventBus;
        this.subscriptions.subscribe(eventBus, 'building:completed', ({ entityId }) => {
            this.onBuildingCompleted(entityId);
        });

        cleanupRegistry.onEntityRemoved((entityId: number) => {
            this.onBuildingRemoved(entityId);
        });
    }

    /** Unsubscribe from all tracked EventBus subscriptions. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Clean up all subscriptions and the inventory change listener. */
    dispose(): void {
        this.unregisterEvents();
        this.inventoryManager.offChange(this.changeHandler);
    }

    /**
     * Rebuild registry index from existing StackedPile entities.
     * Called only for HMR recovery — reconnects the registry to pre-existing pile entities.
     */
    rebuildFromExistingEntities(): void {
        this.pileRegistry.rebuildFromEntities(
            this.gameState.entities.filter(e => e.type === EntityType.StackedPile),
            this.gameState.piles
        );
    }

    // ─── Event Handlers ──────────────────────────────────────────────────────

    /**
     * Handle inventory change events from BuildingInventoryManager.
     *
     * Determines the slotKind based on construction state and building type,
     * then creates, updates, or removes pile entities as needed.
     */
    private onInventoryChange(
        buildingId: number,
        materialType: EMaterialType,
        slotType: 'input' | 'output',
        _previousAmount: number,
        newAmount: number
    ): void {
        log.debug(`onChange: building=${buildingId}, ${EMaterialType[materialType]}, ${slotType}, amount=${newAmount}`);

        // Entity may have been removed between the inventory change and this callback
        // (e.g. building destroyed while carrier was en-route). Bail out — cleanup
        // handlers already converted any linked piles to free piles.
        const entity = this.gameState.getEntity(buildingId);
        if (!entity) return;

        // Free piles: the pile entity already exists — no sync needed.
        // Quantity updates are handled by GameServices.onInventoryChanged.
        if (entity.type === EntityType.StackedPile) return;

        const slotKind = this.resolveSlotKind(buildingId, slotType);

        // Construction piles: distribute across multiple pile entities (8 items each)
        if (slotKind === SlotKind.Construction) {
            this.syncConstructionPiles(buildingId, materialType, newAmount);
            return;
        }

        const key: PileSlotKey = { buildingId, material: materialType, slotKind };
        const existingEntityId = this.pileRegistry.getEntityId(key);

        if (existingEntityId !== undefined) {
            if (newAmount > 0) {
                this.executeCommand({ type: 'update_pile_quantity', entityId: existingEntityId, quantity: newAmount });
            } else {
                this.executeCommand({ type: 'remove_entity', entityId: existingEntityId });
                this.pileRegistry.deregister(existingEntityId);
            }
        } else {
            if (newAmount > 0) {
                this.spawnPileForSlot(buildingId, materialType, slotKind, newAmount, key);
            }
            // quantity 0 and no entity — no-op
        }
    }

    /**
     * Handle building:completed events.
     *
     * Clears all construction-phase piles for the completed building BEFORE
     * GameServices transitions the building to its operational inventory.
     * (Guaranteed by subscription order in InventoryFeature.)
     */
    private onBuildingCompleted(entityId: number): void {
        log.debug(`onBuildingCompleted: buildingId=${entityId}`);
        const cleared = this.pileRegistry.clearBuilding(entityId);
        for (const [, pileEntityId] of cleared) {
            this.executeCommand({ type: 'remove_entity', entityId: pileEntityId });
        }
    }

    /**
     * Handle entity removal (at DEFAULT priority via EntityCleanupRegistry).
     *
     * When a building is destroyed, its linked piles are converted to free piles
     * rather than removed — they remain on the ground for carriers to pick up.
     * Emits pile:freePilePlaced so the logistics system can discover the pile
     * as an output source and reassign carriers.
     */
    private onBuildingRemoved(buildingId: number): void {
        const cleared = this.pileRegistry.clearBuilding(buildingId);
        const convertedPiles = new Map<EMaterialType, number>();

        for (const [, pileEntityId] of cleared) {
            this.gameState.piles.setKind(pileEntityId, { kind: SlotKind.Free });
            const entity = this.gameState.getEntity(pileEntityId);
            if (!entity || entity.type !== EntityType.StackedPile) continue;
            const materialType = entity.subType as EMaterialType;
            const quantity = this.gameState.piles.getQuantity(pileEntityId);
            if (quantity <= 0) continue;
            this.eventBus?.emit('pile:freePilePlaced', {
                entityId: pileEntityId,
                materialType,
                quantity,
            });
            convertedPiles.set(materialType, pileEntityId);
        }

        if (convertedPiles.size > 0) {
            this.eventBus?.emit('pile:buildingPilesConverted', { buildingId, piles: convertedPiles });
        }
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    /**
     * Determine the LinkedSlotKind for an inventory slot.
     *
     * Priority:
     * 1. If building has an active construction site → 'construction'
     * 2. If building is a StorageArea → 'storage'
     * 3. If slotType === 'output' → 'output'
     * 4. Otherwise → 'input'
     */
    private resolveSlotKind(buildingId: number, slotType: 'input' | 'output'): LinkedSlotKind {
        if (this.constructionSiteManager.hasSite(buildingId)) {
            return SlotKind.Construction;
        }

        const building = this.gameState.getEntityOrThrow(buildingId, 'resolveSlotKind');
        if ((building.subType as BuildingType) === BuildingType.StorageArea) {
            return SlotKind.Storage;
        }

        return slotType === 'output' ? SlotKind.Output : SlotKind.Input;
    }

    /**
     * Spawn a new pile entity for a given inventory slot.
     * Resolves position via PilePositionResolver and issues a spawn_pile command.
     * Logs a warning if no position is available (e.g. construction staging full).
     */
    private spawnPileForSlot(
        buildingId: number,
        materialType: EMaterialType,
        slotKind: LinkedSlotKind,
        newAmount: number,
        key: PileSlotKey
    ): void {
        const building = this.gameState.getEntityOrThrow(buildingId, 'onInventoryChange');
        const usedPositions = this.pileRegistry.getUsedPositions(buildingId);

        const position = this.pilePositionResolver.resolvePosition({
            buildingId,
            building,
            material: materialType,
            slotKind,
            usedPositions,
        });

        if (position === null) {
            log.warn(
                `No pile position for building=${buildingId}, material=${EMaterialType[materialType]}, ` +
                    `slotKind=${slotKind} — will retry on next change`
            );
            return;
        }

        const result = this.executeCommand({
            type: 'spawn_pile',
            materialType,
            x: position.x,
            y: position.y,
            player: building.player,
            quantity: newAmount,
            kind: buildKind(slotKind, buildingId),
        });

        const entityId = extractEntityIdFromResult(result);
        this.pileRegistry.register(entityId, key, position);
    }

    // ─── Construction pile distribution ──────────────────────────────────────

    /**
     * Distribute a material's total quantity across multiple construction pile entities,
     * each holding at most CONSTRUCTION_PILE_CAPACITY (8) items.
     *
     * For each pile index:
     *   - quantity > 0 and no entity → spawn
     *   - quantity > 0 and entity exists → update
     *   - quantity = 0 and entity exists → remove
     */
    private syncConstructionPiles(buildingId: number, materialType: EMaterialType, totalAmount: number): void {
        const positions = this.constructionSiteManager.getConstructionPilePositions(buildingId, materialType);
        if (!positions || positions.length === 0) {
            log.warn(
                `No construction pile positions for building=${buildingId}, ` +
                    `material=${EMaterialType[materialType]}`
            );
            return;
        }

        const building = this.gameState.getEntityOrThrow(buildingId, 'syncConstructionPiles');
        let remaining = totalAmount;

        for (let i = 0; i < positions.length; i++) {
            const pileQty = Math.min(remaining, CONSTRUCTION_PILE_CAPACITY);
            remaining -= pileQty;

            const key: PileSlotKey = {
                buildingId,
                material: materialType,
                slotKind: SlotKind.Construction,
                pileIndex: i,
            };
            const existingEntityId = this.pileRegistry.getEntityId(key);

            if (pileQty > 0) {
                if (existingEntityId !== undefined) {
                    this.executeCommand({
                        type: 'update_pile_quantity',
                        entityId: existingEntityId,
                        quantity: pileQty,
                    });
                } else {
                    const position = positions[i]!;
                    const result = this.executeCommand({
                        type: 'spawn_pile',
                        materialType,
                        x: position.x,
                        y: position.y,
                        player: building.player,
                        quantity: pileQty,
                        kind: buildKind(SlotKind.Construction, buildingId),
                    });
                    const entityId = extractEntityIdFromResult(result);
                    this.pileRegistry.register(entityId, key, position);
                }
            } else if (existingEntityId !== undefined) {
                this.executeCommand({ type: 'remove_entity', entityId: existingEntityId });
                this.pileRegistry.deregister(existingEntityId);
            }
        }
    }
}
