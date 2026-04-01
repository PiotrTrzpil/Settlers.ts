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
 * Visual state is controlled via EntityVisualService.
 * Normal trees also play 'default' animation for sway.
 */

import { GrowableSystem, type GrowableConfig, type GrowableState } from '../../systems/growth';
import type { CoreDeps } from '../feature';
import { MapObjectCategory, MapObjectType } from '@/game/types/map-object-types';
import { OBJECT_TYPE_CATEGORY } from '../../systems/map-objects';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import type { Command, CommandExecutor } from '../../commands';
import { TREE_JOB_OFFSET, TREE_JOBS_PER_TYPE, TREE_JOB_INDICES } from '../../renderer/sprite-metadata/jil-indices';
import type { EventBus } from '../../event-bus';
import { PersistentMap } from '@/game/persistence/persistent-store';

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
    /** Visual variant index (0 = A, 1 = B). Used for compound variation. */
    variant: number;
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
 * Uses EntityVisualService for visual state - no direct entity manipulation.
 */
export interface TreeSystemConfig extends CoreDeps {
    visualService: EntityVisualService;
    executeCommand: CommandExecutor;
}

export class TreeSystem extends GrowableSystem<TreeState> {
    /** PersistentMap shadows GrowableSystem.states — same Map API, adds auto-persistence. */
    protected override readonly states = new PersistentMap<TreeState>('trees');
    /** Expose for feature persistence registration. */
    get persistentStore(): PersistentMap<TreeState> {
        return this.states;
    }
    private readonly eventBus: EventBus;

    constructor(cfg: TreeSystemConfig) {
        super({
            gameState: cfg.gameState,
            visualService: cfg.visualService,
            growableConfig: TREE_CONFIG,
            logName: 'TreeSystem',
            executeCommand: cfg.executeCommand,
        });
        this.eventBus = cfg.eventBus;
    }

    // ── GrowableSystem implementation ────────────────────────────

    protected shouldRegister(objectType: MapObjectType): boolean {
        return OBJECT_TYPE_CATEGORY[objectType] === MapObjectCategory.Trees;
    }

    protected createState(planted: boolean, objectType: MapObjectType): TreeState {
        const stage = planted ? TreeStage.Growing : TreeStage.Normal;
        const variantCount = TREE_JOB_INDICES[objectType]?.length ?? 1;
        const variant = this.gameState.rng.nextInt(variantCount);
        const state: TreeState = { stage, progress: 0, stumpTimer: 0, currentOffset: 0, variant };
        state.currentOffset = this.getSpriteOffset(state);
        return state;
    }

    protected getSpriteOffset(state: TreeState): number {
        const base = state.variant * TREE_JOBS_PER_TYPE;
        switch (state.stage) {
            case TreeStage.Growing:
                if (state.progress < 0.33) {
                    return base + TREE_OFFSET.SAPLING;
                }
                if (state.progress < 0.66) {
                    return base + TREE_OFFSET.SMALL;
                }
                return base + TREE_OFFSET.MEDIUM;

            case TreeStage.Normal:
                return base + TREE_OFFSET.NORMAL;

            case TreeStage.Cutting:
                // Phase 1: Tree still standing while being chopped
                if (state.progress < 0.3) {
                    return base + TREE_OFFSET.NORMAL;
                }
                // Phase 2: Tree falls
                if (state.progress < 0.4) {
                    return base + TREE_OFFSET.FALLING;
                }
                // Phase 3: Cutting the fallen log (5 phases across 0.4-0.9)
                if (state.progress < 0.9) {
                    const phase = Math.floor(((state.progress - 0.4) / 0.5) * 5);
                    return base + TREE_OFFSET.CUTTING_1 + Math.min(4, phase);
                }
                // Phase 4: Log picked up - canopy disappearing
                return base + TREE_OFFSET.CANOPY_DISAPPEARING;

            case TreeStage.Cut:
                return base + TREE_OFFSET.CANOPY_DISAPPEARING;
        }
    }

    protected onOffsetChanged(entityId: number, offset: number, state: TreeState): void {
        // Variant index is encoded as direction in the animation entry.
        const baseOffset = offset - state.variant * TREE_JOBS_PER_TYPE;
        if (baseOffset === TREE_OFFSET.NORMAL) {
            // Normal trees have sway animation — random start frame to desync.
            const startFrame = this.gameState.rng.nextInt(100);
            this.visualService.play(entityId, 'default', {
                loop: true,
                startFrame,
                direction: state.variant,
            });
        } else if (baseOffset === TREE_OFFSET.FALLING) {
            this.visualService.play(entityId, 'falling', {
                loop: false,
                direction: state.variant,
            });
        } else if (baseOffset === TREE_OFFSET.CANOPY_DISAPPEARING) {
            this.visualService.play(entityId, 'canopy_disappearing', {
                loop: false,
                direction: state.variant,
            });
        } else {
            // Clear animation so the renderer falls back to the
            // variation-specific static sprite (cutting stages, stump, etc.)
            this.visualService.clearAnimation(entityId);
        }
    }

    protected tickState(entityId: number, state: TreeState, dt: number): 'keep' | 'remove' {
        // Growing trees
        if (state.stage === TreeStage.Growing) {
            if (this.advanceGrowth(state, dt)) {
                state.stage = TreeStage.Normal;
                this.gameState.getEntityOrThrow(entityId, 'tree:matured').operational = true;
                this.eventBus.emit('tree:matured', { entityId });
            }
            this.updateVisual(entityId, state);
        }

        // Decaying stumps
        if (state.stage === TreeStage.Cut) {
            state.stumpTimer -= dt;
            if (state.stumpTimer <= 0) {
                return 'remove';
            }
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
        if (!state || state.stage !== TreeStage.Normal) {
            return false;
        }

        state.stage = TreeStage.Cutting;
        state.progress = 0;
        // Clear sway animation immediately — the initial cutting sprite offset equals
        // NORMAL, so updateVisual won't detect a change or call onOffsetChanged.
        this.visualService.clearAnimation(entityId);
        this.updateVisual(entityId, state);
        return true;
    }

    /**
     * Update cutting progress.
     * @returns true if tree became a stump
     */
    updateCutting(entityId: number, progress: number): boolean {
        const state = this.states.get(entityId);
        if (!state || state.stage !== TreeStage.Cutting) {
            return false;
        }

        state.progress = Math.min(1, progress);

        if (state.progress >= 1) {
            // Cutting complete - transition to Cut stage
            state.stage = TreeStage.Cut;
            state.stumpTimer = STUMP_DECAY_TIME;
            state.progress = 0;
            this.updateVisual(entityId, state);
            this.eventBus.emit('tree:cut', { entityId });
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
