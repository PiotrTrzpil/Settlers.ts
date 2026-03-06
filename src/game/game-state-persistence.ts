/**
 * Game state persistence - auto-saves to localStorage every few seconds.
 * Uses a simple approach: serialize state, reload via existing create methods.
 */

import type { Game } from './game';
import { EntityType } from './entity';
import type { CarryingState, Entity } from './entity';
import type { Race } from './race';
import type { EMaterialType } from './economy/material-type';
import type { TreeStage } from './features/trees/tree-system';
import type { StoneStage } from './features/stones/stone-system';
import type { RequestPriority, RequestStatus } from './features/logistics/resource-request';
import type { SerializedConstructionSite } from './features/building-construction';

const STORAGE_KEY = 'settlers_game_state';
const INITIAL_STATE_KEY = 'settlers_initial_state';
const LAST_MAP_KEY = 'settlers_last_map';
const AUTO_SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
// Bumped: persistence for crops, storage filters, production control, residence spawns,
// resource signs, combat, barracks training, auto-recruit
const SNAPSHOT_VERSION = 11;

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
 * Serialized crop state.
 */
export interface SerializedCrop {
    entityId: number;
    stage: number; // CropStage enum
    cropType: number; // MapObjectType enum
    progress: number;
    decayTimer: number;
    currentOffset: number;
}

/**
 * Serialized storage filter state.
 */
export interface SerializedStorageFilter {
    buildingId: number;
    materials: number[]; // EMaterialType values
}

/**
 * Serialized production control state.
 */
export interface SerializedProductionControl {
    buildingId: number;
    mode: string; // ProductionMode string
    recipeCount: number;
    roundRobinIndex: number;
    proportions: Array<{ index: number; weight: number }>;
    queue: number[];
    productionCounts: Array<{ index: number; count: number }>;
}

/**
 * Serialized pending spawn state for residence buildings.
 */
export interface SerializedPendingSpawn {
    buildingEntityId: number;
    remaining: number;
    timer: number;
    unitType: number;
    count: number;
    spawnInterval: number;
}

/**
 * Serialized resource sign state.
 */
export interface SerializedResourceSign {
    elapsed: number;
    signs: Array<{ entityId: number; x: number; y: number; expiresAt: number }>;
}

/**
 * Serialized combat unit state.
 */
export interface SerializedCombatUnit {
    entityId: number;
    health: number;
    maxHealth: number;
}

/**
 * Serialized barracks training state.
 */
export interface SerializedBarracksTraining {
    races: Array<{ buildingId: number; race: number }>;
    activeTrainings: Array<{
        buildingId: number;
        carrierId: number;
        recipe: { inputs: Array<{ material: number; count: number }>; unitType: number; level: number };
    }>;
}

/**
 * Serialized auto-recruit state.
 */
export interface SerializedAutoRecruit {
    accumulatedTime: number;
    playerStates: Array<{
        player: number;
        pendingDiggers: number;
        pendingBuilders: number;
        recruitments: Array<{
            carrierId: number;
            targetUnitType: number;
            toolMaterial: number;
            pileEntityId: number;
            siteId: number;
        }>;
    }>;
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
    /** Active construction sites (buildings currently under construction) */
    constructionSites?: SerializedConstructionSite[];
    /** Building inventory states (input/output slot amounts) */
    buildingInventories?: SerializedBuildingInventory[];
    /** Carrier states (status, carrying) */
    carriers?: SerializedCarrier[];
    /** Tree states (stage, progress, stump timer) */
    trees?: SerializedTree[];
    /** Stone states (depletion level, variant) */
    stones?: SerializedStone[];
    /** Crop states (stage, progress, decay) */
    crops?: SerializedCrop[];
    /** Storage filter configurations per building */
    storageFilters?: SerializedStorageFilter[];
    /** Production control states per building */
    productionControl?: SerializedProductionControl[];
    /** Pending residence spawns */
    residenceSpawns?: SerializedPendingSpawn[];
    /** Resource sign state (elapsed timer + active signs) */
    resourceSigns?: SerializedResourceSign;
    /** Combat unit health states */
    combat?: SerializedCombatUnit[];
    /** Barracks training state (races + active trainings) */
    barracksTraining?: SerializedBarracksTraining;
    /** Auto-recruit state (accumulated time + per-player recruitments) */
    autoRecruit?: SerializedAutoRecruit;
    /** Resource requests (pending and in-progress) */
    requests?: SerializedRequest[];
    /** Production cycle progress per building (deprecated v5 field, kept for backward compat) */
    // eslint-disable-next-line @typescript-eslint/no-deprecated, sonarjs/deprecation -- backward compat with saved snapshots (v5)
    productions?: SerializedProduction[];
    /** Modified terrain ground types (base64-encoded Uint8Array) — full copy, used in initial state */
    terrainGroundType?: string;
    /** Modified terrain ground heights (base64-encoded Uint8Array) — full copy, used in initial state */
    terrainGroundHeight?: string;
    /** Sparse terrain ground type diff vs initial state (base64 Uint32 pairs: [index, value, ...]) */
    terrainGroundTypeDiff?: string;
    /** Sparse terrain ground height diff vs initial state (base64 Uint32 pairs: [index, value, ...]) */
    terrainGroundHeightDiff?: string;
    /** Per-building work area center overrides (entityId → tile offset) */
    workAreaOffsets?: Array<{ entityId: number; dx: number; dy: number }>;
}

/** Current map identifier for save/load matching */
let currentMapId: string = '';

/** Initial terrain cached by saveInitialState; lets auto-saves store sparse diffs instead of full arrays. */
let _cachedInitialGroundType: Uint8Array | null = null;
let _cachedInitialGroundHeight: Uint8Array | null = null;

/** In-memory fallback for initial state when localStorage is unavailable/full */
let _cachedInitialSnapshot: GameStateSnapshot | null = null;

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

// === Terrain diff helpers ===

/** Encode changed tiles as base64 Uint32 pairs [index, value, …]. Returns null if nothing changed. */
function encodeTerrainDiff(current: Uint8Array, initial: Uint8Array): string | null {
    const pairs: number[] = [];
    for (let i = 0; i < current.length; i++) {
        if (current[i] !== initial[i]) {
            pairs.push(i, current[i]!);
        }
    }
    if (pairs.length === 0) return null;
    return uint8ArrayToBase64(new Uint8Array(new Uint32Array(pairs).buffer));
}

/** Apply a sparse terrain diff produced by encodeTerrainDiff to the live terrain array. */
function applyTerrainDiff(terrain: Uint8Array, diffBase64: string): void {
    const raw = base64ToUint8Array(diffBase64);
    const pairs = new Uint32Array(raw.buffer, 0, raw.byteLength / 4);
    for (let i = 0; i < pairs.length; i += 2) {
        const idx = pairs[i]!;
        if (idx < terrain.length) terrain[idx] = pairs[i + 1]!;
    }
}

// === Terrain Snapshot Helper ===

/** Build terrain fields for the snapshot — sparse diff when initial state is cached, full copy otherwise. */
function terrainSnapshotFields(
    game: Game
): Pick<
    GameStateSnapshot,
    'terrainGroundType' | 'terrainGroundHeight' | 'terrainGroundTypeDiff' | 'terrainGroundHeightDiff'
> {
    if (_cachedInitialGroundType) {
        return {
            terrainGroundTypeDiff: encodeTerrainDiff(game.terrain.groundType, _cachedInitialGroundType) ?? undefined,
            terrainGroundHeightDiff:
                encodeTerrainDiff(game.terrain.groundHeight, _cachedInitialGroundHeight!) ?? undefined,
        };
    }
    return {
        terrainGroundType: uint8ArrayToBase64(game.terrain.groundType),
        terrainGroundHeight: uint8ArrayToBase64(game.terrain.groundHeight),
    };
}

/**
 * Serialize game state to a minimal snapshot.
 */
export function createSnapshot(game: Game): GameStateSnapshot {
    const gameState = game.state;

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

    return {
        version: SNAPSHOT_VERSION,
        timestamp: Date.now(),
        mapId: currentMapId,
        entities,
        nextId: gameState.nextId,
        rngSeed: gameState.rng.getState(),
        // Terrain snapshot
        ...terrainSnapshotFields(game),
        // Feature state from registry
        ...game.services.persistenceRegistry.serializeAll(),
    } as GameStateSnapshot;
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
function restoreEntityProps(entity: Entity, saved: GameStateSnapshot['entities'][number]): void {
    if (saved.race !== undefined) entity.race = saved.race;
    if (saved.carrying) entity.carrying = saved.carrying;
    if (saved.hidden) entity.hidden = saved.hidden;
}

function restoreEntities(game: Game, snapshot: GameStateSnapshot): void {
    const state = game.state;

    // Recreate entities using the normal addEntity path.
    // This emits entity:created events — subscribers handle type-specific initialization
    // (e.g., TreeSystem registers fresh tree state, MovementSystem creates controllers).
    // Feature state (trees, stones, carriers, etc.) is overwritten later by deserializeAll().
    for (const e of snapshot.entities) {
        const savedNextId = state.nextId;
        state.nextId = e.id;

        const entity = state.addEntity(e.type, e.subType, e.x, e.y, e.player, { variation: e.variation, race: e.race });
        state.nextId = Math.max(savedNextId, e.id + 1);

        // Restore per-entity properties not covered by addEntity
        restoreEntityProps(entity, e);
    }
}

/** Apply terrain arrays/diffs from a snapshot to the live terrain. Auto-saves use diffs; initial state uses full arrays. */
function restoreTerrain(game: Game, snapshot: GameStateSnapshot): void {
    if (snapshot.terrainGroundType) game.terrain.groundType.set(base64ToUint8Array(snapshot.terrainGroundType));
    if (snapshot.terrainGroundHeight) game.terrain.groundHeight.set(base64ToUint8Array(snapshot.terrainGroundHeight));
    if (snapshot.terrainGroundTypeDiff) applyTerrainDiff(game.terrain.groundType, snapshot.terrainGroundTypeDiff);
    if (snapshot.terrainGroundHeightDiff) applyTerrainDiff(game.terrain.groundHeight, snapshot.terrainGroundHeightDiff);
    const modified =
        snapshot.terrainGroundType ||
        snapshot.terrainGroundHeight ||
        snapshot.terrainGroundTypeDiff ||
        snapshot.terrainGroundHeightDiff;
    if (modified) game.eventBus.emit('terrain:modified', {});
}

/**
 * Restore game state from a snapshot using normal entity creation.
 * Must be called on a fresh Game instance (entities array should be empty or will be cleared).
 */
export function restoreFromSnapshot(game: Game, snapshot: GameStateSnapshot): void {
    // 1. Clear existing entities via the normal removal path
    const existingIds = game.state.entities.map(e => e.id);
    for (const id of existingIds) {
        game.execute({ type: 'remove_entity', entityId: id });
    }

    // 2. Restore RNG state and nextId
    game.state.rng.setState(snapshot.rngSeed);
    game.state.nextId = snapshot.nextId;

    // 3. Recreate entities with their per-entity state overrides (triggers entity:created events)
    restoreEntities(game, snapshot);

    // 4. Restore terrain modifications (raw ground, leveling)
    restoreTerrain(game, snapshot);

    // 5. Restore all feature state via registry (topological order handles dependencies)
    game.services.persistenceRegistry.deserializeAll(snapshot as unknown as Record<string, unknown>);

    // 6. Rebuild derived state that is not persisted independently.
    // Pile registry reconnects StackedPile entities to building inventories.
    // Building overlays recreate animation instances for completed buildings.
    game.services.inventoryPileSync?.rebuildFromExistingEntities();
    game.services.buildingOverlayManager.rebuildFromExistingEntities(game.services.constructionSiteManager);

    console.log(`GameState: Restored ${snapshot.entities.length} entities from snapshot`);
}

/**
 * Save initial map state (called once after map loads, before auto-save).
 * Used to restore to the original map state when resetting.
 */
export function saveInitialState(game: Game): boolean {
    try {
        const snapshot = createSnapshot(game);
        // Always keep in-memory copy so reset works even if localStorage is full
        _cachedInitialSnapshot = snapshot;
        try {
            localStorage.setItem(INITIAL_STATE_KEY, JSON.stringify(snapshot));
        } catch {
            console.warn('GameState: localStorage full — initial state cached in memory only');
        }
        console.log(`GameState: Saved initial state with ${snapshot.entities.length} entities`);
        // Cache initial terrain in memory so subsequent auto-saves can store sparse diffs instead of full arrays.
        _cachedInitialGroundType = new Uint8Array(game.terrain.groundType);
        _cachedInitialGroundHeight = new Uint8Array(game.terrain.groundHeight);
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
    // Prefer in-memory cache (always available if saveInitialState succeeded)
    if (_cachedInitialSnapshot && _cachedInitialSnapshot.mapId === currentMapId) {
        return _cachedInitialSnapshot;
    }

    try {
        const stored = localStorage.getItem(INITIAL_STATE_KEY);
        if (!stored) return null;

        const snapshot = JSON.parse(stored) as GameStateSnapshot;
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
 * Restore terrain ground types and heights to the initial map state.
 * Uses the in-memory cache from saveInitialState.
 * Emits terrain:modified so renderers refresh.
 */
export function restoreInitialTerrain(game: Game): void {
    if (!_cachedInitialGroundType || !_cachedInitialGroundHeight) {
        throw new Error('restoreInitialTerrain: no initial terrain cached — saveInitialState must be called first');
    }
    game.terrain.groundType.set(_cachedInitialGroundType);
    game.terrain.groundHeight.set(_cachedInitialGroundHeight);
    game.eventBus.emit('terrain:modified', {});
}

/**
 * Clear initial state (called when loading a new map).
 */
export function clearInitialState(): void {
    localStorage.removeItem(INITIAL_STATE_KEY);
    _cachedInitialGroundType = null;
    _cachedInitialGroundHeight = null;
    _cachedInitialSnapshot = null;
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
}

// Singleton
export const gameStatePersistence = new GameStatePersistence();
