import type { GameState } from '../../game-state';
import { EntityType } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { BuildingInventoryManager } from '../../systems/inventory/building-inventory';
import type { Tile } from '../../core/coordinates';
import { distSq } from '../../core/distance';
import { createLogger } from '@/utilities/logger';

const log = createLogger('ToolSourceResolver');

/** Check if a slot kind matches the requested inventory side. */
function slotMatchesSide(kind: SlotKind, side: InventorySide): boolean {
    return side === 'input' ? kind === SlotKind.Input : kind !== SlotKind.Input;
}

export interface ToolSource {
    pileEntityId: number;
    x: number;
    y: number;
}

/** Material cost entry for building-based recruitment. */
export interface MaterialCost {
    readonly material: EMaterialType;
    readonly count: number;
}

/** Which inventory side to reserve from. */
export type InventorySide = 'input' | 'output';

/** Opaque handle returned by reserveBuildingMaterials, used to withdraw or release. */
export interface BuildingReservationHandle {
    readonly id: number;
    readonly buildingId: number;
    readonly costs: readonly MaterialCost[];
    readonly side: InventorySide;
}

export class ToolSourceResolver {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly reservedPiles = new Set<number>();

    /** Per-building withdrawal reservations: buildingId → material → total reserved count. */
    private readonly buildingReservations = new Map<number, Map<EMaterialType, number>>();
    /** All active reservation handles by ID, for release on carrier death. */
    private readonly reservationHandles = new Map<number, BuildingReservationHandle>();
    private nextReservationId = 1;

    constructor(gameState: GameState, inventoryManager: BuildingInventoryManager) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
    }

    findNearestToolPile(material: EMaterialType, nearX: number, nearY: number, player: number): ToolSource | null {
        let bestSource: ToolSource | null = null;
        let bestDistSq = Infinity;

        for (const entity of this.gameState.entityIndex.query(EntityType.StackedPile, player, material)) {
            if (this.reservedPiles.has(entity.id)) {
                continue;
            }

            const slot = this.inventoryManager.getSlotByEntityId(entity.id);
            if (!slot) {
                log.warn(
                    `Orphan pile entity ${entity.id} (${entity.subType}) at (${entity.x},${entity.y}) — no inventory slot`
                );
                continue;
            }
            if (slot.kind === SlotKind.Input) {
                continue;
            }

            const d = distSq(entity, { x: nearX, y: nearY });

            if (d < bestDistSq) {
                bestDistSq = d;
                bestSource = { pileEntityId: entity.id, x: entity.x, y: entity.y };
            }
        }

        return bestSource;
    }

    /**
     * Validate that a specific pile entity is a usable tool source for the given material and player.
     * Returns a ToolSource if valid, null otherwise. Skips input-slot piles and reserved piles.
     */
    validatePile(pileEntityId: number, material: EMaterialType, player: number): ToolSource | null {
        const entity = this.gameState.getEntity(pileEntityId);
        if (!entity) {
            return null;
        }
        if (entity.type !== EntityType.StackedPile || entity.subType !== material || entity.player !== player) {
            return null;
        }
        if (this.reservedPiles.has(pileEntityId)) {
            return null;
        }
        const slot = this.inventoryManager.getSlotByEntityId(pileEntityId);
        if (!slot || slot.kind === SlotKind.Input) {
            return null;
        }
        return { pileEntityId: entity.id, x: entity.x, y: entity.y };
    }

    /**
     * Find the position of the first slot with stock on a building for the given costs.
     * Used as a walk-to destination for building-based recruitment.
     *
     * @param side — 'output' checks output/storage slots (default), 'input' checks input slots.
     */
    findBuildingSlotPosition(
        buildingId: number,
        costs: readonly MaterialCost[],
        side: InventorySide = 'output'
    ): Tile | null {
        const slots = this.inventoryManager.getSlots(buildingId);
        for (const { material } of costs) {
            for (const slot of slots) {
                if (slot.materialType === material && slot.currentAmount > 0 && slotMatchesSide(slot.kind, side)) {
                    return slot.position;
                }
            }
        }
        return null;
    }

    // ─── Pile-level reservation (single-tool recruitment) ────────────────

    reserve(pileEntityId: number): void {
        this.reservedPiles.add(pileEntityId);
    }

    release(pileEntityId: number): void {
        this.reservedPiles.delete(pileEntityId);
    }

    // ─── Building-level reservation (multi-material recruitment) ───────

    /**
     * Check whether a building has enough material for all costs,
     * accounting for existing reservations.
     *
     * @param side — 'output' checks output inventory (default), 'input' checks input inventory.
     */
    hasBuildingMaterials(buildingId: number, costs: readonly MaterialCost[], side: InventorySide = 'output'): boolean {
        const reserved = this.buildingReservations.get(buildingId);
        const getAmount =
            side === 'input'
                ? (mat: EMaterialType) => this.inventoryManager.getInputAmount(buildingId, mat)
                : (mat: EMaterialType) => this.inventoryManager.getOutputAmount(buildingId, mat);

        for (const { material, count } of costs) {
            const available = getAmount(material);
            // eslint-disable-next-line no-restricted-syntax -- Map.get returns undefined for missing keys; 0 is correct default (no reservation)
            const alreadyReserved = reserved?.get(material) ?? 0;
            if (available - alreadyReserved < count) {
                return false;
            }
        }
        return true;
    }

    /**
     * Reserve materials on a building for future withdrawal.
     * Returns a handle used to withdraw or release. Returns null if insufficient stock.
     *
     * @param side — 'output' reserves from output inventory (default), 'input' from input inventory.
     */
    reserveBuildingMaterials(
        buildingId: number,
        costs: readonly MaterialCost[],
        side: InventorySide = 'output'
    ): BuildingReservationHandle | null {
        if (!this.hasBuildingMaterials(buildingId, costs, side)) {
            return null;
        }

        const id = this.nextReservationId++;
        const handle: BuildingReservationHandle = { id, buildingId, costs, side };
        this.reservationHandles.set(id, handle);

        let reserved = this.buildingReservations.get(buildingId);
        if (!reserved) {
            reserved = new Map();
            this.buildingReservations.set(buildingId, reserved);
        }
        for (const { material, count } of costs) {
            // eslint-disable-next-line no-restricted-syntax -- Map.get returns undefined for missing keys; 0 is correct default (first reservation)
            reserved.set(material, (reserved.get(material) ?? 0) + count);
        }

        const costSummary = costs.map(c => c.count + '×' + c.material).join(', ');
        log.debug(`Reserved building ${buildingId} materials [${costSummary}] (handle ${id})`);
        return handle;
    }

    /**
     * Withdraw all reserved materials from the building inventory and release the reservation.
     * Called by the choreo executor when the carrier arrives.
     * Uses the side recorded on the handle (input or output).
     */
    withdrawBuildingReservation(handle: BuildingReservationHandle): boolean {
        const withdraw =
            handle.side === 'input'
                ? (mat: EMaterialType, amt: number) => this.inventoryManager.withdrawInput(handle.buildingId, mat, amt)
                : (mat: EMaterialType, amt: number) =>
                      this.inventoryManager.withdrawOutput(handle.buildingId, mat, amt);

        for (const { material, count } of handle.costs) {
            const withdrawn = withdraw(material, count);
            if (withdrawn < count) {
                log.warn(
                    `Building ${handle.buildingId}: expected ${count} of ${material}, got ${withdrawn} ` +
                        `(handle ${handle.id}) — withdrawing what's available`
                );
            }
        }
        this.releaseReservationBookkeeping(handle);
        return true;
    }

    /**
     * Release a building reservation without withdrawing (carrier died, job cancelled).
     */
    releaseBuildingReservation(reservationId: number): void {
        const handle = this.reservationHandles.get(reservationId);
        if (!handle) {
            return;
        }
        this.releaseReservationBookkeeping(handle);
        log.debug(`Released building reservation (handle ${reservationId}) without withdrawal`);
    }

    getReservationHandle(reservationId: number): BuildingReservationHandle | undefined {
        return this.reservationHandles.get(reservationId);
    }

    private releaseReservationBookkeeping(handle: BuildingReservationHandle): void {
        this.reservationHandles.delete(handle.id);
        const reserved = this.buildingReservations.get(handle.buildingId);
        if (!reserved) {
            return;
        }
        for (const { material, count } of handle.costs) {
            // eslint-disable-next-line no-restricted-syntax -- Map.get returns undefined for missing keys; 0 is correct default
            const current = reserved.get(material) ?? 0;
            const next = current - count;
            if (next <= 0) {
                reserved.delete(material);
            } else {
                reserved.set(material, next);
            }
        }
        if (reserved.size === 0) {
            this.buildingReservations.delete(handle.buildingId);
        }
    }
}
