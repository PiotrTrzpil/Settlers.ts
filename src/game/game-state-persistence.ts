/**
 * Game state persistence - auto-saves to localStorage every few seconds.
 * Uses a simple approach: serialize state, reload via existing create methods.
 */

import type { Game } from './game';
import { EntityType } from './entity';
import type { CarryingState } from './entity';
import type { Race } from './race';
import { BuildingConstructionPhase } from './features/building-construction';
import type { EMaterialType } from './economy/material-type';
import { CarrierStatus } from './features/carriers/carrier-state';
import type { TreeStage } from './features/trees/tree-system';
import type { StoneStage } from './features/stones/stone-system';
import { type RequestPriority, RequestStatus } from './features/logistics/resource-request';

const STORAGE_KEY = 'settlers_game_state';
const INITIAL_STATE_KEY = 'settlers_initial_state';
const LAST_MAP_KEY = 'settlers_last_map';
const AUTO_SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
const SNAPSHOT_VERSION = 8; // Bumped for work area instance offsets

/**
 * Serialized building construction state.
 */
export interface SerializedBuildingState {
    entityId: number;
    phase: BuildingConstructionPhase;
    phaseProgress: number;
    totalDuration: number;
    elapsedTime: number;
    terrainModified: boolean;
}

/**
 * Serialized inventory slot state.
 */
export interface SerializedInventorySlot {
    materialType: EMaterialType;
    current: number;
    max: number;
    reserved: number;
}

/**
 * Serialized building inventory state.
 */
export interface SerializedBuildingInventory {
    entityId: number;
    buildingType: number;
    inputSlots: SerializedInventorySlot[];
    outputSlots: SerializedInventorySlot[];
}

/**
 * Serialized carrier state.
 */
export interface SerializedCarrier {
    entityId: number;
    homeBuilding: number;
    status: CarrierStatus;
    fatigue: number;
    carryingMaterial: EMaterialType | null;
    carryingAmount: number;
}

/**
 * Serialized tree state.
 */
export interface SerializedTree {
    entityId: number;
    stage: TreeStage;
    progress: number;
    stumpTimer: number;
    currentOffset: number;
    variant?: number;
}

/**
 * Serialized stone state.
 */
export interface SerializedStone {
    entityId: number;
    stage: StoneStage;
    variant: number;
    level: number;
}

/**
 * Serialized resource request.
 */
export interface SerializedRequest {
    id: number;
    buildingId: number;
    materialType: EMaterialType;
    amount: number;
    priority: RequestPriority;
    timestamp: number;
    status: RequestStatus;
    assignedCarrier: number | null;
    sourceBuilding: number | null;
    assignedAt: number | null;
}

/**
 * Serialized production state for a building.
 * @deprecated Kept for backward compatibility with saved snapshots (v5).
 * Production progress is now tracked by SettlerTaskSystem workers.
 */
interface SerializedProduction {
    entityId: number;
    progress: number;
}

/**
 * Minimal snapshot - entities, positions, and critical game state.
 */
export interface GameStateSnapshot {
    version: number;
    timestamp: number;
    /** Map identifier - only restore if loading the same map */
    mapId: string;
    entities: Array<{
        id: number;
        type: EntityType;
        subType: number;
        x: number;
        y: number;
        player: number;
        variation?: number;
        race?: Race;
        carrying?: CarryingState;
        hidden?: boolean;
    }>;
    nextId: number;
    rngSeed: number;
    /** Resource stack quantities and building ownership */
    resourceQuantities: Array<{ entityId: number; quantity: number; buildingId?: number }>;
    /** Building construction states (phase, progress, etc.) */
    buildingStates?: SerializedBuildingState[];
    /** Building inventory states (input/output slot amounts) */
    buildingInventories?: SerializedBuildingInventory[];
    /** Carrier states (home building, fatigue, carrying) */
    carriers?: SerializedCarrier[];
    /** Tree states (stage, progress, stump timer) */
    trees?: SerializedTree[];
    /** Stone states (depletion level, variant) */
    stones?: SerializedStone[];
    /** Resource requests (pending and in-progress) */
    requests?: SerializedRequest[];
    /** Production cycle progress per building (deprecated v5 field, kept for backward compat) */
    // eslint-disable-next-line @typescript-eslint/no-deprecated, sonarjs/deprecation -- backward compat with saved snapshots (v5)
    productions?: SerializedProduction[];
    /** Modified terrain ground types (base64-encoded Uint8Array) */
    terrainGroundType?: string;
    /** Modified terrain ground heights (base64-encoded Uint8Array) */
    terrainGroundHeight?: string;
    /** Per-building work area center overrides (entityId → tile offset) */
    workAreaOffsets?: Array<{ entityId: number; dx: number; dy: number }>;
}

/** Current map identifier for save/load matching */
let currentMapId: string = '';

/**
 * Set the current map identifier. Must be called when loading a map.
 * Also persists to localStorage so the correct map can be loaded on refresh.
 */
export function setCurrentMapId(mapId: string): void {
    currentMapId = mapId;
    try {
        localStorage.setItem(LAST_MAP_KEY, mapId);
    } catch {
        // localStorage may be unavailable
    }
}

/** Get the current in-memory map ID (set when a map is loaded). */
export function getCurrentMapId(): string {
    return currentMapId;
}

/**
 * Get the last-loaded map ID from localStorage.
 * Returns null if no map was previously loaded.
 */
export function getLastMapId(): string | null {
    try {
        return localStorage.getItem(LAST_MAP_KEY);
    } catch {
        return null;
    }
}

// === Base64 encoding for typed arrays ===

function uint8ArrayToBase64(arr: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < arr.length; i++) {
        binary += String.fromCharCode(arr[i]!);
    }
    return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        arr[i] = binary.charCodeAt(i);
    }
    return arr;
}

// === Serialization Helpers ===

interface SlotLike {
    materialType: EMaterialType;
    currentAmount: number;
    maxCapacity: number;
    reservedAmount: number;
}

function serializeSlots(slots: SlotLike[]): SerializedInventorySlot[] {
    return slots.map(s => ({
        materialType: s.materialType,
        current: s.currentAmount,
        max: s.maxCapacity,
        reserved: s.reservedAmount,
    }));
}

function serializeInventories(game: Game): SerializedBuildingInventory[] {
    const result: SerializedBuildingInventory[] = [];
    for (const inv of game.services.inventoryManager.getAllInventories()) {
        result.push({
            entityId: inv.buildingId,
            buildingType: inv.buildingType,
            inputSlots: serializeSlots(inv.inputSlots),
            outputSlots: serializeSlots(inv.outputSlots),
        });
    }
    return result;
}

function serializeCarriers(game: Game): SerializedCarrier[] {
    const result: SerializedCarrier[] = [];
    for (const carrier of game.services.carrierManager.getAllCarriers()) {
        const entity = game.state.getEntityOrThrow(carrier.entityId, 'carrier serialization');
        result.push({
            entityId: carrier.entityId,
            homeBuilding: carrier.homeBuilding,
            status: carrier.status,
            fatigue: carrier.fatigue,
            carryingMaterial: entity.carrying?.material ?? null,
            carryingAmount: entity.carrying?.amount ?? 0,
        });
    }
    return result;
}

function serializeTrees(game: Game): SerializedTree[] {
    const trees: SerializedTree[] = [];
    for (const [entityId, state] of game.services.treeSystem.getAllTreeStates()) {
        trees.push({
            entityId,
            stage: state.stage,
            progress: state.progress,
            stumpTimer: state.stumpTimer,
            currentOffset: state.currentOffset,
            variant: state.variant,
        });
    }
    return trees;
}

function serializeStones(game: Game): SerializedStone[] {
    const stones: SerializedStone[] = [];
    for (const entity of game.state.entities) {
        if (entity.type !== EntityType.MapObject) continue;
        const state = game.services.stoneSystem.getStoneState(entity.id);
        if (!state) continue;
        stones.push({
            entityId: entity.id,
            stage: state.stage,
            variant: state.variant,
            level: state.level,
        });
    }
    return stones;
}

function serializeRequests(game: Game): SerializedRequest[] {
    const result: SerializedRequest[] = [];
    for (const req of game.services.requestManager.getAllRequests()) {
        result.push({
            id: req.id,
            buildingId: req.buildingId,
            materialType: req.materialType,
            amount: req.amount,
            priority: req.priority,
            timestamp: req.timestamp,
            status: req.status,
            assignedCarrier: req.assignedCarrier,
            sourceBuilding: req.sourceBuilding,
            assignedAt: req.assignedAt,
        });
    }
    return result;
}

/**
 * Serialize game state to a minimal snapshot.
 */
export function createSnapshot(game: Game): GameStateSnapshot {
    const gameState = game.state;
    const { buildingStateManager } = game.services;

    const entities = gameState.entities.map(e => ({
        id: e.id,
        type: e.type,
        subType: e.subType,
        x: e.x,
        y: e.y,
        player: e.player,
        variation: game.services.visualService.getState(e.id)?.variation ?? 0,
        race: e.race,
        carrying: e.carrying,
        hidden: e.hidden || undefined,
    }));

    const resourceQuantities: Array<{ entityId: number; quantity: number; buildingId?: number }> = [];
    for (const [entityId, state] of gameState.resources.states) {
        resourceQuantities.push({ entityId, quantity: state.quantity, buildingId: state.buildingId });
    }

    const buildingStates: SerializedBuildingState[] = [];
    for (const state of buildingStateManager.getAllBuildingStates()) {
        buildingStates.push({
            entityId: state.entityId,
            phase: state.phase,
            phaseProgress: state.phaseProgress,
            totalDuration: state.totalDuration,
            elapsedTime: state.elapsedTime,
            terrainModified: state.terrainModified,
        });
    }

    return {
        version: SNAPSHOT_VERSION,
        timestamp: Date.now(),
        mapId: currentMapId,
        entities,
        nextId: gameState.nextId,
        rngSeed: gameState.rng.getState(),
        resourceQuantities,
        buildingStates,
        buildingInventories: serializeInventories(game),
        carriers: serializeCarriers(game),
        trees: serializeTrees(game),
        stones: serializeStones(game),
        requests: serializeRequests(game),
        terrainGroundType: uint8ArrayToBase64(game.terrain.groundType),
        terrainGroundHeight: uint8ArrayToBase64(game.terrain.groundHeight),
        workAreaOffsets: game.services.workAreaStore.serializeInstanceOffsets(),
    };
}

/**
 * Save game state to localStorage.
 */
export function saveGameState(game: Game): boolean {
    try {
        const snapshot = createSnapshot(game);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        return true;
    } catch (e) {
        console.warn('Failed to save game state:', e);
        return false;
    }
}

/**
 * Load saved snapshot from localStorage.
 * Only returns snapshot if it matches the current map.
 */
export function loadSnapshot(): GameStateSnapshot | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return null;

        const snapshot = JSON.parse(stored) as GameStateSnapshot;
        if (snapshot.version !== SNAPSHOT_VERSION) {
            console.warn(`Snapshot version mismatch: ${snapshot.version} !== ${SNAPSHOT_VERSION}`);
            return null;
        }

        // Only restore if same map
        if (snapshot.mapId !== currentMapId) {
            console.log(`Snapshot is for different map (${snapshot.mapId}), not restoring`);
            return null;
        }

        return snapshot;
    } catch (e) {
        console.warn('Failed to load game state:', e);
        return null;
    }
}

/**
 * Clear saved game state.
 */
export function clearSavedGameState(): void {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Strip MapObject entities and tree states from the saved snapshot.
 * Used when the tree expansion setting changes so the next reload
 * re-populates trees from map data with the new setting.
 */
export function clearSavedTreeState(): void {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return;

        const snapshot = JSON.parse(stored) as GameStateSnapshot;
        const treeIds = new Set(snapshot.entities.filter(e => e.type === EntityType.MapObject).map(e => e.id));
        snapshot.entities = snapshot.entities.filter(e => e.type !== EntityType.MapObject);
        snapshot.trees = [];
        snapshot.stones = [];
        // Drop resource quantities that belonged to map object entities
        snapshot.resourceQuantities = snapshot.resourceQuantities.filter(r => !treeIds.has(r.entityId));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
        // If anything fails, just clear the whole thing
        localStorage.removeItem(STORAGE_KEY);
    }
}

/**
 * Check if there's a saved game state.
 */
export function hasSavedGameState(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

// === Restore Helpers ===

/** Restore entity properties that addEntity doesn't set (race, carrying, hidden). */
function restoreEntityProps(entity: import('./entity').Entity, saved: GameStateSnapshot['entities'][number]): void {
    if (saved.race !== undefined) entity.race = saved.race;
    if (saved.carrying) entity.carrying = saved.carrying;
    if (saved.hidden) entity.hidden = saved.hidden;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- complex entity restoration from snapshot
function restoreEntities(game: Game, snapshot: GameStateSnapshot): void {
    const state = game.state;
    const { buildingStateManager } = game.services;

    // Build lookup maps for per-entity overrides
    const savedBuildingStates = new Map<number, SerializedBuildingState>();
    if (snapshot.buildingStates) {
        for (const bs of snapshot.buildingStates) {
            savedBuildingStates.set(bs.entityId, bs);
        }
    }
    const savedTreeStates = new Map<number, SerializedTree>();
    if (snapshot.trees) {
        for (const t of snapshot.trees) {
            savedTreeStates.set(t.entityId, t);
        }
    }
    const savedStoneStates = new Map<number, SerializedStone>();
    if (snapshot.stones) {
        for (const s of snapshot.stones) {
            savedStoneStates.set(s.entityId, s);
        }
    }

    // Recreate entities using the normal addEntity path
    // This emits entity:created events — subscribers handle type-specific initialization
    for (const e of snapshot.entities) {
        const savedNextId = state.nextId;
        state.nextId = e.id;

        const entity = state.addEntity(e.type, e.subType, e.x, e.y, e.player, undefined, e.variation, e.race);
        state.nextId = Math.max(savedNextId, e.id + 1);

        // Restore per-entity properties not covered by addEntity
        restoreEntityProps(entity, e);

        // Restore building state (overwrites the fresh state created by addEntity)
        if (e.type === EntityType.Building) {
            const saved = savedBuildingStates.get(e.id);
            if (saved) {
                if (e.race === undefined) {
                    throw new Error(`Building entity ${e.id} in snapshot is missing race — snapshot is incompatible`);
                }
                buildingStateManager.restoreBuildingState({
                    entityId: e.id,
                    buildingType: e.subType,
                    race: e.race,
                    tileX: e.x,
                    tileY: e.y,
                    phase: saved.phase,
                    phaseProgress: saved.phaseProgress,
                    totalDuration: saved.totalDuration,
                    elapsedTime: saved.elapsedTime,
                    terrainModified: saved.terrainModified,
                });
            }
        }

        // Restore map object state (overwrites the fresh state created by register())
        if (e.type === EntityType.MapObject) {
            const savedTree = savedTreeStates.get(e.id);
            if (savedTree) {
                game.services.treeSystem.restoreTreeState(e.id, {
                    stage: savedTree.stage,
                    progress: savedTree.progress,
                    stumpTimer: savedTree.stumpTimer,
                    currentOffset: savedTree.currentOffset,
                    variant: savedTree.variant ?? 0,
                });
            }
            const savedStone = savedStoneStates.get(e.id);
            if (savedStone) {
                game.services.stoneSystem.restoreStoneState(e.id, {
                    stage: savedStone.stage,
                    variant: savedStone.variant,
                    level: savedStone.level,
                });
            }
        }
    }
}

function restoreResourceQuantities(game: Game, snapshot: GameStateSnapshot): void {
    for (const rq of snapshot.resourceQuantities) {
        const resourceState = game.state.resources.states.get(rq.entityId);
        if (resourceState) {
            resourceState.quantity = rq.quantity;
            resourceState.buildingId = rq.buildingId;
        }
    }
}

function restoreInventories(game: Game, snapshot: GameStateSnapshot): void {
    if (!snapshot.buildingInventories) return;
    // Reset reservations to 0 since in-progress requests are reset to pending
    for (const inv of snapshot.buildingInventories) {
        game.services.inventoryManager.restoreInventory({
            ...inv,
            inputSlots: inv.inputSlots.map(s => ({ ...s, reserved: 0 })),
            outputSlots: inv.outputSlots.map(s => ({ ...s, reserved: 0 })),
        });
    }
}

function restoreCarriers(game: Game, snapshot: GameStateSnapshot): void {
    if (!snapshot.carriers) return;
    for (const c of snapshot.carriers) {
        // Reset job-dependent statuses to Idle since jobs aren't persisted
        const isJobStatus =
            c.status === CarrierStatus.Walking ||
            c.status === CarrierStatus.PickingUp ||
            c.status === CarrierStatus.Delivering;

        game.services.carrierManager.restoreCarrier({
            entityId: c.entityId,
            homeBuilding: c.homeBuilding,
            status: isJobStatus ? CarrierStatus.Idle : c.status,
            fatigue: c.fatigue,
            carryingMaterial: c.carryingMaterial,
            carryingAmount: c.carryingAmount,
        });
    }
}

function restoreRequests(game: Game, snapshot: GameStateSnapshot): void {
    if (!snapshot.requests) return;
    // Reset in-progress requests to pending since carriers restart idle
    for (const req of snapshot.requests) {
        const wasInProgress = req.status === RequestStatus.InProgress;
        game.services.requestManager.restoreRequest({
            id: req.id,
            buildingId: req.buildingId,
            materialType: req.materialType,
            amount: req.amount,
            priority: req.priority,
            timestamp: req.timestamp,
            status: wasInProgress ? RequestStatus.Pending : req.status,
            assignedCarrier: wasInProgress ? null : req.assignedCarrier,
            sourceBuilding: wasInProgress ? null : req.sourceBuilding,
            assignedAt: wasInProgress ? null : req.assignedAt,
        });
    }
}

/**
 * Restore game state from a snapshot using normal entity creation.
 * Must be called on a fresh Game instance (entities array should be empty or will be cleared).
 */
export function restoreFromSnapshot(game: Game, snapshot: GameStateSnapshot): void {
    // Clear existing entities via the normal removal path
    const existingIds = game.state.entities.map(e => e.id);
    for (const id of existingIds) {
        game.execute({ type: 'remove_entity', entityId: id });
    }

    // Restore RNG state and nextId
    game.state.rng.setState(snapshot.rngSeed);
    game.state.nextId = snapshot.nextId;

    // Recreate entities with their per-entity state overrides
    restoreEntities(game, snapshot);

    // Restore terrain modifications (raw ground, leveling)
    if (snapshot.terrainGroundType) {
        const restored = base64ToUint8Array(snapshot.terrainGroundType);
        game.terrain.groundType.set(restored);
    }
    if (snapshot.terrainGroundHeight) {
        const restored = base64ToUint8Array(snapshot.terrainGroundHeight);
        game.terrain.groundHeight.set(restored);
    }
    if (snapshot.terrainGroundType || snapshot.terrainGroundHeight) {
        game.eventBus.emit('terrain:modified', {});
    }

    // Restore feature state
    restoreResourceQuantities(game, snapshot);
    restoreInventories(game, snapshot);
    restoreCarriers(game, snapshot);
    restoreRequests(game, snapshot);
    if (snapshot.workAreaOffsets) {
        game.services.workAreaStore.restoreInstanceOffsets(snapshot.workAreaOffsets);
    }

    console.log(`GameState: Restored ${snapshot.entities.length} entities from snapshot`);
}

/**
 * Save initial map state (called once after map loads, before auto-save).
 * Used to restore to the original map state when resetting.
 */
export function saveInitialState(game: Game): boolean {
    try {
        const snapshot = createSnapshot(game);
        localStorage.setItem(INITIAL_STATE_KEY, JSON.stringify(snapshot));
        console.log(`GameState: Saved initial state with ${snapshot.entities.length} entities`);
        return true;
    } catch (e) {
        console.warn('Failed to save initial state:', e);
        return false;
    }
}

/**
 * Load initial map state (for resetting to original state).
 * Only returns snapshot if it matches the current map.
 */
export function loadInitialState(): GameStateSnapshot | null {
    try {
        const stored = localStorage.getItem(INITIAL_STATE_KEY);
        if (!stored) return null;

        const snapshot = JSON.parse(stored) as GameStateSnapshot;
        // Version check is less strict for initial state - it's from the same session
        if (snapshot.mapId !== currentMapId) {
            console.log(`Initial state is for different map (${snapshot.mapId}), not available`);
            return null;
        }

        return snapshot;
    } catch (e) {
        console.warn('Failed to load initial state:', e);
        return null;
    }
}

/**
 * Clear initial state (called when loading a new map).
 */
export function clearInitialState(): void {
    localStorage.removeItem(INITIAL_STATE_KEY);
}

/**
 * Auto-save manager that periodically saves game state.
 */
class GameStatePersistence {
    private game: Game | null = null;
    private saveIntervalId: ReturnType<typeof setInterval> | null = null;
    private enabled = true;

    /**
     * Start auto-saving.
     * Note: Initial state should be saved BEFORE calling this (via saveInitialState).
     */
    start(game: Game): void {
        this.game = game;

        if (this.saveIntervalId) {
            clearInterval(this.saveIntervalId);
        }

        this.saveIntervalId = setInterval(() => {
            if (this.enabled && this.game) {
                saveGameState(this.game);
            }
        }, AUTO_SAVE_INTERVAL_MS);

        // Save immediately
        if (this.enabled) {
            saveGameState(game);
        }
    }

    /** Stop auto-saving. */
    stop(): void {
        if (this.saveIntervalId) {
            clearInterval(this.saveIntervalId);
            this.saveIntervalId = null;
        }
    }

    /** Enable/disable auto-saving. */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /** Check if enabled. */
    isEnabled(): boolean {
        return this.enabled;
    }

    /** Force immediate save. */
    saveNow(): boolean {
        if (this.game) {
            return saveGameState(this.game);
        }
        return false;
    }

    /** Clear saved state. */
    reset(): void {
        clearSavedGameState();
    }

    /** Clear initial state (call when loading a new map). */
    resetForNewMap(): void {
        clearInitialState();
    }

    /**
     * Restore to initial map state (used by reset button).
     * Returns true if successful, false if no initial state available.
     */
    restoreToInitialState(game: Game): boolean {
        const initialSnapshot = loadInitialState();
        if (!initialSnapshot) {
            console.warn('No initial state available for reset');
            return false;
        }

        restoreFromSnapshot(game, initialSnapshot);
        console.log('GameState: Restored to initial map state');
        return true;
    }
}

// Singleton
export const gameStatePersistence = new GameStatePersistence();
