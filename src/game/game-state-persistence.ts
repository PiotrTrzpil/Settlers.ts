/**
 * Game state persistence - auto-saves to localStorage every few seconds.
 * Uses a simple approach: serialize state, reload via existing create methods.
 */

import type { GameState } from './game-state';
import type { Game } from './game';
import { EntityType } from './entity';
import { BuildingConstructionPhase, type BuildingStateManager } from './features/building-construction';

const STORAGE_KEY = 'settlers_game_state';
const INITIAL_STATE_KEY = 'settlers_initial_state';
const AUTO_SAVE_INTERVAL_MS = 5000; // Save every 5 seconds
const SNAPSHOT_VERSION = 2; // Bumped for building state addition

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
 * Minimal snapshot - entities, positions, and critical game state.
 * Feature state (carriers, inventories, etc.) is rebuilt by the normal
 * entity creation callbacks when the game loads.
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
}

/** Current map identifier for save/load matching */
let currentMapId: string = '';

/**
 * Set the current map identifier. Must be called when loading a map.
 */
export function setCurrentMapId(mapId: string): void {
    currentMapId = mapId;
}

/**
 * Serialize game state to a minimal snapshot.
 */
export function createSnapshot(gameState: GameState, buildingStateManager: BuildingStateManager): GameStateSnapshot {
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

    // Save building construction states
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
    };
}

/**
 * Save game state to localStorage.
 */
export function saveGameState(gameState: GameState, buildingStateManager: BuildingStateManager): boolean {
    try {
        const snapshot = createSnapshot(gameState, buildingStateManager);
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

/**
 * Restore game state from a snapshot using normal entity creation.
 * Must be called on a fresh Game instance (entities array should be empty or will be cleared).
 */
export function restoreFromSnapshot(game: Game, snapshot: GameStateSnapshot): void {
    const state = game.state;

    // Clear existing entities via the normal removal path
    const existingIds = state.entities.map(e => e.id);
    for (const id of existingIds) {
        game.execute({ type: 'remove_entity', entityId: id });
    }

    // Restore RNG state
    state.rng.setState(snapshot.rngSeed);

    // Set nextId before creating entities
    state.nextId = snapshot.nextId;

    // Build a map of saved building states for quick lookup
    const savedBuildingStates = new Map<number, SerializedBuildingState>();
    if (snapshot.buildingStates) {
        for (const bs of snapshot.buildingStates) {
            savedBuildingStates.set(bs.entityId, bs);
        }
    }

    // Recreate entities using the normal addEntity path
    // This triggers all the callbacks (onBuildingCreated, onMapObjectCreated, etc.)
    for (const e of snapshot.entities) {
        // Use addEntity directly to preserve original IDs
        // We need to temporarily set nextId to match each entity's ID
        const savedNextId = state.nextId;
        state.nextId = e.id;

        state.addEntity(
            e.type,
            e.subType,
            e.x,
            e.y,
            e.player,
            undefined, // selectable - let addEntity determine based on type
            e.variation
        );

        // Restore nextId to track the highest ID seen
        state.nextId = Math.max(savedNextId, e.id + 1);

        // Restore building state if this was a building with saved state
        // (overwrites the fresh state created by addEntity)
        if (e.type === EntityType.Building) {
            const savedState = savedBuildingStates.get(e.id);
            if (savedState) {
                game.gameLoop.buildingStateManager.restoreBuildingState({
                    entityId: e.id,
                    buildingType: e.subType,
                    tileX: e.x,
                    tileY: e.y,
                    phase: savedState.phase,
                    phaseProgress: savedState.phaseProgress,
                    totalDuration: savedState.totalDuration,
                    elapsedTime: savedState.elapsedTime,
                    terrainModified: savedState.terrainModified,
                });
            }
        }
    }

    // Restore resource quantities and building ownership (these aren't set by addEntity)
    for (const rq of snapshot.resourceQuantities) {
        const resourceState = state.resourceStates.get(rq.entityId);
        if (resourceState) {
            resourceState.quantity = rq.quantity;
            resourceState.buildingId = rq.buildingId;
        }
    }

    console.log(`GameState: Restored ${snapshot.entities.length} entities from snapshot`);
}

/**
 * Save initial map state (called once after map loads, before auto-save).
 * Used to restore to the original map state when resetting.
 */
export function saveInitialState(gameState: GameState, buildingStateManager: BuildingStateManager): boolean {
    try {
        const snapshot = createSnapshot(gameState, buildingStateManager);
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
    private gameState: GameState | null = null;
    private buildingStateManager: BuildingStateManager | null = null;
    private saveIntervalId: ReturnType<typeof setInterval> | null = null;
    private enabled = true;

    /**
     * Start auto-saving.
     * Note: Initial state should be saved BEFORE calling this (via saveInitialState).
     */
    start(gameState: GameState, buildingStateManager: BuildingStateManager): void {
        this.gameState = gameState;
        this.buildingStateManager = buildingStateManager;

        if (this.saveIntervalId) {
            clearInterval(this.saveIntervalId);
        }

        this.saveIntervalId = setInterval(() => {
            if (this.enabled && this.gameState && this.buildingStateManager) {
                saveGameState(this.gameState, this.buildingStateManager);
            }
        }, AUTO_SAVE_INTERVAL_MS);

        // Save immediately
        if (this.enabled && this.buildingStateManager) {
            saveGameState(gameState, this.buildingStateManager);
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
        if (this.gameState && this.buildingStateManager) {
            return saveGameState(this.gameState, this.buildingStateManager);
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
