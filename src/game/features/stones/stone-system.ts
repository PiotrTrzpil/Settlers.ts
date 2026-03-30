/**
 * Stone lifecycle system - manages stone mining depletion and visual state.
 *
 * Stones use raw byte values as their subType (ResourceStone1=124 through
 * ResourceStone12=135). Each depletion level is a separate subType.
 * When mined, the entity is replaced with the next-lower subType.
 * When ResourceStone1 is mined, the entity is removed entirely.
 *
 * Each stone has 2 visual variants (A/B) randomly assigned on creation,
 * stored as entity variation (0=A, 1=B).
 */

import type { GameState } from '../../game-state';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { MapObjectType, isHarvestableStone, STONE_FULL_LEVEL, stoneTypeForLevel } from '@/game/types/map-object-types';
import { createLogger } from '@/utilities/logger';
import { findEmptySpot } from '../../systems/spatial-search';
import type { Command, CommandResult } from '../../commands';
import { PersistentMap } from '@/game/persistence/persistent-store';

const log = createLogger('StoneSystem');

/** Number of visual variants (A, B). */
export const STONE_VARIANTS = 2;

/**
 * Stone mining stage.
 */
export enum StoneStage {
    /** Stone is idle and available for mining. */
    Normal = 0,
    /** Currently being mined by a stonecutter. */
    Mining = 1,
}

/**
 * State for a single stone entity.
 * Depletion level is derived from entity.subType, not stored here.
 */
export interface StoneState {
    stage: StoneStage;
    /** Visual variant: 0 = A, 1 = B */
    variant: number;
}

export interface StoneSystemConfig {
    gameState: GameState;
    visualService: EntityVisualService;
    executeCommand: (cmd: Command) => CommandResult;
}

/**
 * Manages stone mining depletion and variant assignment.
 */
export class StoneSystem {
    private gameState: GameState;
    private readonly visualService: EntityVisualService;
    private readonly executeCommand: (cmd: Command) => CommandResult;

    /** Persistent state storage: entityId -> StoneState */
    readonly persistentStore = new PersistentMap<StoneState>('stones');

    constructor(cfg: StoneSystemConfig) {
        this.gameState = cfg.gameState;
        this.visualService = cfg.visualService;
        this.executeCommand = cfg.executeCommand;
    }

    /** Update visual variation to reflect the A/B variant. */
    private updateVisual(entityId: number, state: StoneState): void {
        this.visualService.setVariation(entityId, state.variant);
    }

    /**
     * Register a stone entity.
     * Only registers if the object type is a harvestable stone (ResourceStone1-12).
     * Uses initialVariant if provided (e.g. preserved across depletion replacement),
     * otherwise assigns a random visual variant (A or B).
     */
    register(entityId: number, objectType: MapObjectType, initialVariant?: number): void {
        if (!isHarvestableStone(objectType)) {
            return;
        }

        this.gameState.getEntityOrThrow(entityId, 'stone for registration');

        const variant = initialVariant ?? this.gameState.rng.nextInt(STONE_VARIANTS);

        const state: StoneState = {
            stage: StoneStage.Normal,
            variant,
        };
        this.persistentStore.set(entityId, state);

        this.visualService.setVariation(entityId, state.variant);
    }

    /**
     * Restore stone state from serialized data.
     * Overwrites the fresh state created by register().
     */
    restoreStoneState(entityId: number, data: { stage: StoneStage; variant: number; level?: number }): void {
        // Skip stale entries — entity may have been removed between snapshot capture and restore
        if (!this.visualService.getState(entityId)) {
            return;
        }

        const state: StoneState = {
            stage: data.stage,
            variant: data.variant,
        };
        this.persistentStore.set(entityId, state);
        this.visualService.setVariation(entityId, state.variant);
    }

    /** Remove stone state when entity is removed. */
    unregister(entityId: number): void {
        this.persistentStore.delete(entityId);
    }

    /** Check if stone can be mined (is in Normal stage). */
    canMine(entityId: number): boolean {
        return this.persistentStore.get(entityId)?.stage === StoneStage.Normal;
    }

    /** Check if stone is currently being mined. */
    isMining(entityId: number): boolean {
        return this.persistentStore.get(entityId)?.stage === StoneStage.Mining;
    }

    /** Start mining (called by stonecutter work handler). */
    startMining(entityId: number): void {
        const state = this.persistentStore.get(entityId);
        if (!state || state.stage !== StoneStage.Normal) {
            return;
        }

        state.stage = StoneStage.Mining;
    }

    /**
     * Complete one mining session.
     * Replaces the entity with the next-lower depletion level.
     * If the stone is at ResourceStone1 (nearly depleted), removes the entity entirely.
     * Returns true if the stone was fully depleted and removed.
     */
    completeMining(entityId: number): boolean {
        const state = this.persistentStore.get(entityId);
        if (!state || state.stage !== StoneStage.Mining) {
            return false;
        }

        const entity = this.gameState.getEntityOrThrow(entityId, 'stone for mining');
        const currentType = entity.subType as MapObjectType;

        if (currentType === MapObjectType.ResourceStone1) {
            log.debug(`Stone ${entityId} fully depleted, removing`);
            this.executeCommand({ type: 'remove_entity', entityId });
            return true;
        }

        // Replace with next-lower depletion level, preserving position and variant.
        // The variant is passed as `variation` in spawn_map_object, which flows through
        // entity:created → register(initialVariant) so the new entity keeps the same A/B look.
        const nextType = (currentType - 1) as MapObjectType;
        const { x, y } = entity;
        const { variant } = state;

        this.executeCommand({ type: 'remove_entity', entityId });
        this.executeCommand({
            type: 'spawn_map_object',
            objectType: nextType,
            x,
            y,
            variation: variant,
        });

        return false;
    }

    /** Cancel mining (stonecutter interrupted). Keeps current depletion level. */
    cancelMining(entityId: number): void {
        const state = this.persistentStore.get(entityId);
        if (state && state.stage === StoneStage.Mining) {
            state.stage = StoneStage.Normal;
        }
    }

    /** Get stone state by entity ID. */
    getStoneState(entityId: number): StoneState | undefined {
        return this.persistentStore.get(entityId);
    }

    /**
     * Spawn multiple harvestable stone entities near a position.
     * Uses findEmptySpot to place each stone on an unoccupied tile.
     * Spawns at full depletion level (ResourceStone12).
     * @returns Number of stones successfully spawned.
     */
    spawnStonesNear(cx: number, cy: number, count: number, radius = 15): number {
        let placed = 0;
        for (let i = 0; i < count; i++) {
            const spot = findEmptySpot(cx, cy, {
                gameState: this.gameState,
                searchRadius: radius,
                minDistanceSq: 0,
                proximityFilter: () => false,
            });
            if (!spot) {
                break;
            }
            this.executeCommand({
                type: 'spawn_map_object',
                objectType: stoneTypeForLevel(STONE_FULL_LEVEL),
                x: spot.x,
                y: spot.y,
            });
            placed++;
        }
        return placed;
    }

    /** Get stats for debugging. */
    getStats(): { total: number; mining: number } {
        let mining = 0;
        for (const state of this.persistentStore.values()) {
            if (state.stage === StoneStage.Mining) {
                mining++;
            }
        }
        return { total: this.persistentStore.size, mining };
    }
}
