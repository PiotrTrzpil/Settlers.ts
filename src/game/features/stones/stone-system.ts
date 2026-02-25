/**
 * Stone lifecycle system - manages stone mining depletion and visual state.
 *
 * Stones have 13 depletion stages (12=full, 0=nearly gone) and 2 visual
 * variants (A/B) randomly assigned on creation.
 *
 * Each stonecutter work session depletes one level. When depleted past 0,
 * the entity is removed. Visual state is controlled by setting entity.variation.
 */

import type { GameState } from '../../game-state';
import { MapObjectType } from '../../entity';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('StoneSystem');

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

/**
 * Manages stone mining depletion and variant assignment.
 */
export class StoneSystem {
    private gameState: GameState;

    /** Internal state storage: entityId -> StoneState */
    private readonly states = new Map<number, StoneState>();

    constructor(gameState: GameState) {
        this.gameState = gameState;
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

    /** Update entity.variation to reflect current state. */
    private updateVisual(entityId: number, state: StoneState): void {
        const entity = this.gameState.getEntity(entityId);
        if (entity) {
            entity.variation = this.getVariation(state);
        }
    }

    /**
     * Register a stone entity.
     * Only registers if the object type is a resource stone.
     * Assigns a random visual variant (A or B).
     * Uses initialLevel if provided (from map data), otherwise full level.
     */
    register(entityId: number, objectType: MapObjectType, initialLevel?: number): void {
        if (OBJECT_TYPE_CATEGORY[objectType] !== 'resources' || objectType !== MapObjectType.ResourceStone) return;

        const entity = this.gameState.getEntityOrThrow(entityId, 'stone for registration');

        // eslint-disable-next-line sonarjs/pseudo-random -- intentional visual variation
        const variant = Math.random() < 0.5 ? 0 : 1;

        const state: StoneState = {
            stage: StoneStage.Normal,
            variant,
            level: initialLevel ?? STONE_FULL_LEVEL,
        };
        this.states.set(entityId, state);

        entity.variation = this.getVariation(state);
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
            this.gameState.removeEntity(entityId);
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

    /** Get stats for debugging. */
    getStats(): { total: number; mining: number } {
        let mining = 0;
        for (const state of this.states.values()) {
            if (state.stage === StoneStage.Mining) mining++;
        }
        return { total: this.states.size, mining };
    }
}
