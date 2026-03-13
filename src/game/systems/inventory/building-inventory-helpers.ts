/**
 * BuildingInventoryManager helpers — pile entity management, serialization types,
 * and production query helpers.
 *
 * Separated to keep building-inventory.ts under the 600-line limit.
 */

import { EMaterialType } from '../../economy/material-type';
import { BuildingType } from '../../entity';
import { SlotKind } from '../../core/pile-kind';
import type { PileKind } from '../../core/pile-kind';
import type { Command, CommandResult } from '../../commands';
import type { PileSlot } from './pile-slot';
import type { GameState } from '../../game-state';
import { BUILDING_PRODUCTIONS, type Recipe } from '../../economy/building-production';

// ── Serialization types ──────────────────────────────────────────────────────

/** Cumulative throughput for one (building, material) pair. */
export interface MaterialThroughput {
    /** Total units deposited (across all slots, across slot lifecycle). */
    totalIn: number;
    /** Total units withdrawn (across all slots, across slot lifecycle). */
    totalOut: number;
}

export interface SerializedPileSlot {
    materialType: EMaterialType;
    currentAmount: number;
    maxCapacity: number;
    x: number;
    y: number;
    entityId: number | null;
    kind: SlotKind;
    buildingId: number | null;
}

/** Serialized form of a single building's throughput: materialType → { totalIn, totalOut } */
export type SerializedBuildingThroughput = Array<[string, MaterialThroughput]>;

export interface SerializedBuildingInventory {
    nextSlotId: number;
    slots: Map<number, SerializedPileSlot>;
    /** Cumulative throughput: buildingId → materialType → { totalIn, totalOut } */
    throughput?: Map<number, Map<EMaterialType, MaterialThroughput>>;
}

// ── Pile entity helpers ──────────────────────────────────────────────────────

/**
 * Build a PileKind discriminated union from slot kind + building ID.
 * Free slots use SlotKind.Free (no buildingId).
 */
export function buildPileKind(slot: PileSlot): PileKind {
    if (slot.kind === SlotKind.Free || slot.buildingId === null) {
        return { kind: SlotKind.Free };
    }
    return { kind: slot.kind, buildingId: slot.buildingId };
}

/**
 * Extract the newly created entity ID from a spawn_pile CommandResult.
 * Throws if the result doesn't contain an entity_created effect.
 */
export function extractEntityId(result: CommandResult): number {
    const effect = result.effects?.[0];
    if (!effect || effect.type !== 'entity_created') {
        throw new Error('spawn_pile: expected entity_created effect');
    }
    return (effect as { type: 'entity_created'; entityId: number }).entityId;
}

/**
 * Spawn a new pile entity for a slot using the executeCommand pipeline.
 * Updates slot.entityId in place.
 * playerNumber must be the owning player (from the building entity).
 */
export function spawnPileEntity(
    slot: PileSlot,
    playerNumber: number,
    executeCommand: (cmd: Command) => CommandResult
): void {
    const result = executeCommand({
        type: 'spawn_pile',
        materialType: slot.materialType,
        x: slot.position.x,
        y: slot.position.y,
        player: playerNumber,
        quantity: slot.currentAmount,
        kind: buildPileKind(slot),
    });
    slot.entityId = extractEntityId(result);
}

/**
 * Remove a pile entity and clear the entityId on the slot.
 */
export function removePileEntity(slot: PileSlot, executeCommand: (cmd: Command) => CommandResult): void {
    executeCommand({ type: 'remove_entity', entityId: slot.entityId! });
    slot.entityId = null;
}

// ── Throughput serialization ─────────────────────────────────────────────────

export type ThroughputMap = Map<number, Map<EMaterialType, MaterialThroughput>>;

/** Serialized form: Array<[buildingId, Array<[materialType, { totalIn, totalOut }]>]> */
type SerializedThroughputMap = Array<[number, SerializedBuildingThroughput]>;

export const throughputSerializer = {
    serialize(value: ThroughputMap): SerializedThroughputMap {
        const result: SerializedThroughputMap = [];
        for (const [buildingId, byMaterial] of value) {
            const entries: SerializedBuildingThroughput = Array.from(byMaterial.entries());
            result.push([buildingId, entries]);
        }
        return result;
    },
    deserialize(raw: unknown): ThroughputMap {
        const map: ThroughputMap = new Map();
        if (!Array.isArray(raw)) {
            return map;
        }
        for (const [buildingId, entries] of raw as SerializedThroughputMap) {
            const byMaterial = new Map<EMaterialType, MaterialThroughput>();
            for (const [materialType, throughput] of entries) {
                byMaterial.set(materialType as EMaterialType, {
                    totalIn: throughput.totalIn,
                    totalOut: throughput.totalOut,
                });
            }
            map.set(buildingId, byMaterial);
        }
        return map;
    },
};

// ── Slot lookup helpers ─────────────────────────────────────────────────────

export function findInputSlot(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    buildingId: number,
    material: EMaterialType
): PileSlot | undefined {
    const ids = inventorySlots.get(buildingId);
    if (!ids) {
        return undefined;
    }
    for (const id of ids) {
        const slot = slotStore.get(id)!;
        if (slot.materialType === material && slot.kind === SlotKind.Input) {
            return slot;
        }
    }
    return undefined;
}

export function findOutputSlot(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    buildingId: number,
    material: EMaterialType
): PileSlot | undefined {
    const ids = inventorySlots.get(buildingId);
    if (!ids) {
        return undefined;
    }
    for (const id of ids) {
        const slot = slotStore.get(id)!;
        if (
            slot.materialType === material &&
            (slot.kind === SlotKind.Output || slot.kind === SlotKind.Storage || slot.kind === SlotKind.Free)
        ) {
            return slot;
        }
    }
    return undefined;
}

export function requireInputSlot(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    buildingId: number,
    material: EMaterialType,
    ctx: string
): PileSlot {
    const slot = findInputSlot(inventorySlots, slotStore, buildingId, material);
    if (!slot) {
        throw new Error(`Building ${buildingId} has no input slot for ${material} [${ctx}]`);
    }
    return slot;
}

export function requireOutputSlot(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    buildingId: number,
    material: EMaterialType,
    ctx: string
): PileSlot {
    const slot = findOutputSlot(inventorySlots, slotStore, buildingId, material);
    if (!slot) {
        throw new Error(`Building ${buildingId} has no output slot for ${material} [${ctx}]`);
    }
    return slot;
}

type SlotLookup = { get(id: number): PileSlot | undefined };

// ── Bulk query helpers ──────────────────────────────────────────────────────

export function getSourcesWithOutput(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    material: EMaterialType,
    minAmount: number
): number[] {
    const result: number[] = [];
    for (const [buildingId, slotIds] of inventorySlots) {
        for (const id of slotIds) {
            const slot = slotStore.get(id)!;
            if (
                (slot.kind === SlotKind.Output || slot.kind === SlotKind.Storage || slot.kind === SlotKind.Free) &&
                slot.materialType === material &&
                slot.currentAmount >= minAmount
            ) {
                result.push(buildingId);
                break;
            }
        }
    }
    return result;
}

export function getSinksNeedingInput(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    material: EMaterialType,
    minSpace: number
): number[] {
    const result: number[] = [];
    for (const [buildingId, slotIds] of inventorySlots) {
        for (const id of slotIds) {
            const slot = slotStore.get(id)!;
            if (
                slot.kind === SlotKind.Input &&
                slot.materialType === material &&
                slot.maxCapacity - slot.currentAmount >= minSpace
            ) {
                result.push(buildingId);
                break;
            }
        }
    }
    return result;
}

export function getInputSpace(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    buildingId: number,
    material: EMaterialType
): number {
    const ids = inventorySlots.get(buildingId);
    if (!ids) {
        return 0;
    }
    let total = 0;
    for (const id of ids) {
        const slot = slotStore.get(id)!;
        if (slot.materialType === material && slot.kind === SlotKind.Input) {
            total += slot.maxCapacity - slot.currentAmount;
        }
    }
    return total;
}

export function findSlotByKind(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    buildingId: number,
    material: EMaterialType,
    kind: SlotKind | 'input' | 'output'
): PileSlot | undefined {
    const ids = inventorySlots.get(buildingId);
    if (!ids) {
        return undefined;
    }
    let resolvedKind: SlotKind;
    if (kind === 'input') {
        resolvedKind = SlotKind.Input;
    } else if (kind === 'output') {
        resolvedKind = SlotKind.Output;
    } else {
        resolvedKind = kind;
    }
    for (const id of ids) {
        const slot = slotStore.get(id)!;
        if (slot.materialType === material && slot.kind === resolvedKind && slot.currentAmount < slot.maxCapacity) {
            return slot;
        }
    }
    return undefined;
}

export function getOutputSlotsForMaterial(
    inventorySlots: Map<number, Set<number>>,
    slotStore: SlotLookup,
    buildingId: number,
    material: EMaterialType
): Array<{ slot: PileSlot; slotId: number }> {
    const ids = inventorySlots.get(buildingId);
    if (!ids) {
        return [];
    }
    const result: { slot: PileSlot; slotId: number }[] = [];
    for (const id of ids) {
        const slot = slotStore.get(id)!;
        if (slot.materialType === material && (slot.kind === SlotKind.Output || slot.kind === SlotKind.Storage)) {
            result.push({ slot, slotId: id });
        }
    }
    return result;
}

// ── Production helpers ────────────────────────────────────────────────────────

/**
 * Look up the production inputs for a building.
 * Uses recipe if provided, otherwise looks up by building type via GameState.
 */
export function getProductionInputs(
    buildingId: number,
    gameState: GameState,
    recipe?: Recipe
): readonly EMaterialType[] | undefined {
    if (recipe) {
        return recipe.inputs;
    }
    const entity = gameState.getEntityOrThrow(buildingId, 'building in production inputs lookup');
    return BUILDING_PRODUCTIONS.get(entity.subType as BuildingType)?.inputs;
}

/**
 * Look up the production output for a building.
 * Uses recipe if provided, otherwise looks up by building type via GameState.
 */
export function getProductionOutput(
    buildingId: number,
    gameState: GameState,
    recipe?: Recipe
): EMaterialType | undefined {
    if (recipe) {
        return recipe.output;
    }
    const entity = gameState.getEntityOrThrow(buildingId, 'building in production output lookup');
    return BUILDING_PRODUCTIONS.get(entity.subType as BuildingType)?.output;
}

// ── Throughput helpers ───────────────────────────────────────────────────────

/** Get or create a throughput entry for a (building, material) pair. */
export function getOrCreateThroughput(
    throughput: ThroughputMap,
    buildingId: number,
    materialType: EMaterialType
): MaterialThroughput {
    let byMaterial = throughput.get(buildingId);
    if (!byMaterial) {
        byMaterial = new Map();
        throughput.set(buildingId, byMaterial);
    }
    let entry = byMaterial.get(materialType);
    if (!entry) {
        entry = { totalIn: 0, totalOut: 0 };
        byMaterial.set(materialType, entry);
    }
    return entry;
}
