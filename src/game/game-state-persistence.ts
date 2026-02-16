/**
 * Game state persistence - auto-saves to localStorage every few seconds.
 * Uses a simple approach: serialize state, reload via existing create methods.
 */

import type { Game } from './game';
import { EntityType } from './entity';
import { BuildingConstructionPhase } from './features/building-construction';
import type { EMaterialType } from './economy/material-type';
import { CarrierStatus } from './features/carriers/carrier-state';
import type { TreeStage } from './systems/tree-system';
import { type RequestPriority, RequestStatus } from './features/logistics/resource-request';

const STORAGE_KEY = 'settlers_game_state';
const INITIAL_STATE_KEY = 'settlers_initial_state';
const AUTO_SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
const SNAPSHOT_VERSION = 5; // Bumped for terrain persistence

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
 */
export interface SerializedProduction {
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
    /** Resource requests (pending and in-progress) */
    requests?: SerializedRequest[];
    /** Production cycle progress per building */
    productions?: SerializedProduction[];
    /** Modified terrain ground types (base64-encoded Uint8Array) */
    terrainGroundType?: string;
    /** Modified terrain ground heights (base64-encoded Uint8Array) */
    terrainGroundHeight?: string;
}

/** Current map identifier for save/load matching */
let currentMapId: string = '';

/**
 * Set the current map identifier. Must be called when loading a map.
 */
export function setCurrentMapId(mapId: string): void {
    currentMapId = mapId;
}

// === Base64 encoding for typed arrays ===

function uint8ArrayToBase64(arr: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < arr.length; i++) {
        binary += String.fromCharCode(arr[i]);
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
    for (const inv of game.gameLoop.inventoryManager.getAllInventories()) {
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
    for (const carrier of game.gameLoop.carrierManager.getAllCarriers()) {
        const entity = game.state.getEntity(carrier.entityId);
        result.push({
            entityId: carrier.entityId,
            homeBuilding: carrier.homeBuilding,
            status: carrier.status,
            fatigue: carrier.fatigue,
            carryingMaterial: entity?.carrying?.material ?? null,
            carryingAmount: entity?.carrying?.amount ?? 0,
        });
    }
    return result;
}

function serializeEntityState(game: Game): {
    trees: SerializedTree[];
    productions: SerializedProduction[];
} {
    const trees: SerializedTree[] = [];
    const productions: SerializedProduction[] = [];
    for (const entity of game.state.entities) {
        if (entity.tree) {
            trees.push({
                entityId: entity.id,
                stage: entity.tree.stage,
                progress: entity.tree.progress,
                stumpTimer: entity.tree.stumpTimer,
                currentOffset: entity.tree.currentOffset,
            });
        }
        // Production progress is now tracked by SettlerTaskSystem workers, not entity state
    }
    return { trees, productions };
}

function serializeRequests(game: Game): SerializedRequest[] {
    const result: SerializedRequest[] = [];
    for (const req of game.gameLoop.requestManager.getAllRequests()) {
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
    const { buildingStateManager } = game.gameLoop;

    const entities = gameState.entities.map(e => ({
        id: e.id,
        type: e.type,
        subType: e.subType,
        x: e.x,
        y: e.y,
        player: e.player,
        variation: e.variation,
    }));

    const resourceQuantities: Array<{ entityId: number; quantity: number; buildingId?: number }> = [];
    for (const [entityId, state] of gameState.resourceStates) {
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

    const { trees, productions } = serializeEntityState(game);

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
        trees,
        requests: serializeRequests(game),
        productions,
        terrainGroundType: uint8ArrayToBase64(game.groundType),
        terrainGroundHeight: uint8ArrayToBase64(game.groundHeight),
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
 * Check if there's a saved game state.
 */
export function hasSavedGameState(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

// === Restore Helpers ===

function restoreEntities(game: Game, snapshot: GameStateSnapshot): void {
    const state = game.state;
    const { buildingStateManager } = game.gameLoop;

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

    // Recreate entities using the normal addEntity path
    // This emits entity lifecycle events (building:created, mapObject:created, etc.)
    for (const e of snapshot.entities) {
        const savedNextId = state.nextId;
        state.nextId = e.id;

        state.addEntity(e.type, e.subType, e.x, e.y, e.player, undefined, e.variation);
        state.nextId = Math.max(savedNextId, e.id + 1);

        // Restore building state (overwrites the fresh state created by addEntity)
        if (e.type === EntityType.Building) {
            const saved = savedBuildingStates.get(e.id);
            if (saved) {
                buildingStateManager.restoreBuildingState({
                    entityId: e.id,
                    buildingType: e.subType,
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

        // Restore tree state (overwrites the fresh state created by register())
        if (e.type === EntityType.MapObject) {
            const savedTree = savedTreeStates.get(e.id);
            if (savedTree) {
                const entity = state.getEntity(e.id);
                if (entity) {
                    entity.tree = {
                        stage: savedTree.stage,
                        progress: savedTree.progress,
                        stumpTimer: savedTree.stumpTimer,
                        currentOffset: savedTree.currentOffset,
                    };
                    entity.variation = savedTree.currentOffset;
                }
            }
        }
    }
}

function restoreResourceQuantities(game: Game, snapshot: GameStateSnapshot): void {
    for (const rq of snapshot.resourceQuantities) {
        const resourceState = game.state.resourceStates.get(rq.entityId);
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
        game.gameLoop.inventoryManager.restoreInventory({
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

        game.gameLoop.carrierManager.restoreCarrier({
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
        game.gameLoop.requestManager.restoreRequest({
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

function restoreProductions(_game: Game, _snapshot: GameStateSnapshot): void {
    // Production progress is now tracked by SettlerTaskSystem workers.
    // Kept for backward compatibility with saved snapshots.
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
        game.groundType.set(restored);
    }
    if (snapshot.terrainGroundHeight) {
        const restored = base64ToUint8Array(snapshot.terrainGroundHeight);
        game.groundHeight.set(restored);
    }
    if (snapshot.terrainGroundType || snapshot.terrainGroundHeight) {
        game.eventBus.emit('terrain:modified', {});
    }

    // Restore feature state
    restoreResourceQuantities(game, snapshot);
    restoreInventories(game, snapshot);
    restoreCarriers(game, snapshot);
    restoreRequests(game, snapshot);
    restoreProductions(game, snapshot);

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
