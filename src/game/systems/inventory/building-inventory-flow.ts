/**
 * Material flow convenience functions for BuildingInventoryManager.
 *
 * Extracted to keep building-inventory.ts under the file size limit.
 * These stateless functions combine slot lookup with deposit/withdraw operations.
 * They follow the same pattern as building-inventory-production.ts.
 */

import type { EMaterialType } from '../../economy/material-type';
import { SlotKind } from '../../core/pile-kind';
import type { PileSlot } from './pile-slot';
import type { BuildingInventoryManager } from './building-inventory';

function isOutputKind(kind: SlotKind): boolean {
    return kind === SlotKind.Output || kind === SlotKind.Storage || kind === SlotKind.Free;
}

function findInputSlot(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType
): PileSlot | undefined {
    for (const slot of mgr.getSlots(buildingId)) {
        if (slot.materialType === material && slot.kind === SlotKind.Input) {
            return slot;
        }
    }
    return undefined;
}

function requireInputSlot(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    ctx: string
): PileSlot {
    const slot = findInputSlot(mgr, buildingId, material);
    if (!slot) {
        throw new Error(`Building ${buildingId} has no input slot for ${material} [${ctx}]`);
    }
    return slot;
}

function requireOutputSlot(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    ctx: string
): PileSlot {
    // findOutputSlot matches Output | Storage | Free — mirrors requireOutputSlot in helpers
    const slot = mgr.findOutputSlot(buildingId, material);
    if (!slot) {
        throw new Error(`Building ${buildingId} has no output slot for ${material} [${ctx}]`);
    }
    return slot;
}

/**
 * Deposit into the input slot for (buildingId, material).
 * Returns actual amount deposited.
 */
export function depositInput(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    amount: number
): number {
    return mgr.deposit(requireInputSlot(mgr, buildingId, material, 'depositInput').id, amount);
}

/**
 * Deposit into the output slot for (buildingId, material).
 * Returns actual amount deposited.
 */
export function depositOutput(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    amount: number
): number {
    return mgr.deposit(requireOutputSlot(mgr, buildingId, material, 'depositOutput').id, amount);
}

/**
 * Withdraw from an input slot for (buildingId, material) that has stock.
 * Iterates all matching input slots to handle multi-slot materials (e.g. stone×12
 * split across two slots [8,4] for castle construction).
 * Returns actual amount withdrawn.
 */
export function withdrawInput(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    amount: number
): number {
    for (const slot of mgr.getSlots(buildingId)) {
        if (slot.materialType === material && slot.kind === SlotKind.Input && slot.currentAmount > 0) {
            return mgr.withdraw(slot.id, amount);
        }
    }
    throw new Error(`Building ${buildingId} has no input slot with stock for ${material} [withdrawInput]`);
}

/**
 * Withdraw from an output/storage/free slot for (buildingId, material) that has stock.
 * Iterates all matching slots to handle multi-slot materials.
 * Returns actual amount withdrawn.
 */
export function withdrawOutput(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    amount: number
): number {
    for (const slot of mgr.getSlots(buildingId)) {
        if (slot.materialType === material && isOutputKind(slot.kind) && slot.currentAmount > 0) {
            return mgr.withdraw(slot.id, amount);
        }
    }
    throw new Error(`Building ${buildingId} has no output slot with stock for ${material} [withdrawOutput]`);
}

/**
 * Get total current amount across all input slots for (buildingId, material).
 * Sums across multiple slots to handle multi-slot materials.
 */
export function getInputAmount(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number {
    let total = 0;
    for (const slot of mgr.getSlots(buildingId)) {
        if (slot.materialType === material && slot.kind === SlotKind.Input) {
            total += slot.currentAmount;
        }
    }
    return total;
}

/**
 * Get total current amount across all output/storage/free slots for (buildingId, material).
 * Sums across multiple slots to handle multi-slot materials (e.g. stone×12 in two storage slots).
 */
export function getOutputAmount(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number {
    let total = 0;
    for (const slot of mgr.getSlots(buildingId)) {
        if (slot.materialType === material && isOutputKind(slot.kind)) {
            total += slot.currentAmount;
        }
    }
    return total;
}

/**
 * Get total available input space across all matching slots for (buildingId, material).
 */
export function getInputSpace(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number {
    let total = 0;
    for (const slot of mgr.getSlots(buildingId)) {
        if (slot.materialType === material && slot.kind === SlotKind.Input) {
            total += slot.maxCapacity - slot.currentAmount;
        }
    }
    return total;
}
