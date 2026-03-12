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

export interface SerializedPileSlot {
    id: number;
    materialType: EMaterialType;
    currentAmount: number;
    maxCapacity: number;
    x: number;
    y: number;
    entityId: number | null;
    kind: SlotKind;
    buildingId: number | null;
}

export interface SerializedBuildingInventory {
    nextSlotId: number;
    slots: SerializedPileSlot[];
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
 * Update quantity on an existing pile entity.
 */
export function updatePileEntity(slot: PileSlot, executeCommand: (cmd: Command) => CommandResult): void {
    executeCommand({
        type: 'update_pile_quantity',
        entityId: slot.entityId!,
        quantity: slot.currentAmount,
    });
}

/**
 * Remove a pile entity and clear the entityId on the slot.
 */
export function removePileEntity(slot: PileSlot, executeCommand: (cmd: Command) => CommandResult): void {
    executeCommand({ type: 'remove_entity', entityId: slot.entityId! });
    slot.entityId = null;
}

// ── Slot kind resolution ─────────────────────────────────────────────────────

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
    if (recipe) return recipe.inputs;
    const entity = gameState.getEntity(buildingId);
    if (!entity) return undefined;
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
    if (recipe) return recipe.output;
    const entity = gameState.getEntity(buildingId);
    if (!entity) return undefined;
    return BUILDING_PRODUCTIONS.get(entity.subType as BuildingType)?.output;
}
