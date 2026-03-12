/** Building inventory management — PileSlot-based model. */

import { BuildingType, type Entity } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { Race } from '../../core/race';
import { SlotKind } from '../../core/pile-kind';
import type { TileCoord } from '../../core/coordinates';
import type { Recipe } from '../../economy/building-production';
import {
    getInventoryConfig,
    getConstructionInventoryConfig,
    type SlotConfig,
    type InventoryConfig,
} from './inventory-configs';
import type { PileSlot } from './pile-slot';
import type { ComponentStore } from '../../ecs';
import type { GameState } from '../../game-state';
import type { Command, CommandResult } from '../../commands';
import type { EventBus } from '../../event-bus';
import type { Persistable } from '@/game/persistence';
import { createLogger } from '@/utilities/logger';
import {
    type SerializedBuildingInventory,
    type SerializedPileSlot,
    spawnPileEntity,
    updatePileEntity,
    removePileEntity,
    getProductionInputs,
    getProductionOutput,
} from './building-inventory-helpers';

const log = createLogger('BuildingInventory');

/** Lightweight view of all PileSlots for one building. */
export interface BuildingInventoryView {
    buildingId: number;
    slotIds: ReadonlySet<number>;
}
export interface BuildingInventoryDeps {
    executeCommand: (cmd: Command) => CommandResult;
    gameState: GameState;
    eventBus: EventBus;
}

/**
 * Callback that resolves pile positions for a set of slot configs.
 * Returns a position for each config entry, or null if no position is available
 * (slot will be skipped). Called by createSlotsFromConfig.
 */
export type SlotPositionResolver = (
    buildingId: number,
    building: Entity,
    configs: ReadonlyArray<{ materialType: EMaterialType; kind: SlotKind }>
) => Array<TileCoord | null>;
export class BuildingInventoryManager implements Persistable<SerializedBuildingInventory> {
    readonly persistKey = 'buildingInventories' as const;

    /** All slots, indexed by stable slotId. */
    private slots = new Map<number, PileSlot>();
    /** buildingId → set of slotIds. */
    private inventorySlots = new Map<number, Set<number>>();
    /** Monotonically increasing slot ID counter. */
    private nextSlotId = 1;

    /**
     * ComponentStore for ECS queries — wraps inventorySlots map with a BuildingInventoryView.
     * Provides stable per-building view of slot IDs for cross-system joins.
     */
    private _storeCache: ComponentStore<BuildingInventoryView> | null = null;

    /** ComponentStore view for ECS queries over buildings that have inventory slots. */
    get store(): ComponentStore<BuildingInventoryView> {
        if (!this._storeCache) this._storeCache = this.buildComponentStore();
        return this._storeCache;
    }

    private buildComponentStore(): ComponentStore<BuildingInventoryView> {
        const bs = this.inventorySlots;
        const entriesFn = () => this.buildingStoreEntries();
        const store: ComponentStore<BuildingInventoryView> = {
            get(id: number) {
                const slotIds = bs.get(id);
                return slotIds ? { buildingId: id, slotIds } : undefined;
            },
            has(id: number) {
                return bs.has(id);
            },
            get size() {
                return bs.size;
            },
            entries: entriesFn,
        };
        return store;
    }

    /** Injected dependencies (late-bound to break circular refs). */
    private deps: BuildingInventoryDeps | null = null;

    /**
     * Configure dependencies. Must be called before any deposit/withdraw/createSlots call
     * that needs pile entity management.
     */
    configure(deps: BuildingInventoryDeps): void {
        this.deps = deps;
    }

    private getDeps(): BuildingInventoryDeps {
        if (!this.deps) throw new Error('BuildingInventoryManager: configure() must be called before use');
        return this.deps;
    }
    /**
     * Create all slots for a building using the operational inventory config.
     * Does NOT create pile entities (amount starts at 0).
     */
    createSlots(
        buildingId: number,
        buildingType: BuildingType,
        race: Race,
        positionResolver: SlotPositionResolver
    ): void {
        this.createSlotsFromConfig(buildingId, buildingType, getInventoryConfig(buildingType, race), positionResolver);
    }

    /**
     * Create slots from explicit config. Positions are resolved by the caller-supplied
     * SlotPositionResolver — the manager never knows about XML pile data or construction sites.
     */
    createSlotsFromConfig(
        buildingId: number,
        buildingType: BuildingType,
        config: InventoryConfig,
        positionResolver: SlotPositionResolver
    ): void {
        const { gameState } = this.getDeps();
        const building = gameState.getEntityOrThrow(buildingId, 'createSlotsFromConfig');

        // Build flat list of configs with their kind for the resolver
        const allConfigs: Array<{ materialType: EMaterialType; kind: SlotKind }> = [];
        for (const cfg of config.inputSlots) {
            allConfigs.push({ materialType: cfg.materialType, kind: SlotKind.Input });
        }
        for (const cfg of config.outputSlots) {
            const kind = buildingType === BuildingType.StorageArea ? SlotKind.Storage : SlotKind.Output;
            allConfigs.push({ materialType: cfg.materialType, kind });
        }

        const positions = positionResolver(buildingId, building, allConfigs);

        // Zip configs with resolved positions (null = no position available, skip slot)
        let cfgIdx = 0;
        for (const cfg of config.inputSlots) {
            const position = positions[cfgIdx++];
            if (position) {
                this.addSlot(buildingId, cfg, allConfigs[cfgIdx - 1]!.kind, position);
            }
        }
        for (const cfg of config.outputSlots) {
            const position = positions[cfgIdx++];
            if (position) {
                this.addSlot(buildingId, cfg, allConfigs[cfgIdx - 1]!.kind, position);
            }
        }
    }

    /**
     * Create construction slots for a building under construction.
     */
    createConstructionSlots(
        buildingId: number,
        buildingType: BuildingType,
        race: Race,
        positionResolver: SlotPositionResolver
    ): void {
        const config = getConstructionInventoryConfig(buildingType, race);
        this.createSlotsFromConfig(buildingId, buildingType, config, positionResolver);
    }

    /**
     * Destroy all slots for a building. Non-empty pile entities are converted to
     * free piles (they survive the building removal). Empty slots are just cleaned up.
     */
    destroySlots(buildingId: number): void {
        const slotIds = this.inventorySlots.get(buildingId);
        if (!slotIds) return;
        const { executeCommand, gameState } = this.getDeps();

        for (const slotId of slotIds) {
            const slot = this.slots.get(slotId)!;
            if (slot.entityId !== null && slot.currentAmount > 0 && slot.kind !== SlotKind.Free) {
                // Building destroyed with materials remaining — convert pile to free pile
                const pileEntity = gameState.getEntity(slot.entityId);
                if (pileEntity) {
                    gameState.piles.setKind(slot.entityId, { kind: SlotKind.Free });
                    this.registerFreePile(slot.entityId, slot.materialType, slot.currentAmount, slot.position);
                }
            } else if (slot.entityId !== null) {
                // Empty slot or free pile cleanup — remove the pile entity
                const pileEntity = gameState.getEntity(slot.entityId);
                if (pileEntity) {
                    removePileEntity(slot, executeCommand);
                }
            }
            this.slots.delete(slotId);
        }
        this.inventorySlots.delete(buildingId);
    }

    /**
     * Deposit amount into a slot by slotId.
     * Spawns or updates the pile entity inline.
     * Returns actual amount deposited (may be less than requested if slot is full).
     */
    deposit(slotId: number, amount: number): number {
        const slot = this.getSlotOrThrow(slotId, 'deposit');
        const { executeCommand, gameState } = this.getDeps();
        const available = slot.maxCapacity - slot.currentAmount;
        const toDeposit = Math.min(amount, available);
        if (toDeposit <= 0) return 0;

        const prev = slot.currentAmount;
        slot.currentAmount += toDeposit;

        if (slot.entityId === null) {
            const building = gameState.getEntityOrThrow(slot.buildingId!, 'deposit:spawn');
            spawnPileEntity(slot, building.player, executeCommand);
        } else {
            updatePileEntity(slot, executeCommand);
        }

        this.emitChanged(slot, prev);
        return toDeposit;
    }

    /**
     * Withdraw amount from a slot by slotId.
     * Removes the pile entity when amount reaches 0.
     * Returns actual amount withdrawn.
     */
    withdraw(slotId: number, amount: number): number {
        const slot = this.getSlotOrThrow(slotId, 'withdraw');
        const { executeCommand } = this.getDeps();
        const toWithdraw = Math.min(amount, slot.currentAmount);
        if (toWithdraw <= 0) return 0;

        const prev = slot.currentAmount;
        slot.currentAmount -= toWithdraw;

        if (slot.currentAmount === 0 && slot.entityId !== null) {
            removePileEntity(slot, executeCommand);
        } else if (slot.entityId !== null) {
            updatePileEntity(slot, executeCommand);
        }

        this.emitChanged(slot, prev);
        return toWithdraw;
    }
    getSlot(slotId: number): PileSlot | undefined {
        return this.slots.get(slotId);
    }

    getSlotOrThrow(slotId: number, context: string): PileSlot {
        const slot = this.slots.get(slotId);
        if (!slot) throw new Error(`BuildingInventoryManager: slot ${slotId} not found [${context}]`);
        return slot;
    }

    /** All PileSlots for a building. */
    getSlots(buildingId: number): readonly PileSlot[] {
        const ids = this.inventorySlots.get(buildingId);
        if (!ids) return [];
        return Array.from(ids, id => this.slots.get(id)!);
    }

    /** All slot IDs for a building. */
    getSlotIds(buildingId: number): ReadonlySet<number> {
        return this.inventorySlots.get(buildingId) ?? new Set();
    }

    /**
     * Find first slot with space for the given material and kind.
     * Kind can be a SlotKind or 'input'/'output' convenience aliases.
     */
    findSlot(buildingId: number, material: EMaterialType, kind: SlotKind | 'input' | 'output'): PileSlot | undefined {
        const ids = this.inventorySlots.get(buildingId);
        if (!ids) return undefined;
        let resolvedKind: SlotKind;
        if (kind === 'input') resolvedKind = SlotKind.Input;
        else if (kind === 'output') resolvedKind = SlotKind.Output;
        else resolvedKind = kind;
        for (const id of ids) {
            const slot = this.slots.get(id)!;
            if (slot.materialType === material && slot.kind === resolvedKind && slot.currentAmount < slot.maxCapacity) {
                return slot;
            }
        }
        return undefined;
    }

    /**
     * Find first slot with space for given material and kind.
     * Returns slot + its ID. For logistics resolveDestinationSlot.
     */
    findSlotWithSpace(
        buildingId: number,
        material: EMaterialType,
        kind: SlotKind | 'input' | 'output'
    ): { slot: PileSlot; slotId: number } | undefined {
        const s = this.findSlot(buildingId, material, kind);
        return s ? { slot: s, slotId: s.id } : undefined;
    }

    /**
     * All output slots for a building matching a material (for set_storage_filter command).
     */
    getOutputSlots(buildingId: number, material: EMaterialType): ReadonlyArray<{ slot: PileSlot; slotId: number }> {
        const ids = this.inventorySlots.get(buildingId);
        if (!ids) return [];
        const result: { slot: PileSlot; slotId: number }[] = [];
        for (const id of ids) {
            const slot = this.slots.get(id)!;
            if (slot.materialType === material && (slot.kind === SlotKind.Output || slot.kind === SlotKind.Storage)) {
                result.push({ slot, slotId: id });
            }
        }
        return result;
    }

    /**
     * Set a slot's materialType. Used by logistics to claim/release StorageArea slots.
     * Throws if the slot has amount > 0 and material would change.
     */
    setSlotMaterial(slotId: number, material: EMaterialType): void {
        const slot = this.getSlotOrThrow(slotId, `setSlotMaterial`);
        if (slot.currentAmount > 0 && slot.materialType !== material) {
            throw new Error(
                `Cannot reassign non-empty slot ${slotId}: has ${slot.currentAmount} of ` +
                    `${EMaterialType[slot.materialType]}, attempted ${EMaterialType[material]}`
            );
        }
        slot.materialType = material;
        log.debug(`setSlotMaterial: slotId=${slotId} → ${EMaterialType[material]}`);
    }
    depositInput(buildingId: number, material: EMaterialType, amount: number): number {
        const slot = this.requireInputSlot(buildingId, material, 'depositInput');
        return this.deposit(slot.id, amount);
    }

    depositOutput(buildingId: number, material: EMaterialType, amount: number): number {
        const slot = this.requireOutputSlot(buildingId, material, 'depositOutput');
        return this.deposit(slot.id, amount);
    }

    withdrawInput(buildingId: number, material: EMaterialType, amount: number): number {
        const slot = this.requireInputSlot(buildingId, material, 'withdrawInput');
        return this.withdraw(slot.id, amount);
    }

    withdrawOutput(buildingId: number, material: EMaterialType, amount: number): number {
        const slot = this.requireOutputSlot(buildingId, material, 'withdrawOutput');
        return this.withdraw(slot.id, amount);
    }
    getInputAmount(buildingId: number, material: EMaterialType): number {
        return this.findInputSlot(buildingId, material)?.currentAmount ?? 0;
    }

    getOutputAmount(buildingId: number, material: EMaterialType): number {
        return this.findOutputSlot(buildingId, material)?.currentAmount ?? 0;
    }

    /** Total available input space across all matching slots. */
    getInputSpace(buildingId: number, material: EMaterialType): number {
        const ids = this.inventorySlots.get(buildingId);
        if (!ids) return 0;
        let total = 0;
        for (const id of ids) {
            const slot = this.slots.get(id)!;
            if (slot.materialType === material && slot.kind === SlotKind.Input) {
                total += slot.maxCapacity - slot.currentAmount;
            }
        }
        return total;
    }

    canAcceptInput(buildingId: number, material: EMaterialType, amount: number): boolean {
        const slot = this.findInputSlot(buildingId, material);
        if (!slot) return false;
        return slot.currentAmount + amount <= slot.maxCapacity;
    }

    canProvideOutput(buildingId: number, material: EMaterialType, amount: number): boolean {
        const slot = this.findOutputSlot(buildingId, material);
        if (!slot) return false;
        return slot.currentAmount >= amount;
    }
    canStartProduction(buildingId: number, recipe?: Recipe): boolean {
        const inputs = getProductionInputs(buildingId, this.getDeps().gameState, recipe);
        if (!inputs) return false;
        for (const material of inputs) {
            if (this.getInputAmount(buildingId, material) < 1) return false;
        }
        return true;
    }

    consumeProductionInputs(buildingId: number, recipe?: Recipe): boolean {
        const inputs = getProductionInputs(buildingId, this.getDeps().gameState, recipe);
        if (!inputs) return false;
        for (const material of inputs) this.withdrawInput(buildingId, material, 1);
        return true;
    }

    produceOutput(buildingId: number, recipe?: Recipe): boolean {
        const output = getProductionOutput(buildingId, this.getDeps().gameState, recipe);
        if (output === undefined || output === EMaterialType.NO_MATERIAL) return false;
        return this.depositOutput(buildingId, output, 1) > 0;
    }

    canStoreOutput(buildingId: number, recipe?: Recipe): boolean {
        const output = getProductionOutput(buildingId, this.getDeps().gameState, recipe);
        if (output === undefined || output === EMaterialType.NO_MATERIAL) return true;
        const slot = this.findOutputSlot(buildingId, output);
        if (!slot) return false;
        return slot.currentAmount < slot.maxCapacity;
    }
    getAllInventoryIds(): number[] {
        return Array.from(this.inventorySlots.keys());
    }

    /** Returns an iterable of building IDs that have slots (replaces old getAllInventories()). */
    getAllInventories(): IterableIterator<number> {
        return this.inventorySlots.keys();
    }

    getSourcesWithOutput(material: EMaterialType, minAmount = 1): number[] {
        const result: number[] = [];
        for (const [buildingId, slotIds] of this.inventorySlots) {
            for (const id of slotIds) {
                const slot = this.slots.get(id)!;
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

    getSinksNeedingInput(material: EMaterialType, minSpace = 1): number[] {
        const result: number[] = [];
        for (const [buildingId, slotIds] of this.inventorySlots) {
            for (const id of slotIds) {
                const slot = this.slots.get(id)!;
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

    hasSlots(buildingId: number): boolean {
        return this.inventorySlots.has(buildingId);
    }

    /**
     * Register an existing free pile entity as a PileSlot.
     * Used by FreePileHandler when a pile entity already exists (building destroyed,
     * place_pile command). Creates a slot with kind=Free, pre-linked entityId.
     */
    registerFreePile(
        entityId: number,
        material: EMaterialType,
        quantity: number,
        position: { x: number; y: number }
    ): void {
        const slotId = this.nextSlotId++;
        const slot: PileSlot = {
            id: slotId,
            materialType: material,
            currentAmount: quantity,
            maxCapacity: quantity,
            position,
            entityId,
            kind: SlotKind.Free,
            buildingId: entityId, // use pile entity ID as "building" for output queries
        };
        this.slots.set(slotId, slot);
        this.getInventorySlotSet(entityId).add(slotId);
    }

    clear(): void {
        this.slots.clear();
        this.inventorySlots.clear();
    }
    serialize(): SerializedBuildingInventory {
        const serializedSlots: SerializedPileSlot[] = [];
        for (const slot of this.slots.values()) {
            serializedSlots.push({
                id: slot.id,
                materialType: slot.materialType,
                currentAmount: slot.currentAmount,
                maxCapacity: slot.maxCapacity,
                x: slot.position.x,
                y: slot.position.y,
                entityId: slot.entityId,
                kind: slot.kind,
                buildingId: slot.buildingId,
            });
        }
        return { nextSlotId: this.nextSlotId, slots: serializedSlots };
    }

    deserialize(data: SerializedBuildingInventory): void {
        this.slots.clear();
        this.inventorySlots.clear();
        this.nextSlotId = data.nextSlotId;

        for (const s of data.slots) {
            const slot: PileSlot = {
                id: s.id,
                materialType: s.materialType,
                currentAmount: s.currentAmount,
                maxCapacity: s.maxCapacity,
                position: { x: s.x, y: s.y },
                entityId: s.entityId,
                kind: s.kind,
                buildingId: s.buildingId,
            };
            this.slots.set(s.id, slot);
            if (s.buildingId !== null) {
                this.getInventorySlotSet(s.buildingId).add(s.id);
            }
        }
    }
    private *buildingStoreEntries(): IterableIterator<[number, BuildingInventoryView]> {
        for (const [buildingId, slotIds] of this.inventorySlots) {
            yield [buildingId, { buildingId, slotIds }];
        }
    }

    private addSlot(buildingId: number, cfg: SlotConfig, kind: SlotKind, position: TileCoord): void {
        const slotId = this.nextSlotId++;
        const slot: PileSlot = {
            id: slotId,
            materialType: cfg.materialType,
            currentAmount: 0,
            maxCapacity: cfg.maxCapacity,
            position,
            entityId: null,
            kind,
            buildingId,
        };
        this.slots.set(slotId, slot);
        this.getInventorySlotSet(buildingId).add(slotId);
        log.debug(
            `createSlot: building=${buildingId}, slotId=${slotId}, kind=${kind}, material=${EMaterialType[cfg.materialType]}`
        );
    }

    private getInventorySlotSet(buildingId: number): Set<number> {
        let set = this.inventorySlots.get(buildingId);
        if (!set) {
            set = new Set();
            this.inventorySlots.set(buildingId, set);
        }
        return set;
    }

    private findInputSlot(buildingId: number, material: EMaterialType): PileSlot | undefined {
        const ids = this.inventorySlots.get(buildingId);
        if (!ids) return undefined;
        for (const id of ids) {
            const slot = this.slots.get(id)!;
            if (slot.materialType === material && slot.kind === SlotKind.Input) {
                return slot;
            }
        }
        return undefined;
    }

    private findOutputSlot(buildingId: number, material: EMaterialType): PileSlot | undefined {
        const ids = this.inventorySlots.get(buildingId);
        if (!ids) return undefined;
        for (const id of ids) {
            const slot = this.slots.get(id)!;
            if (
                slot.materialType === material &&
                (slot.kind === SlotKind.Output || slot.kind === SlotKind.Storage || slot.kind === SlotKind.Free)
            ) {
                return slot;
            }
        }
        return undefined;
    }

    private requireInputSlot(buildingId: number, material: EMaterialType, ctx: string): PileSlot {
        const slot = this.findInputSlot(buildingId, material);
        if (!slot) throw new Error(`Building ${buildingId} has no input slot for ${EMaterialType[material]} [${ctx}]`);
        return slot;
    }

    private requireOutputSlot(buildingId: number, material: EMaterialType, ctx: string): PileSlot {
        const slot = this.findOutputSlot(buildingId, material);
        if (!slot) throw new Error(`Building ${buildingId} has no output slot for ${EMaterialType[material]} [${ctx}]`);
        return slot;
    }

    private emitChanged(slot: PileSlot, previousAmount: number): void {
        if (!this.deps || slot.currentAmount === previousAmount) return;
        const slotType = slot.kind === SlotKind.Input ? 'input' : 'output';
        this.deps.eventBus.emit('inventory:changed', {
            buildingId: slot.buildingId!,
            materialType: slot.materialType,
            slotType,
            previousAmount,
            newAmount: slot.currentAmount,
        });
    }
}
