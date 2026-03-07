/**
 * Stone lifecycle system - manages stone mining depletion and visual state.
 *
 * Stones have 13 depletion stages (12=full, 0=nearly gone) and 2 visual
 * variants (A/B) randomly assigned on creation.
 *
 * Each stonecutter work session depletes one level. When depleted past 0,
 * the entity is removed. Visual state is controlled via EntityVisualService.
 */

import type { GameState } from '../../game-state';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import { createLogger } from '@/utilities/logger';
import { findEmptySpot } from '../../systems/spatial-search';
import type { Command, CommandResult } from '../../commands';
import type { Persistable } from '@/game/persistence';
import type { SerializedStone } from '@/game/game-state-persistence';

const log = createLogger('StoneSystem');

/** Number of visual depletion stages per variant (GIL indices 0-12). */
export const STONE_DEPLETION_STAGES = 13;

/** Number of visual variants (A, B). */
export const STONE_VARIANTS = 2;

/** Initial depletion level (full stone). */
const STONE_FULL_LEVEL = STONE_DEPLETION_STAGES - 1; // 12

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
 */
export interface StoneState {
    stage: StoneStage;
    /** Visual variant: 0 = A, 1 = B */
    variant: number;
    /** Depletion level: 12 = full, 0 = nearly gone. Next mine at 0 removes. */
    level: number;
}

export interface StoneSystemConfig {
    gameState: GameState;
    visualService: EntityVisualService;
    executeCommand: (cmd: Command) => CommandResult;
}

/**
 * Manages stone mining depletion and variant assignment.
 */
export class StoneSystem implements Persistable<SerializedStone[]> {
    readonly persistKey = 'stones' as const;

    private gameState: GameState;
    private readonly visualService: EntityVisualService;
    private readonly executeCommand: (cmd: Command) => CommandResult;

    /** Internal state storage: entityId -> StoneState */
    private readonly states = new Map<number, StoneState>();

    constructor(cfg: StoneSystemConfig) {
        this.gameState = cfg.gameState;
        this.visualService = cfg.visualService;
        this.executeCommand = cfg.executeCommand;
    }

    /**
     * Compute the entity.variation value for a stone state.
     * Layout: variant * STONE_DEPLETION_STAGES + level
     *   Variant A: variations 0-12
     *   Variant B: variations 13-25
     */
    private getVariation(state: StoneState): number {
        return state.variant * STONE_DEPLETION_STAGES + state.level;
    }

    /** Update visual variation to reflect current state. */
    private updateVisual(entityId: number, state: StoneState): void {
        this.visualService.setVariation(entityId, this.getVariation(state));
    }

    /**
     * Register a stone entity.
     * Only registers if the object type is a resource stone.
     * Assigns a random visual variant (A or B).
     * Uses initialLevel if provided (from map data), otherwise full level.
     */
    register(entityId: number, objectType: MapObjectType, initialLevel?: number): void {
        if (OBJECT_TYPE_CATEGORY[objectType] !== MapObjectCategory.Goods || objectType !== MapObjectType.ResourceStone)
            return;

        this.gameState.getEntityOrThrow(entityId, 'stone for registration');

        const variant = this.gameState.rng.nextInt(STONE_VARIANTS);

        const state: StoneState = {
            stage: StoneStage.Normal,
            variant,
            level: initialLevel ?? STONE_FULL_LEVEL,
        };
        this.states.set(entityId, state);

        this.visualService.setVariation(entityId, this.getVariation(state));
    }

    /**
     * Restore stone state from serialized data.
     * Overwrites the fresh state created by register().
     */
    restoreStoneState(entityId: number, data: { stage: StoneStage; variant: number; level: number }): void {
        // Skip stale entries — entity may have been removed between snapshot capture and restore
        if (!this.visualService.getState(entityId)) return;

        const state: StoneState = {
            stage: data.stage,
            variant: data.variant,
            level: data.level,
        };
        this.states.set(entityId, state);
        // State may already be initialized from register(); just update the variation
        this.visualService.setVariation(entityId, this.getVariation(state));
    }

    /** Remove stone state when entity is removed. */
    unregister(entityId: number): void {
        this.states.delete(entityId);
    }

    /** Check if stone can be mined (is in Normal stage). */
    canMine(entityId: number): boolean {
        return this.states.get(entityId)?.stage === StoneStage.Normal;
    }

    /** Check if stone is currently being mined. */
    isMining(entityId: number): boolean {
        return this.states.get(entityId)?.stage === StoneStage.Mining;
    }

    /** Start mining (called by stonecutter work handler). */
    startMining(entityId: number): void {
        const state = this.states.get(entityId);
        if (!state || state.stage !== StoneStage.Normal) return;

        state.stage = StoneStage.Mining;
    }

    /**
     * Complete one mining session.
     * Decrements the depletion level by 1. If the stone is fully depleted,
     * removes the entity and returns true; otherwise updates the visual and
     * returns false.
     */
    completeMining(entityId: number): boolean {
        const state = this.states.get(entityId);
        if (!state || state.stage !== StoneStage.Mining) return false;

        state.level--;

        if (state.level < 0) {
            log.debug(`Stone ${entityId} fully depleted, removing`);
            this.executeCommand({ type: 'remove_entity', entityId });
            return true;
        }

        state.stage = StoneStage.Normal;
        this.updateVisual(entityId, state);
        return false;
    }

    /** Cancel mining (stonecutter interrupted). Keeps current depletion level. */
    cancelMining(entityId: number): void {
        const state = this.states.get(entityId);
        if (state && state.stage === StoneStage.Mining) {
            state.stage = StoneStage.Normal;
        }
    }

    /** Get stone state by entity ID. */
    getStoneState(entityId: number): StoneState | undefined {
        return this.states.get(entityId);
    }

    /**
     * Spawn multiple ResourceStone entities near a position.
     * Uses findEmptySpot to place each stone on an unoccupied tile — mirrors
     * the treeSystem.plantTreesNear pattern for use in tests and scripts.
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
            if (!spot) break;
            this.executeCommand({
                type: 'spawn_map_object',
                objectType: MapObjectType.ResourceStone,
                x: spot.x,
                y: spot.y,
            });
            placed++;
        }
        return placed;
    }

    // ── Persistable ───────────────────────────────────────────────

    serialize(): SerializedStone[] {
        const result: SerializedStone[] = [];
        for (const [entityId, state] of this.states) {
            result.push({
                entityId,
                stage: state.stage,
                variant: state.variant,
                level: state.level,
            });
        }
        return result;
    }

    deserialize(data: SerializedStone[]): void {
        for (const s of data) {
            this.restoreStoneState(s.entityId, {
                stage: s.stage,
                variant: s.variant,
                level: s.level,
            });
        }
    }

    /** Get stats for debugging. */
    getStats(): { total: number; mining: number } {
        let mining = 0;
        for (const state of this.states.values()) {
            if (state.stage === StoneStage.Mining) mining++;
        }
        return { total: this.states.size, mining };
    }
}
