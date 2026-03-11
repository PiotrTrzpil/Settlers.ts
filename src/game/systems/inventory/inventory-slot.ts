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
 * Result of a deposit operation.
 */
export interface DepositResult {
    /** Amount actually deposited */
    deposited: number;
    /** Amount that couldn't fit (overflow) */
    overflow: number;
}

/**
 * Result of a withdraw operation.
 */
export interface WithdrawResult {
    /** Amount actually withdrawn */
    withdrawn: number;
    /** Amount that was requested but not available */
    shortfall: number;
}

/**
 * Validate that an amount is a valid positive number.
 * @returns The sanitized amount (0 if invalid)
 */
function sanitizeAmount(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
        return 0;
    }
    return Math.floor(amount); // Ensure integer
}

/**
 * Create a new inventory slot for a given material type.
 * @param materialType The material type this slot will hold
 * @param maxCapacity Maximum capacity of the slot (must be positive integer)
 * @returns A new empty inventory slot
 */
export function createSlot(materialType: EMaterialType, maxCapacity: number): InventorySlot {
    const capacity = Math.max(1, Math.floor(maxCapacity)); // At least 1, must be integer
    return {
        materialType,
        currentAmount: 0,
        maxCapacity: capacity,
    };
}

/**
 * Check if a slot can accept a given amount of a material.
 * @param slot The inventory slot to check
 * @param materialType The material type to deposit
 * @param amount The amount to deposit
 * @returns True if the slot can accept ALL of the material
 */
export function canAccept(slot: InventorySlot, materialType: EMaterialType, amount: number): boolean {
    if (slot.materialType !== materialType) {
        return false;
    }
    const sanitized = sanitizeAmount(amount);
    if (sanitized === 0) return true; // Can always accept 0
    return slot.currentAmount + sanitized <= slot.maxCapacity;
}

/**
 * Check if a slot can accept at least some of a material.
 * @param slot The inventory slot to check
 * @param materialType The material type to deposit
 * @returns True if the slot has any space for this material
 */
export function canAcceptAny(slot: InventorySlot, materialType: EMaterialType): boolean {
    if (slot.materialType !== materialType) {
        return false;
    }
    return slot.currentAmount < slot.maxCapacity;
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
    const sanitized = sanitizeAmount(amount);
    return slot.currentAmount >= sanitized;
}

/**
 * Deposit material into a slot.
 * Handles invalid amounts gracefully (negative, NaN, Infinity treated as 0).
 * @param slot The inventory slot to deposit into
 * @param amount The amount to deposit
 * @returns The overflow amount that couldn't fit (0 if all deposited)
 */
export function deposit(slot: InventorySlot, amount: number): number {
    const sanitized = sanitizeAmount(amount);
    const availableSpace = slot.maxCapacity - slot.currentAmount;
    const toDeposit = Math.min(sanitized, availableSpace);
    slot.currentAmount += toDeposit;
    return sanitized - toDeposit;
}

/**
 * Deposit material into a slot with detailed result.
 * @param slot The inventory slot to deposit into
 * @param amount The amount to deposit
 * @returns Detailed result with deposited and overflow amounts
 */
export function depositWithResult(slot: InventorySlot, amount: number): DepositResult {
    const sanitized = sanitizeAmount(amount);
    const availableSpace = slot.maxCapacity - slot.currentAmount;
    const toDeposit = Math.min(sanitized, availableSpace);
    slot.currentAmount += toDeposit;
    return {
        deposited: toDeposit,
        overflow: sanitized - toDeposit,
    };
}

/**
 * Withdraw material from a slot.
 * Handles invalid amounts gracefully (negative, NaN, Infinity treated as 0).
 * @param slot The inventory slot to withdraw from
 * @param amount The amount to withdraw
 * @returns The actual amount withdrawn (may be less than requested)
 */
export function withdraw(slot: InventorySlot, amount: number): number {
    const sanitized = sanitizeAmount(amount);
    const toWithdraw = Math.min(sanitized, slot.currentAmount);
    slot.currentAmount -= toWithdraw;
    return toWithdraw;
}

/**
 * Withdraw material from a slot with detailed result.
 * @param slot The inventory slot to withdraw from
 * @param amount The amount to withdraw
 * @returns Detailed result with withdrawn and shortfall amounts
 */
export function withdrawWithResult(slot: InventorySlot, amount: number): WithdrawResult {
    const sanitized = sanitizeAmount(amount);
    const toWithdraw = Math.min(sanitized, slot.currentAmount);
    slot.currentAmount -= toWithdraw;
    return {
        withdrawn: toWithdraw,
        shortfall: sanitized - toWithdraw,
    };
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
