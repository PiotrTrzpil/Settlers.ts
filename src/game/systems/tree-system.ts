/**
 * Tree lifecycle system - manages tree growth and cutting states.
 *
 * Logical stages (game state):
 *   Growing -> Normal (planted by forester, progress 0-1)
 *   Normal -> Cutting -> Cut (cut by woodcutter, progress 0-1)
 *
 * Animation job offsets (derived from logical state + progress):
 *   +0: sapling, +1: small, +2: medium, +3: normal (sway)
 *   +4: falling, +5-9: cutting phases, +10: canopy disappearing
 */

import type { TickSystem } from '../tick-system';
import type { GameState } from '../game-state';
import { MapObjectType } from '../entity';

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
 * Animation job offsets within each tree type's JIL block.
 */
export const TREE_ANIM_OFFSET = {
    SAPLING: 0,
    SMALL: 1,
    MEDIUM: 2,
    NORMAL: 3,
    FALLING: 4,
    CUTTING_START: 5, // 5-9 are cutting phases
    CANOPY_DISAPPEARING: 10,
} as const;

/**
 * Get animation job offset from logical tree state.
 * Renderer uses this to select correct sprite.
 */
export function getTreeAnimOffset(stage: TreeStage, progress: number): number {
    switch (stage) {
    case TreeStage.Growing:
        // 0-0.33 = sapling, 0.33-0.66 = small, 0.66-1.0 = medium
        if (progress < 0.33) return TREE_ANIM_OFFSET.SAPLING;
        if (progress < 0.66) return TREE_ANIM_OFFSET.SMALL;
        return TREE_ANIM_OFFSET.MEDIUM;

    case TreeStage.Normal:
        return TREE_ANIM_OFFSET.NORMAL;

    case TreeStage.Cutting:
        // 0-0.8 = cutting phases (5-9), 0.8-1.0 = falling
        if (progress < 0.8) {
            const phase = Math.floor((progress / 0.8) * 5);
            return TREE_ANIM_OFFSET.CUTTING_START + Math.min(phase, 4);
        }
        return TREE_ANIM_OFFSET.FALLING;

    case TreeStage.Cut:
        return TREE_ANIM_OFFSET.CANOPY_DISAPPEARING; // Last frame = trunk only
    }
}

/**
 * State for a single tree.
 */
interface TreeState {
    stage: TreeStage;
    progress: number; // 0-1 within current stage
    stumpTimer: number; // Seconds until stump removal
}

// Timing constants
const GROWTH_TIME = 60; // Seconds per growth stage
const STUMP_DECAY_TIME = 30; // Seconds for stump to disappear

/**
 * Manages tree growth, cutting, and stump decay.
 */
export class TreeSystem implements TickSystem {
    private states = new Map<number, TreeState>();
    private gameState: GameState;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /**
     * Register a tree entity.
     * @param planted If true, starts as Growing; otherwise Normal
     */
    register(entityId: number, _treeType: MapObjectType, planted: boolean = false): void {
        this.states.set(entityId, {
            stage: planted ? TreeStage.Growing : TreeStage.Normal,
            progress: 0,
            stumpTimer: 0,
        });
    }

    /**
     * Get tree stage for rendering.
     */
    getStage(entityId: number): TreeStage | undefined {
        return this.states.get(entityId)?.stage;
    }

    /**
     * Check if tree can be cut.
     */
    canCut(entityId: number): boolean {
        return this.states.get(entityId)?.stage === TreeStage.Normal;
    }

    /**
     * Start cutting (called by woodcutter).
     */
    startCutting(entityId: number): boolean {
        const state = this.states.get(entityId);
        if (!state || state.stage !== TreeStage.Normal) return false;

        state.stage = TreeStage.Cutting;
        state.progress = 0;
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
            state.stage = TreeStage.Cut;
            state.stumpTimer = STUMP_DECAY_TIME;
            return true;
        }
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
        }
    }

    /**
     * TickSystem interface - update growth and decay.
     */
    tick(dt: number): void {
        const toRemove: number[] = [];

        for (const [entityId, state] of this.states) {
            // Growing trees
            if (state.stage < TreeStage.Normal) {
                state.progress += dt / GROWTH_TIME;
                if (state.progress >= 1) {
                    state.progress = 0;
                    state.stage++;
                }
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
