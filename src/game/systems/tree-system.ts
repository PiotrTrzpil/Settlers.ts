/**
 * Tree lifecycle system - manages tree growth and cutting states.
 *
 * Logical stages (game state):
 *   Growing -> Normal (planted by forester, progress 0-1)
 *   Normal -> Cutting -> Cut (cut by woodcutter, progress 0-1)
 *
 * Visual state is controlled by setting entity.variation directly.
 * Normal trees (variation=3) also play 'default' animation for sway.
 */

import type { TickSystem } from '../tick-system';
import type { GameState } from '../game-state';
import { MapObjectType } from '../entity';
import { OBJECT_TYPE_CATEGORY } from './map-objects';
import type { AnimationService } from '../animation/index';

/**
 * Logical tree stage (game state).
 */
export enum TreeStage {
    /** Tree is growing (progress 0-1 maps to sapling/small/medium) */
    Growing = 0,
    /** Full grown tree */
    Normal = 1,
    /** Being cut by woodcutter (progress 0-1 maps to cutting phases + falling) */
    Cutting = 2,
    /** Tree has been cut (progress 1.0 shows stump sprite) */
    Cut = 3,
}

/**
 * Tree sprite offsets (JIL job indices within tree type block).
 */
const TREE_OFFSET = {
    SAPLING: 0,
    SMALL: 1,
    MEDIUM: 2,
    NORMAL: 3,
    FALLING: 4,
    CUTTING_1: 5,
    CUTTING_2: 6,
    CUTTING_3: 7,
    CUTTING_4: 8,
    CUTTING_5: 9,
    CANOPY_GONE: 10,
} as const;

/**
 * State for a single tree.
 */
interface TreeState {
    stage: TreeStage;
    progress: number; // 0-1 within current stage
    stumpTimer: number; // Seconds until stump removal
    currentOffset: number; // Current sprite offset
}

// Timing constants
const GROWTH_TIME = 60; // Seconds per growth stage
const STUMP_DECAY_TIME = 30; // Seconds for stump to disappear

/**
 * Manages tree growth, cutting, and stump decay.
 * Uses AnimationService for visual state - no direct entity manipulation.
 */
export class TreeSystem implements TickSystem {
    private states = new Map<number, TreeState>();
    private gameState: GameState;
    private animationService: AnimationService;

    constructor(gameState: GameState, animationService: AnimationService) {
        this.gameState = gameState;
        this.animationService = animationService;
    }

    /**
     * Get sprite offset for a tree state.
     */
    private getSpriteOffset(stage: TreeStage, progress: number): number {
        switch (stage) {
        case TreeStage.Growing:
            if (progress < 0.33) return TREE_OFFSET.SAPLING;
            if (progress < 0.66) return TREE_OFFSET.SMALL;
            return TREE_OFFSET.MEDIUM;

        case TreeStage.Normal:
            return TREE_OFFSET.NORMAL;

        case TreeStage.Cutting:
            // Phase 1: Tree still standing while being chopped
            if (progress < 0.3) return TREE_OFFSET.NORMAL;
            // Phase 2: Tree falls
            if (progress < 0.4) return TREE_OFFSET.FALLING;
            // Phase 3: Cutting the fallen log (5 phases across 0.4-0.9)
            if (progress < 0.9) {
                const phase = Math.floor(((progress - 0.4) / 0.5) * 5);
                return TREE_OFFSET.CUTTING_1 + Math.min(4, phase);
            }
            // Phase 4: Log picked up - canopy disappearing
            return TREE_OFFSET.CANOPY_GONE;

        case TreeStage.Cut:
            return TREE_OFFSET.CANOPY_GONE;
        }
    }

    /**
     * Update visual state by setting entity.variation directly.
     */
    private updateVisual(entityId: number, state: TreeState): void {
        const offset = this.getSpriteOffset(state.stage, state.progress);

        if (offset !== state.currentOffset) {
            state.currentOffset = offset;

            // Set sprite variation directly on entity
            const entity = this.gameState.getEntity(entityId);
            if (entity) {
                entity.variation = offset;

                // Normal trees (offset 3) have sway animation
                if (offset === TREE_OFFSET.NORMAL) {
                    this.animationService.play(entityId, 'default', { loop: true });
                }
            }
        }
    }

    /**
     * Register a tree entity.
     * Only registers if the object type is a tree.
     * @param planted If true, starts as Growing; otherwise Normal
     */
    register(entityId: number, objectType: MapObjectType, planted: boolean = false): void {
        // Only register trees
        if (OBJECT_TYPE_CATEGORY[objectType] !== 'trees') return;

        const stage = planted ? TreeStage.Growing : TreeStage.Normal;
        const offset = this.getSpriteOffset(stage, 0);

        const state: TreeState = {
            stage,
            progress: 0,
            stumpTimer: 0,
            currentOffset: offset,
        };

        this.states.set(entityId, state);

        // Set initial sprite variation
        const entity = this.gameState.getEntity(entityId);
        if (entity) {
            entity.variation = offset;

            // Normal trees have sway animation
            if (offset === TREE_OFFSET.NORMAL) {
                this.animationService.play(entityId, 'default', { loop: true });
            }
        }
    }

    /**
     * Get tree stage for rendering.
     */
    getStage(entityId: number): TreeStage | undefined {
        return this.states.get(entityId)?.stage;
    }

    /**
     * Check if tree can be cut (is in Normal stage, not already being cut).
     */
    canCut(entityId: number): boolean {
        return this.states.get(entityId)?.stage === TreeStage.Normal;
    }

    /**
     * Check if tree is currently being cut (work in progress).
     */
    isCutting(entityId: number): boolean {
        return this.states.get(entityId)?.stage === TreeStage.Cutting;
    }

    /**
     * Start cutting (called by woodcutter).
     */
    startCutting(entityId: number): boolean {
        const state = this.states.get(entityId);
        if (!state || state.stage !== TreeStage.Normal) return false;

        state.stage = TreeStage.Cutting;
        state.progress = 0;
        this.updateVisual(entityId, state);
        return true;
    }

    /**
     * Update cutting progress.
     * @returns true if tree became a stump
     */
    updateCutting(entityId: number, progress: number): boolean {
        const state = this.states.get(entityId);
        if (!state || state.stage !== TreeStage.Cutting) return false;

        state.progress = Math.min(1, progress);

        if (state.progress >= 1) {
            // Cutting complete - transition to Cut stage
            state.stage = TreeStage.Cut;
            state.stumpTimer = STUMP_DECAY_TIME;
            state.progress = 0;
            this.updateVisual(entityId, state);
            return true;
        }

        // Still cutting - update visual if needed
        this.updateVisual(entityId, state);
        return false;
    }

    /**
     * Cancel cutting (woodcutter interrupted).
     */
    cancelCutting(entityId: number): void {
        const state = this.states.get(entityId);
        if (state && state.stage === TreeStage.Cutting) {
            state.stage = TreeStage.Normal;
            state.progress = 0;
            this.updateVisual(entityId, state);
        }
    }

    /**
     * TickSystem interface - update growth and decay.
     */
    tick(dt: number): void {
        const toRemove: number[] = [];

        for (const [entityId, state] of this.states) {
            // Growing trees
            if (state.stage === TreeStage.Growing) {
                state.progress += dt / GROWTH_TIME;
                if (state.progress >= 1) {
                    state.progress = 0;
                    state.stage = TreeStage.Normal;
                }
                this.updateVisual(entityId, state);
            }

            // Decaying stumps
            if (state.stage === TreeStage.Cut) {
                state.stumpTimer -= dt;
                if (state.stumpTimer <= 0) {
                    toRemove.push(entityId);
                }
            }
        }

        // Remove decayed stumps
        for (const entityId of toRemove) {
            this.states.delete(entityId);
            this.gameState.removeEntity(entityId);
        }

        // Cleanup removed entities
        for (const entityId of this.states.keys()) {
            if (!this.gameState.getEntity(entityId)) {
                this.states.delete(entityId);
            }
        }
    }

    /**
     * Get stats for debugging.
     */
    getStats(): Record<TreeStage, number> {
        const stats: Record<TreeStage, number> = {
            [TreeStage.Growing]: 0,
            [TreeStage.Normal]: 0,
            [TreeStage.Cutting]: 0,
            [TreeStage.Cut]: 0,
        };

        for (const state of this.states.values()) {
            stats[state.stage]++;
        }

        return stats;
    }
}
