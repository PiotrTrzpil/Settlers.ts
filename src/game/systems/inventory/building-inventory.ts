/** Building inventory management — PileSlot-based model. */

import { BuildingType, type Entity, type StackedPileState } from '../../entity';
import { EMaterialType } from '../../economy/material-type';
import { Race } from '../../core/race';
import { SlotKind, type PileKind } from '../../core/pile-kind';
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
import { PersistentMap, PersistentValue } from '@/game/persistence/persistent-store';
import { createLogger } from '@/utilities/logger';
import type { MaterialThroughput } from './building-inventory-helpers';
import {
    type ThroughputMap,
    throughputSerializer,
    spawnPileEntity,
    buildPileKind,
    removePileEntity,
    findInputSlot,
    findOutputSlot,
    requireInputSlot,
    requireOutputSlot,
    getSourcesWithOutput as getSourcesWithOutputFn,
    getSinksNeedingInput as getSinksNeedingInputFn,
    findSlotByKind,
    getOutputSlotsForMaterial,
    getInputSpace as getInputSpaceFn,
    getOrCreateThroughput,
} from './building-inventory-helpers';
import { PileStatesView } from './pile-states-view';
import {
    canStartProduction as canStartProductionFn,
    consumeProductionInputs as consumeProductionInputsFn,
    produceOutput as produceOutputFn,
    canStoreOutput as canStoreOutputFn,
} from './building-inventory-production';

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
export class BuildingInventoryManager {
    /** All slots, indexed by stable slotId — auto-persisted. */
    readonly slotStore = new PersistentMap<PileSlot>('buildingInventories');
    /** Slot ID counter — auto-persisted. */
    readonly nextSlotIdStore = new PersistentValue<number>('buildingInventoryNextSlotId', 1);
    /** Cumulative throughput per (buildingId, materialType) — auto-persisted. */
    readonly throughputStore = new PersistentValue<ThroughputMap>(
        'buildingInventoryThroughput',
        new Map(),
        throughputSerializer
    );
    /** buildingId → set of slotIds (derived index, rebuilt after restore). */
    private inventorySlots = new Map<number, Set<number>>();
    /** entityId → slotId reverse index (derived, rebuilt after restore). */
    private readonly _entityIndex = new Map<number, number>();
    private _pileStatesView: PileStatesView | null = null;

    /**
     * ComponentStore for ECS queries — wraps inventorySlots map with a BuildingInventoryView.
     * Provides stable per-building view of slot IDs for cross-system joins.
     */
    private _storeCache: ComponentStore<BuildingInventoryView> | null = null;

    /** ComponentStore view for ECS queries over buildings that have inventory slots. */
    get store(): ComponentStore<BuildingInventoryView> {
        if (!this._storeCache) {
            this._storeCache = this.buildComponentStore();
        }
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
        if (!this.deps) {
            throw new Error('BuildingInventoryManager: configure() must be called before use');
        }
        return this.deps;
    }

    /** Live derived view of pile states for the renderer — single source of truth. */
    get pileStates(): ReadonlyMap<number, StackedPileState> {
        if (!this._pileStatesView) {
            this._pileStatesView = new PileStatesView({
                entityIndex: this._entityIndex,
                getSlot: id => this.slotStore.get(id),
            });
        }
        return this._pileStatesView;
    }

    /** Look up a PileSlot by the pile entity ID (reverse index). */
    getSlotByEntityId(entityId: number): PileSlot | undefined {
        const slotId = this._entityIndex.get(entityId);
        return slotId !== undefined ? this.slotStore.get(slotId) : undefined;
    }

    /** Get the PileKind for a pile entity. Throws if unknown. */
    getPileKind(entityId: number): PileKind {
        const slot = this.getSlotByEntityId(entityId);
        if (!slot) {
            throw new Error(`getPileKind: unknown pile entity ${entityId}`);
        }
        return buildPileKind(slot);
    }

    /** Clean up entityIndex when a pile entity is removed outside deposit/withdraw flow. */
    onPileEntityRemoved(entityId: number): void {
        this._entityIndex.delete(entityId);
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
        if (!slotIds) {
            return;
        }
        const { executeCommand, gameState } = this.getDeps();

        for (const slotId of slotIds) {
            const slot = this.slotStore.get(slotId)!;
            if (slot.entityId !== null && slot.currentAmount > 0 && slot.kind !== SlotKind.Free) {
                // Building destroyed with materials remaining — convert pile to free pile
                const pileEntity = gameState.getEntity(slot.entityId);
                if (pileEntity) {
                    this.registerFreePile(slot.entityId, slot.materialType, slot.currentAmount, slot.position);
                }
            } else if (slot.entityId !== null) {
                // Empty slot or free pile cleanup — remove the pile entity
                const pileEntity = gameState.getEntity(slot.entityId);
                if (pileEntity) {
                    this._entityIndex.delete(slot.entityId);
                    removePileEntity(slot, executeCommand);
                }
            }
            this.slotStore.delete(slotId);
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
        if (toDeposit <= 0) {
            return 0;
        }

        const prev = slot.currentAmount;
        slot.currentAmount += toDeposit;

        if (slot.entityId === null) {
            const building = gameState.getEntityOrThrow(slot.buildingId!, 'deposit:spawn');
            spawnPileEntity(slot, building.player, executeCommand);
            this._entityIndex.set(slot.entityId!, slot.id);
        }

        if (slot.buildingId !== null) {
            this.recordThroughputIn(slot.buildingId, slot.materialType, toDeposit);
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
        if (toWithdraw <= 0) {
            return 0;
        }

        const prev = slot.currentAmount;
        slot.currentAmount -= toWithdraw;

        if (slot.currentAmount === 0 && slot.entityId !== null) {
            this._entityIndex.delete(slot.entityId);
            removePileEntity(slot, executeCommand);
        }

        if (slot.buildingId !== null) {
            this.recordThroughputOut(slot.buildingId, slot.materialType, toWithdraw);
        }

        this.emitChanged(slot, prev);
        return toWithdraw;
    }
    getSlot(slotId: number): PileSlot | undefined {
        return this.slotStore.get(slotId);
    }

    getSlotOrThrow(slotId: number, context: string): PileSlot {
        const slot = this.slotStore.get(slotId);
        if (!slot) {
            throw new Error(`BuildingInventoryManager: slot ${slotId} not found [${context}]`);
        }
        return slot;
    }

    /** All PileSlots for a building. */
    getSlots(buildingId: number): readonly PileSlot[] {
        const ids = this.inventorySlots.get(buildingId);
        if (!ids) {
            return [];
        }
        return Array.from(ids, id => this.slotStore.get(id)!);
    }

    /** All slot IDs for a building. */
    getSlotIds(buildingId: number): ReadonlySet<number> {
        return this.inventorySlots.get(buildingId) ?? new Set();
    }

    /**
     * Get cumulative throughput for a specific (building, material) pair.
     * Returns { totalIn: 0, totalOut: 0 } if no throughput has been recorded yet.
     */
    getThroughput(buildingId: number, materialType: EMaterialType): MaterialThroughput {
        return this.throughputStore.get().get(buildingId)?.get(materialType) ?? { totalIn: 0, totalOut: 0 };
    }

    /**
     * Get all throughput entries for a building.
     * Returns an empty map if no throughput has been recorded for this building.
     */
    getBuildingThroughput(buildingId: number): ReadonlyMap<EMaterialType, MaterialThroughput> {
        return this.throughputStore.get().get(buildingId) ?? new Map();
    }

    /**
     * Find first slot with space for the given material and kind.
     * Kind can be a SlotKind or 'input'/'output' convenience aliases.
     */
    findSlot(buildingId: number, material: EMaterialType, kind: SlotKind | 'input' | 'output'): PileSlot | undefined {
        return findSlotByKind(this.inventorySlots, this.slotStore, buildingId, material, kind);
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
        return getOutputSlotsForMaterial(this.inventorySlots, this.slotStore, buildingId, material);
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
                    `${slot.materialType}, attempted ${material}`
            );
        }
        slot.materialType = material;
        log.debug(`setSlotMaterial: slotId=${slotId} → ${material}`);
    }
    depositInput(buildingId: number, material: EMaterialType, amount: number): number {
        return this.deposit(this.requireInputSlot(buildingId, material, 'depositInput').id, amount);
    }

    depositOutput(buildingId: number, material: EMaterialType, amount: number): number {
        return this.deposit(this.requireOutputSlot(buildingId, material, 'depositOutput').id, amount);
    }

    withdrawInput(buildingId: number, material: EMaterialType, amount: number): number {
        return this.withdraw(this.requireInputSlot(buildingId, material, 'withdrawInput').id, amount);
    }

    withdrawOutput(buildingId: number, material: EMaterialType, amount: number): number {
        return this.withdraw(this.requireOutputSlot(buildingId, material, 'withdrawOutput').id, amount);
    }

    getInputAmount(buildingId: number, material: EMaterialType): number {
        return this.findInputSlot(buildingId, material)?.currentAmount ?? 0;
    }

    getOutputAmount(buildingId: number, material: EMaterialType): number {
        return this.findOutputSlot(buildingId, material)?.currentAmount ?? 0;
    }

    /** Total available input space across all matching slots. */
    getInputSpace(buildingId: number, material: EMaterialType): number {
        return getInputSpaceFn(this.inventorySlots, this.slotStore, buildingId, material);
    }

    canStartProduction(buildingId: number, recipe?: Recipe): boolean {
        return canStartProductionFn(this, this.getDeps().gameState, buildingId, recipe);
    }

    consumeProductionInputs(buildingId: number, recipe?: Recipe): boolean {
        return consumeProductionInputsFn(this, this.getDeps().gameState, buildingId, recipe);
    }

    produceOutput(buildingId: number, recipe?: Recipe): boolean {
        return produceOutputFn(this, this.getDeps().gameState, buildingId, recipe);
    }

    canStoreOutput(buildingId: number, recipe?: Recipe): boolean {
        return canStoreOutputFn(this, this.getDeps().gameState, buildingId, recipe);
    }
    /** Returns an iterable of building IDs that have slots. */
    getAllInventories(): IterableIterator<number> {
        return this.inventorySlots.keys();
    }

    getSourcesWithOutput(material: EMaterialType, minAmount = 1): number[] {
        return getSourcesWithOutputFn(this.inventorySlots, this.slotStore, material, minAmount);
    }

    getSinksNeedingInput(material: EMaterialType, minSpace = 1): number[] {
        return getSinksNeedingInputFn(this.inventorySlots, this.slotStore, material, minSpace);
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
        const slotId = this.nextSlotIdStore.get();
        this.nextSlotIdStore.set(slotId + 1);
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
        this.slotStore.set(slotId, slot);
        this.getInventorySlotSet(entityId).add(slotId);
        this._entityIndex.set(entityId, slotId);
    }

    clear(): void {
        this.slotStore.clear();
        this.nextSlotIdStore.set(1);
        this.throughputStore.get().clear();
        this.inventorySlots.clear();
        this._entityIndex.clear();
    }

    /**
     * Rebuild the buildingId → slotIds reverse index from the slotStore.
     * Must be called after the PersistentMap is restored from a snapshot.
     */
    rebuildInventoryIndex(): void {
        this.inventorySlots.clear();
        this._entityIndex.clear();
        for (const slot of this.slotStore.values()) {
            if (slot.buildingId !== null) {
                this.getInventorySlotSet(slot.buildingId).add(slot.id);
            }
            if (slot.entityId !== null) {
                this._entityIndex.set(slot.entityId, slot.id);
            }
        }
    }
    private *buildingStoreEntries(): IterableIterator<[number, BuildingInventoryView]> {
        for (const [buildingId, slotIds] of this.inventorySlots) {
            yield [buildingId, { buildingId, slotIds }];
        }
    }

    private addSlot(buildingId: number, cfg: SlotConfig, kind: SlotKind, position: TileCoord): void {
        const slotId = this.nextSlotIdStore.get();
        this.nextSlotIdStore.set(slotId + 1);
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
        this.slotStore.set(slotId, slot);
        this.getInventorySlotSet(buildingId).add(slotId);
        log.debug(`createSlot: building=${buildingId}, slotId=${slotId}, kind=${kind}, material=${cfg.materialType}`);
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
        return findInputSlot(this.inventorySlots, this.slotStore, buildingId, material);
    }

    findOutputSlot(buildingId: number, material: EMaterialType): PileSlot | undefined {
        return findOutputSlot(this.inventorySlots, this.slotStore, buildingId, material);
    }

    private requireInputSlot(buildingId: number, material: EMaterialType, ctx: string): PileSlot {
        return requireInputSlot(this.inventorySlots, this.slotStore, buildingId, material, ctx);
    }

    private requireOutputSlot(buildingId: number, material: EMaterialType, ctx: string): PileSlot {
        return requireOutputSlot(this.inventorySlots, this.slotStore, buildingId, material, ctx);
    }

    private recordThroughputIn(buildingId: number, materialType: EMaterialType, amount: number): void {
        getOrCreateThroughput(this.throughputStore.get(), buildingId, materialType).totalIn += amount;
    }

    private recordThroughputOut(buildingId: number, materialType: EMaterialType, amount: number): void {
        getOrCreateThroughput(this.throughputStore.get(), buildingId, materialType).totalOut += amount;
    }

    private emitChanged(slot: PileSlot, previousAmount: number): void {
        if (!this.deps || slot.currentAmount === previousAmount) {
            return;
        }
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
