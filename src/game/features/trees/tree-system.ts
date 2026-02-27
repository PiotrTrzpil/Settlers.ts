/**
 * Tree lifecycle system - manages tree growth, cutting, and planting.
 *
 * Extends GrowableSystem for shared growth/planting infrastructure.
 * Adds tree-specific: cutting stages, stump decay, sway animation.
 *
 * Logical stages:
 *   Growing -> Normal (planted by forester, progress 0-1)
 *   Normal -> Cutting -> Cut (cut by woodcutter, progress 0-1)
 *
 * Visual state is controlled by setting entity.variation directly.
 * Normal trees (variation=3) also play 'default' animation for sway.
 */

import { GrowableSystem, type GrowableConfig, type GrowableState } from '../growth';
import type { GameState } from '../../game-state';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import type { AnimationService } from '../../animation/index';
import type { Command } from '../../commands';
import { TREE_JOB_OFFSET } from '../../renderer/sprite-metadata/gil-indices';

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

/** Alias for local use — maps tree stages to JIL job offsets */
const TREE_OFFSET = TREE_JOB_OFFSET;

/**
 * State for a single tree.
 */
export interface TreeState extends GrowableState {
    stage: TreeStage;
    stumpTimer: number; // Seconds until stump removal
}

// Timing constants
const GROWTH_TIME = 60; // Seconds per growth stage
const STUMP_DECAY_TIME = 30; // Seconds for stump to disappear

// Forester constants
const PLANTING_SEARCH_RADIUS = 15;
const MIN_TREE_DISTANCE_SQ = 4; // 2 tiles minimum between trees

/** Tree types foresters can plant */
const PLANTABLE_TREE_TYPES: readonly MapObjectType[] = [
    MapObjectType.TreeOak,
    MapObjectType.TreeBeech,
    MapObjectType.TreeFir,
    MapObjectType.TreeSpruce,
    MapObjectType.TreePine,
    MapObjectType.TreeBirch,
];

const TREE_CONFIG: GrowableConfig = {
    growthTime: GROWTH_TIME,
    plantingSearchRadius: PLANTING_SEARCH_RADIUS,
    minDistanceSq: MIN_TREE_DISTANCE_SQ,
    objectCategory: MapObjectCategory.Trees,
    plantableTypes: PLANTABLE_TREE_TYPES,
    requireFreeNeighbors: true,
};

/**
 * Manages tree growth, cutting, and stump decay.
 * Uses AnimationService for visual state - no direct entity manipulation.
 */
export class TreeSystem extends GrowableSystem<TreeState> {
    constructor(gameState: GameState, animationService: AnimationService) {
        super(gameState, animationService, TREE_CONFIG, 'TreeSystem');
    }

    // ── GrowableSystem implementation ────────────────────────────

    protected shouldRegister(objectType: MapObjectType): boolean {
        return OBJECT_TYPE_CATEGORY[objectType] === MapObjectCategory.Trees;
    }

    protected createState(planted: boolean, _objectType: MapObjectType): TreeState {
        const stage = planted ? TreeStage.Growing : TreeStage.Normal;
        const state: TreeState = { stage, progress: 0, stumpTimer: 0, currentOffset: 0 };
        state.currentOffset = this.getSpriteOffset(state);
        return state;
    }

    protected getSpriteOffset(state: TreeState): number {
        switch (state.stage) {
        case TreeStage.Growing:
            if (state.progress < 0.33) return TREE_OFFSET.SAPLING;
            if (state.progress < 0.66) return TREE_OFFSET.SMALL;
            return TREE_OFFSET.MEDIUM;

        case TreeStage.Normal:
            return TREE_OFFSET.NORMAL;

        case TreeStage.Cutting:
            // Phase 1: Tree still standing while being chopped
            if (state.progress < 0.3) return TREE_OFFSET.NORMAL;
            // Phase 2: Tree falls
            if (state.progress < 0.4) return TREE_OFFSET.FALLING;
            // Phase 3: Cutting the fallen log (5 phases across 0.4-0.9)
            if (state.progress < 0.9) {
                const phase = Math.floor(((state.progress - 0.4) / 0.5) * 5);
                return TREE_OFFSET.CUTTING_1 + Math.min(4, phase);
            }
            // Phase 4: Log picked up - canopy disappearing
            return TREE_OFFSET.CANOPY_DISAPPEARING;

        case TreeStage.Cut:
            return TREE_OFFSET.CANOPY_DISAPPEARING;
        }
    }

    protected onOffsetChanged(entityId: number, offset: number, _state: TreeState): void {
        // Normal trees (offset 3) have sway animation — random start frame to desync
        if (offset === TREE_OFFSET.NORMAL) {
            const startFrame = this.gameState.rng.nextInt(100);
            this.animationService.play(entityId, 'default', { loop: true, startFrame });
        }
    }

    protected tickState(entityId: number, state: TreeState, dt: number): 'keep' | 'remove' {
        // Growing trees
        if (state.stage === TreeStage.Growing) {
            if (this.advanceGrowth(state, dt)) {
                state.stage = TreeStage.Normal;
            }
            this.updateVisual(entityId, state);
        }

        // Decaying stumps
        if (state.stage === TreeStage.Cut) {
            state.stumpTimer -= dt;
            if (state.stumpTimer <= 0) return 'remove';
        }

        return 'keep';
    }

    protected buildPlantCommand(treeType: MapObjectType, x: number, y: number): Command {
        return { type: 'plant_tree', treeType, x, y };
    }

    // ── Tree-specific: queries ───────────────────────────────────

    /**
     * Get tree stage for rendering.
     */
    getStage(entityId: number): TreeStage | undefined {
        return this.states.get(entityId)?.stage;
    }

    /**
     * Get tree state by entity ID.
     */
    getTreeState(entityId: number): TreeState | undefined {
        return this.states.get(entityId);
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

    // ── Tree-specific: cutting ───────────────────────────────────

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

    // ── Backward-compatible aliases ──────────────────────────────

    plantTree(x: number, y: number, settlerId: number): void {
        this.plantEntity(x, y, settlerId);
    }

    plantTreesNear(cx: number, cy: number, count: number, radius = PLANTING_SEARCH_RADIUS): number {
        return this.plantEntitiesNear(cx, cy, count, radius);
    }

    *getAllTreeStates(): IterableIterator<[number, TreeState]> {
        yield* this.getAllStates();
    }

    restoreTreeState(entityId: number, data: TreeState): void {
        this.restoreState(entityId, data);
    }

    // ── Debug ────────────────────────────────────────────────────

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
