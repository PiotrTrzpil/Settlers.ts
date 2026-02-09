/**
 * Inventory slot types and helpers for building material storage.
 * Each slot holds a single material type with capacity limits.
 */

import { EMaterialType } from '../../economy/material-type';

/**
 * A single inventory slot that holds one material type.
 */
export interface InventorySlot {
    /** The material type this slot accepts */
    materialType: EMaterialType;
    /** Current amount of material in the slot */
    currentAmount: number;
    /** Maximum capacity of this slot */
    maxCapacity: number;
}

/**
 * Create a new inventory slot for a given material type.
 * @param materialType The material type this slot will hold
 * @param maxCapacity Maximum capacity of the slot
 * @returns A new empty inventory slot
 */
export function createSlot(materialType: EMaterialType, maxCapacity: number): InventorySlot {
    return {
        materialType,
        currentAmount: 0,
        maxCapacity,
    };
}

/**
 * Check if a slot can accept a given amount of a material.
 * @param slot The inventory slot to check
 * @param materialType The material type to deposit
 * @param amount The amount to deposit
 * @returns True if the slot can accept the material
 */
export function canAccept(slot: InventorySlot, materialType: EMaterialType, amount: number): boolean {
    if (slot.materialType !== materialType) {
        return false;
    }
    return slot.currentAmount + amount <= slot.maxCapacity;
}

/**
 * Check if a slot can provide a given amount of material.
 * @param slot The inventory slot to check
 * @param materialType The material type to withdraw
 * @param amount The amount to withdraw
 * @returns True if the slot has enough material
 */
export function canProvide(slot: InventorySlot, materialType: EMaterialType, amount: number): boolean {
    if (slot.materialType !== materialType) {
        return false;
    }
    return slot.currentAmount >= amount;
}

/**
 * Deposit material into a slot.
 * @param slot The inventory slot to deposit into
 * @param amount The amount to deposit
 * @returns The overflow amount that couldn't fit (0 if all deposited)
 */
export function deposit(slot: InventorySlot, amount: number): number {
    const availableSpace = slot.maxCapacity - slot.currentAmount;
    const toDeposit = Math.min(amount, availableSpace);
    slot.currentAmount += toDeposit;
    return amount - toDeposit;
}

/**
 * Withdraw material from a slot.
 * @param slot The inventory slot to withdraw from
 * @param amount The amount to withdraw
 * @returns The actual amount withdrawn (may be less than requested)
 */
export function withdraw(slot: InventorySlot, amount: number): number {
    const toWithdraw = Math.min(amount, slot.currentAmount);
    slot.currentAmount -= toWithdraw;
    return toWithdraw;
}

/**
 * Get the available space in a slot.
 * @param slot The inventory slot to check
 * @returns The amount of space available
 */
export function getAvailableSpace(slot: InventorySlot): number {
    return slot.maxCapacity - slot.currentAmount;
}

/**
 * Check if a slot is empty.
 * @param slot The inventory slot to check
 * @returns True if the slot has no material
 */
export function isEmpty(slot: InventorySlot): boolean {
    return slot.currentAmount === 0;
}

/**
 * Check if a slot is full.
 * @param slot The inventory slot to check
 * @returns True if the slot is at max capacity
 */
export function isFull(slot: InventorySlot): boolean {
    return slot.currentAmount >= slot.maxCapacity;
}
