import type { GameState } from '../../game-state';
import { EntityType } from '../../entity';
import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { BuildingInventoryManager } from '../inventory';
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

/** Materials reserved on a building for one carrier's transform (keyed by the carrier). */
export interface BuildingReservation {
    readonly carrierId: number;
    readonly buildingId: number;
    readonly costs: readonly MaterialCost[];
    readonly side: InventorySide;
}

/**
 * Tool sources for carrier transforms and their reservations.
 *
 * Every reservation is keyed by the carrier that will consume it (not by a transient handle),
 * so a reservation is derivable from the carrier's job and can be re-made on restore. A carrier
 * holds at most one pile or one building reservation at a time.
 */
export class ToolSourceResolver {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    /** Reserved tool piles: pile entity id → carrier id. */
    private readonly pileReservedBy = new Map<number, number>();
    /** carrier id → reserved pile entity id. */
    private readonly pileOfCarrier = new Map<number, number>();

    /** Per-building withdrawal reservations: buildingId → material → total reserved count. */
    private readonly buildingReservations = new Map<number, Map<EMaterialType, number>>();
    /** Building reservations by carrier id. */
    private readonly buildingReservationOfCarrier = new Map<number, BuildingReservation>();

    constructor(gameState: GameState, inventoryManager: BuildingInventoryManager) {
        this.gameState = gameState;
        this.inventoryManager = inventoryManager;
    }

    findNearestToolPile(material: EMaterialType, nearX: number, nearY: number, player: number): ToolSource | null {
        let bestSource: ToolSource | null = null;
        let bestDistSq = Infinity;

        for (const entity of this.gameState.entityIndex.query(EntityType.StackedPile, player, material)) {
            if (this.pileReservedBy.has(entity.id)) {
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
        if (this.pileReservedBy.has(pileEntityId)) {
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

    /** Reserve a tool pile for `carrierId`. The pile must be free and the carrier hold no pile. */
    reservePile(carrierId: number, pileEntityId: number): void {
        const holder = this.pileReservedBy.get(pileEntityId);
        if (holder !== undefined) {
            throw new Error(
                `Tool pile ${pileEntityId} is already reserved by carrier ${holder} (wanted by ${carrierId})`
            );
        }
        if (this.pileOfCarrier.has(carrierId)) {
            throw new Error(`Carrier ${carrierId} already holds tool pile ${this.pileOfCarrier.get(carrierId)}`);
        }
        this.pileReservedBy.set(pileEntityId, carrierId);
        this.pileOfCarrier.set(carrierId, pileEntityId);
    }

    /** Release the tool pile `carrierId` holds. */
    releasePile(carrierId: number): void {
        const pileEntityId = this.pileOfCarrier.get(carrierId);
        if (pileEntityId === undefined) {
            throw new Error(`releasePile: carrier ${carrierId} holds no tool pile`);
        }
        this.pileOfCarrier.delete(carrierId);
        this.pileReservedBy.delete(pileEntityId);
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
     * Reserve materials on a building for `carrierId`'s future withdrawal.
     * Returns false (nothing reserved) if the building lacks unreserved stock.
     */
    reserveBuildingMaterials(
        carrierId: number,
        buildingId: number,
        costs: readonly MaterialCost[],
        side: InventorySide
    ): boolean {
        if (this.buildingReservationOfCarrier.has(carrierId)) {
            throw new Error(`Carrier ${carrierId} already holds a building material reservation`);
        }
        if (!this.hasBuildingMaterials(buildingId, costs, side)) {
            return false;
        }
        this.buildingReservationOfCarrier.set(carrierId, { carrierId, buildingId, costs, side });

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
        log.debug(`Reserved building ${buildingId} materials [${costSummary}] for carrier ${carrierId}`);
        return true;
    }

    /** The building reservation `carrierId` holds. Nullable by design: most carriers hold none. */
    getBuildingReservation(carrierId: number): BuildingReservation | undefined {
        return this.buildingReservationOfCarrier.get(carrierId);
    }

    /**
     * Withdraw `carrierId`'s reserved materials from the building inventory and end the reservation.
     * Called by the TRANSFORM_RECRUIT_BUILDING executor when the carrier arrives.
     */
    withdrawBuildingReservation(carrierId: number): BuildingReservation {
        const reservation = this.takeBuildingReservation(carrierId);
        const { buildingId } = reservation;
        const withdraw =
            reservation.side === 'input'
                ? (mat: EMaterialType, amt: number) => this.inventoryManager.withdrawInput(buildingId, mat, amt)
                : (mat: EMaterialType, amt: number) => this.inventoryManager.withdrawOutput(buildingId, mat, amt);

        for (const { material, count } of reservation.costs) {
            const withdrawn = withdraw(material, count);
            if (withdrawn < count) {
                log.warn(
                    `Building ${buildingId}: expected ${count} of ${material}, got ${withdrawn} ` +
                        `(carrier ${carrierId}) — withdrawing what's available`
                );
            }
        }
        return reservation;
    }

    /** Release `carrierId`'s building reservation without withdrawing (job aborted, carrier died). */
    releaseBuildingReservation(carrierId: number): void {
        const reservation = this.takeBuildingReservation(carrierId);
        log.debug(`Released building ${reservation.buildingId} reservation of carrier ${carrierId} without withdrawal`);
    }

    private takeBuildingReservation(carrierId: number): BuildingReservation {
        const reservation = this.buildingReservationOfCarrier.get(carrierId);
        if (!reservation) {
            throw new Error(`Carrier ${carrierId} holds no building material reservation`);
        }
        this.buildingReservationOfCarrier.delete(carrierId);
        const reserved = this.buildingReservations.get(reservation.buildingId)!;
        for (const { material, count } of reservation.costs) {
            const next = reserved.get(material)! - count;
            if (next <= 0) {
                reserved.delete(material);
            } else {
                reserved.set(material, next);
            }
        }
        if (reserved.size === 0) {
            this.buildingReservations.delete(reservation.buildingId);
        }
        return reservation;
    }
}
