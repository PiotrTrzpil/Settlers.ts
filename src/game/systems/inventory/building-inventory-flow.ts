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
 * Withdraw from the input slot for (buildingId, material).
 * Returns actual amount withdrawn.
 */
export function withdrawInput(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    amount: number
): number {
    return mgr.withdraw(requireInputSlot(mgr, buildingId, material, 'withdrawInput').id, amount);
}

/**
 * Withdraw from the output slot for (buildingId, material).
 * Returns actual amount withdrawn.
 */
export function withdrawOutput(
    mgr: BuildingInventoryManager,
    buildingId: number,
    material: EMaterialType,
    amount: number
): number {
    return mgr.withdraw(requireOutputSlot(mgr, buildingId, material, 'withdrawOutput').id, amount);
}

/**
 * Get current amount in the input slot for (buildingId, material).
 * Returns 0 if no input slot exists.
 */
export function getInputAmount(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number {
    return findInputSlot(mgr, buildingId, material)?.currentAmount ?? 0;
}

/**
 * Get current amount in the output slot for (buildingId, material).
 * Returns 0 if no output slot exists.
 */
export function getOutputAmount(mgr: BuildingInventoryManager, buildingId: number, material: EMaterialType): number {
    return mgr.findOutputSlot(buildingId, material)?.currentAmount ?? 0;
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
