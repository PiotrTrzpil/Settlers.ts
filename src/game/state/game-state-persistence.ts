/**
 * Game state persistence - auto-saves to localStorage every few seconds.
 *
 * Snapshot format: metadata + entity table + terrain + dynamic feature data.
 * All feature state is stored via PersistenceRegistry under dynamic keys —
 * no typed fields for individual features.
 */

import type { GameCore } from '../game-core';
import { EntityType } from '../entity';
import type { CarryingState } from '../entity';
import type { Race } from '../core/race';
import type { EMaterialType } from '../economy/material-type';
import type { TreeStage } from '../features/trees/tree-system';
import type { StoneStage } from '../features/stones/stone-system';

const STORAGE_KEY = 'settlers_game_state';
const INITIAL_STATE_KEY = 'settlers_initial_state';
const LAST_MAP_KEY = 'settlers_last_map';
const AUTO_SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
// Bumped: snapshot simplification — removed typed feature fields, event-free entity restore
const SNAPSHOT_VERSION = 12;

/**
 * Snapshot format: metadata + entity table + terrain + dynamic feature data.
 *
 * All feature-specific state lives under dynamic keys populated by
 * `persistenceRegistry.serializeAll()`. No typed fields for individual features.
 */
export interface GameStateSnapshot {
    version: number;
    timestamp: number;
    /** Map identifier — only restore if loading the same map */
    mapId: string;
    /** Full entity table (structural data only) */
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
    /** Entity ID counter — ensures new entities don't collide with restored ones */
    nextId: number;
    /** RNG state for deterministic replay */
    rngSeed: number;
    /** Modified terrain ground types (base64-encoded Uint8Array) — full copy, used in initial state */
    terrainGroundType?: string;
    /** Modified terrain ground heights (base64-encoded Uint8Array) — full copy, used in initial state */
    terrainGroundHeight?: string;
    /** Sparse terrain ground type diff vs initial state (base64 Uint32 pairs: [index, value, ...]) */
    terrainGroundTypeDiff?: string;
    /** Sparse terrain ground height diff vs initial state (base64 Uint32 pairs: [index, value, ...]) */
    terrainGroundHeightDiff?: string;
    /** Dynamic feature data from PersistenceRegistry — each key is a persistKey */
    [key: string]: unknown;
}

// ─── Feature serialization types ─────────────────────────────────────────────
// These types are used by individual feature Persistable implementations.
// They are NOT fields on GameStateSnapshot — feature data lives under dynamic
// persist keys via the PersistenceRegistry.
// ─────────────────────────────────────────────────────────────────────────────

export interface SerializedInventorySlot {
    materialType: EMaterialType;
    current: number;
    max: number;
}

export interface SerializedBuildingInventory {
    entityId: number;
    buildingType: number;
    inputSlots: SerializedInventorySlot[];
    outputSlots: SerializedInventorySlot[];
}

export interface SerializedCarrier {
    entityId: number;
}

export interface SerializedTree {
    entityId: number;
    stage: TreeStage;
    progress: number;
    stumpTimer: number;
    currentOffset: number;
    variant?: number;
}

export interface SerializedStone {
    entityId: number;
    stage: StoneStage;
    variant: number;
    level: number;
}

export interface SerializedCrop {
    entityId: number;
    stage: number;
    cropType: number;
    progress: number;
    decayTimer: number;
    currentOffset: number;
}

export interface SerializedStorageFilter {
    buildingId: number;
    materials: number[];
    /** Per-material direction (StorageDirection). Missing = legacy data, default to Both. */
    directions?: number[];
}

export interface SerializedProductionControl {
    buildingId: number;
    mode: string;
    recipeCount: number;
    roundRobinIndex: number;
    proportions: Array<{ index: number; weight: number }>;
    queue: number[];
    productionCounts: Array<{ index: number; count: number }>;
}

export interface SerializedPendingSpawn {
    buildingEntityId: number;
    remaining: number;
    timer: number;
    unitType: number;
    count: number;
    spawnInterval: number;
}

export interface SerializedResourceSign {
    elapsed: number;
    signs: Array<{ entityId: number; x: number; y: number; expiresAt: number }>;
}

export interface SerializedCombatUnit {
    entityId: number;
    health: number;
    maxHealth: number;
}

export interface SerializedBarracksTraining {
    races: Array<{ buildingId: number; race: number }>;
    activeTrainings: Array<{
        buildingId: number;
        carrierId: number;
        recipe: { inputs: Array<{ material: number; count: number }>; unitType: number; level: number };
    }>;
}

export interface SerializedUnitTransformer {
    pendingTransforms: Array<{
        carrierId: number;
        targetUnitType: number;
        toolMaterial: number;
        pileEntityId: number;
    }>;
}

export interface SerializedRequest {
    id: number;
    buildingId: number;
    materialType: EMaterialType;
    amount: number;
    priority: number;
    timestamp: number;
    status: string;
    assignedCarrier: number | null;
    sourceBuilding: number | null;
    assignedAt: number | null;
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
    game: GameCore
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
 * Serialize game state to a snapshot.
 * Entity table and terrain are assembled here; all feature state comes
 * from the PersistenceRegistry via serializeAll() (dynamic keys).
 */
export function createSnapshot(game: GameCore): GameStateSnapshot {
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
        ...terrainSnapshotFields(game),
        ...game.services.persistenceRegistry.serializeAll(),
    } as GameStateSnapshot;
}

/**
 * Save game state to localStorage.
 */
export function saveGameState(game: GameCore): boolean {
    try {
        const snapshot = createSnapshot(game);
        const json = JSON.stringify(snapshot);
        try {
            localStorage.setItem(STORAGE_KEY, json);
        } catch {
            // Quota exceeded — free space by removing stale keys and retry
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(INITIAL_STATE_KEY);
            localStorage.setItem(STORAGE_KEY, json);
        }
        return true;
    } catch (e) {
        console.warn('Failed to save game state:', e);
        return false;
    }
}

/** Result of checking saved snapshot compatibility. */
export type SnapshotCheckResult =
    | { status: 'none' }
    | { status: 'valid'; snapshot: GameStateSnapshot }
    | { status: 'stale'; savedVersion: number; expectedVersion: number }
    | { status: 'wrong-map'; savedMapId: string };

/**
 * Check saved snapshot compatibility WITHOUT loading it.
 * Returns status so the UI can show appropriate warnings.
 */
export function checkSavedSnapshot(): SnapshotCheckResult {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return { status: 'none' };

        const snapshot = JSON.parse(stored) as GameStateSnapshot;
        if (snapshot.version !== SNAPSHOT_VERSION) {
            return { status: 'stale', savedVersion: snapshot.version, expectedVersion: SNAPSHOT_VERSION };
        }
        if (snapshot.mapId !== currentMapId) {
            return { status: 'wrong-map', savedMapId: snapshot.mapId };
        }
        return { status: 'valid', snapshot };
    } catch {
        return { status: 'none' };
    }
}

/**
 * Load saved snapshot from localStorage.
 * Only returns snapshot if it matches the current map.
 */
export function loadSnapshot(): GameStateSnapshot | null {
    const result = checkSavedSnapshot();
    if (result.status === 'valid') return result.snapshot;

    if (result.status === 'stale') {
        console.warn(`Snapshot version mismatch: ${result.savedVersion} !== ${result.expectedVersion}`);
    } else if (result.status === 'wrong-map') {
        console.log(`Snapshot is for different map (${result.savedMapId}), not restoring`);
    }
    return null;
}

/**
 * Clear saved game state.
 */
export function clearSavedGameState(): void {
    localStorage.removeItem(STORAGE_KEY);
}

/**
 * Strip MapObject entities and tree/stone state from the saved snapshot.
 * Used when the tree expansion setting changes so the next reload
 * re-populates trees from map data with the new setting.
 */
export function clearSavedTreeState(): void {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return;

        const snapshot = JSON.parse(stored) as GameStateSnapshot;
        snapshot.entities = snapshot.entities.filter(e => e.type !== EntityType.MapObject);
        // Clear feature-specific tree/stone data stored under dynamic keys
        delete snapshot['trees'];
        delete snapshot['stones'];
        delete snapshot['resourceQuantities'];
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

function restoreEntities(game: GameCore, snapshot: GameStateSnapshot): void {
    const state = game.state;

    // Extract construction site IDs so we can distinguish completed buildings from sites.
    // Completed buildings need buildingOccupancy set at creation time (via completed flag).
    const constructionSiteIds = new Set<number>();
    const sites = snapshot['constructionSites'] as Array<{ buildingId: number }> | undefined;
    if (sites) {
        for (const site of sites) constructionSiteIds.add(site.buildingId);
    }

    // Recreate entities via addEntity — emits entity:created events so systems
    // (movement controllers, visual service, territory, combat) initialize state.
    // Feature persistables then overwrite default state with snapshot data via deserializeAll().
    for (const e of snapshot.entities) {
        state.nextId = e.id; // ensure addEntity produces the correct ID
        const completed = e.type === EntityType.Building && !constructionSiteIds.has(e.id);
        const entity = state.addEntity(e.type, e.subType, e.x, e.y, e.player, { race: e.race, completed });
        if (e.carrying) entity.carrying = e.carrying;
        if (e.hidden) entity.hidden = e.hidden;
    }
}

/** Apply terrain arrays/diffs from a snapshot to the live terrain. Auto-saves use diffs; initial state uses full arrays. */
function restoreTerrain(game: GameCore, snapshot: GameStateSnapshot): void {
    if (snapshot.terrainGroundType) game.terrain.groundType.set(base64ToUint8Array(snapshot.terrainGroundType));
    if (snapshot.terrainGroundHeight) game.terrain.groundHeight.set(base64ToUint8Array(snapshot.terrainGroundHeight));
    if (snapshot.terrainGroundTypeDiff) applyTerrainDiff(game.terrain.groundType, snapshot.terrainGroundTypeDiff);
    if (snapshot.terrainGroundHeightDiff) applyTerrainDiff(game.terrain.groundHeight, snapshot.terrainGroundHeightDiff);
    const modified =
        snapshot.terrainGroundType ||
        snapshot.terrainGroundHeight ||
        snapshot.terrainGroundTypeDiff ||
        snapshot.terrainGroundHeightDiff;
    if (modified) game.eventBus.emit('terrain:modified', { reason: 'snapshot' });
}

/**
 * Restore game state from a snapshot.
 *
 * Entities are recreated via addEntity (emitting entity:created events) so systems
 * initialize default state. Then deserializeAll() overwrites with snapshot data.
 *
 * Must be called on a fresh Game instance (entities array should be empty or will be cleared).
 */
export function restoreFromSnapshot(game: GameCore, snapshot: GameStateSnapshot): void {
    // 0. Reject snapshots with incompatible version — callers should use loadSnapshot()
    //    which already checks, but guard here too for direct callers.
    if (snapshot.version !== SNAPSHOT_VERSION) {
        throw new Error(
            `restoreFromSnapshot: snapshot version ${snapshot.version} !== expected ${SNAPSHOT_VERSION}. ` +
                `Saved data is incompatible — discard and start fresh.`
        );
    }

    // 1. Clear existing entities via the normal removal path.
    const existingIds = game.state.entities.map(e => e.id);
    for (const id of existingIds) {
        game.execute({ type: 'remove_entity', entityId: id });
    }
    // Remove any entities spawned as side-effects of the above removals.
    while (game.state.entities.length > 0) {
        game.execute({ type: 'remove_entity', entityId: game.state.entities[0]!.id });
    }

    // 2. Restore RNG state and nextId
    game.state.rng.setState(snapshot.rngSeed);
    game.state.nextId = snapshot.nextId;

    // 3. Recreate entities (emits entity:created → systems create default state).
    restoreEntities(game, snapshot);

    // 4. Restore terrain modifications (raw ground, leveling)
    restoreTerrain(game, snapshot);

    // 5. Restore all feature state via registry (topological order handles dependencies).
    // deserializeAll() overwrites default state created by entity:created events.
    game.services.persistenceRegistry.deserializeAll(snapshot as unknown as Record<string, unknown>);

    // 6. Rebuild derived state that is not owned by features.
    game.services.buildingOverlayManager.rebuildFromExistingEntities(game.services.constructionSiteManager);

    // 7. Notify features that restore is complete — features rebuild derived state,
    // re-emit worker-needed events, etc. Must run AFTER all entities and feature
    // stores are deserialized (step 5) and derived state is rebuilt (step 6).
    game.services.notifyRestoreComplete();

    console.log(
        `[${performance.now().toFixed(0)}ms] GameState: Restored ${snapshot.entities.length} entities from snapshot`
    );
}

/**
 * Save initial map state (called once after map loads, before auto-save).
 * Used to restore to the original map state when resetting.
 */
export function saveInitialState(game: GameCore): boolean {
    try {
        const snapshot = createSnapshot(game);
        // Always keep in-memory copy so reset works even if localStorage is full
        _cachedInitialSnapshot = snapshot;
        try {
            localStorage.setItem(INITIAL_STATE_KEY, JSON.stringify(snapshot));
        } catch {
            console.warn('GameState: localStorage full — initial state cached in memory only');
        }
        console.log(
            `[${performance.now().toFixed(0)}ms] GameState: Saved initial state with ${snapshot.entities.length} entities`
        );
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
export function restoreInitialTerrain(game: GameCore): void {
    if (!_cachedInitialGroundType || !_cachedInitialGroundHeight) {
        throw new Error('restoreInitialTerrain: no initial terrain cached — saveInitialState must be called first');
    }
    game.terrain.groundType.set(_cachedInitialGroundType);
    game.terrain.groundHeight.set(_cachedInitialGroundHeight);
    game.eventBus.emit('terrain:modified', { reason: 'restore' });
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
    private game: GameCore | null = null;
    private saveIntervalId: ReturnType<typeof setInterval> | null = null;
    private enabled = true;

    /**
     * Start auto-saving.
     * Note: Initial state should be saved BEFORE calling this (via saveInitialState).
     */
    start(game: GameCore): void {
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
