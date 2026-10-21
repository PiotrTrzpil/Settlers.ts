/**
 * Barracks Training Manager
 *
 * Manages the training lifecycle for all barracks buildings:
 * 1. Checks recipe selection via ProductionControlManager
 * 2. Dispatches a Barracks job via RecruitSystem (carrier finding, material
 *    reservation from the building's input inventory, job assignment)
 * 3. Tracks active training state per barracks — from dispatch until the transform
 *    (unit:recruited), or until the Barracks job handler reports the job ended early
 * 4. Rebuilds the active trainings from Barracks commitments after a load
 */

import type { GameState } from '@/game/game-state';
import type { CoreDeps } from '../feature';
import type { ProductionControlManager } from '@/game/features/production-control';
import type { EventBus, GameEvents } from '@/game/event-bus';
import { EventSubscriptionManager } from '@/game/event-bus';
import { type Race } from '@/game/core/race';
import type { JobService } from '@/game/features/settler-tasks';
import { JobKind } from '@/game/systems/choreo';
import type { RecruitSystem } from '@/game/features/recruit';
import { getRecipeTargetUnitType, getTrainingRecipeSet, getTrainingRecipes } from './training-recipes';
import type { TrainingRecipe, BarracksTrainingState } from './types';
import { barracksJobSpec, type BarracksJobParams } from './barracks-job-kind';
import { ProductionMode } from '@/game/features/production-control';
import { createLogger } from '@/utilities/logger';

const log = createLogger('BarracksTraining');

type InterruptReason = GameEvents['barracks:trainingInterrupted']['reason'];

export interface BarracksTrainingManagerConfig extends CoreDeps {
    productionControlManager: ProductionControlManager;
    recruitSystem: RecruitSystem;
    jobs: JobService;
}

export class BarracksTrainingManager {
    private readonly gameState: GameState;
    private readonly pcm: ProductionControlManager;
    private readonly eventBus: EventBus;
    private readonly recruitSystem: RecruitSystem;
    private readonly jobs: JobService;
    private readonly subscriptions = new EventSubscriptionManager();

    /** Per-barracks race mapping (set at initBarracks). */
    private readonly barracksRaces = new Map<number, Race>();

    /** Active training state per barracks. Absent = idle, ready for new training. */
    private readonly activeTrainings = new Map<number, BarracksTrainingState>();

    constructor(config: BarracksTrainingManagerConfig) {
        this.gameState = config.gameState;
        this.pcm = config.productionControlManager;
        this.eventBus = config.eventBus;
        this.recruitSystem = config.recruitSystem;
        this.jobs = config.jobs;
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * Register a barracks building for training management.
     * DarkTribe barracks are skipped (no training recipes).
     */
    initBarracks(buildingId: number, race: Race): void {
        const recipeSet = getTrainingRecipeSet(race);
        if (recipeSet.recipes.length === 0) {
            return;
        }

        this.barracksRaces.set(buildingId, race);
        this.pcm.initBuilding(buildingId, recipeSet.recipes.length, ProductionMode.Manual);
    }

    /** Unregister a barracks building, cancel its training jobs and clean up all associated state. */
    removeBarracks(buildingId: number): void {
        for (const unitId of this.jobs.commitments.unitsOwnedBy(JobKind.Barracks, buildingId)) {
            this.jobs.cancel(unitId, JobKind.Barracks);
        }
        this.barracksRaces.delete(buildingId);
        this.activeTrainings.delete(buildingId);
        this.pcm.removeBuilding(buildingId);
    }

    // =========================================================================
    // Tick
    // =========================================================================

    /** Update all barracks in deterministic (sorted entity ID) order. */
    tick(_dt: number): void {
        const sortedIds = [...this.barracksRaces.keys()].sort((a, b) => a - b);
        for (const buildingId of sortedIds) {
            try {
                this.tickBarracks(buildingId);
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Failed to tick barracks ${buildingId}`, err);
            }
        }
    }

    private tickBarracks(buildingId: number): void {
        if (this.activeTrainings.has(buildingId)) {
            // The Barracks job drives progression; it ends the training at the transform
            // (unit:recruited) or, when it ends early, through interruptTraining().
            return;
        }

        this.tryStartTraining(buildingId);
    }

    private tryStartTraining(buildingId: number): void {
        const race = this.barracksRaces.get(buildingId);
        if (!race) {
            throw new Error(`No race for barracks ${buildingId} in BarracksTrainingManager`);
        }

        // 1. Peek at the next recipe WITHOUT consuming it from the queue
        const recipeIndex = this.pcm.peekNextRecipeIndex(buildingId);
        if (recipeIndex === null) {
            return;
        }

        const recipeSet = getTrainingRecipeSet(race);
        const recipe = recipeSet.recipes[recipeIndex];
        if (!recipe) {
            log.warn(`Barracks ${buildingId}: recipe index ${recipeIndex} out of range for race ${race}`);
            return;
        }

        // 2. Dispatch a Barracks job via RecruitSystem — handles carrier finding, material
        //    reservation from the building's input inventory (the barracks' registered
        //    recruit charge = recipe inputs) and job assignment.
        const barracks = this.gameState.getEntityOrThrow(buildingId, 'barracks for training');
        const unitType = getRecipeTargetUnitType(recipe);
        const carrierId = this.recruitSystem.dispatchBuildingRecruitment(unitType, barracks.player, buildingId, () =>
            barracksJobSpec({ barracksId: buildingId, recipeIndex, unitType })
        );
        if (carrierId === null) {
            return;
        }

        // 3. Dispatch succeeded — commit the recipe from the production queue
        this.pcm.getNextRecipeIndex(buildingId);

        // 4. Track active training
        this.activeTrainings.set(buildingId, { recipe, carrierId });

        this.eventBus.emit('barracks:trainingStarted', {
            buildingId,
            recipe,
            unitId: carrierId,
            level: 'info',
        });

        log.debug(
            `Barracks ${buildingId}: started training ${recipe.unitType} L${recipe.soldierLevel}, carrier ${carrierId}`
        );
    }

    // =========================================================================
    // Event registration
    // =========================================================================

    /** Subscribe to unit:recruited to detect when UnitTransformer completes the type change. */
    registerEvents(): void {
        this.subscriptions.subscribe(this.eventBus, 'unit:recruited', ({ unitId }) => {
            this.handleUnitRecruited(unitId);
        });
    }

    /** Unsubscribe from events. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** The transform of a Barracks job happened: the training is complete (the FIGHT wait follows). */
    private handleUnitRecruited(unitId: number): void {
        // Nullable by design: carriers of other owners (and idle direct transforms) recruit too.
        const commitment = this.jobs.commitments.get(unitId);
        if (!commitment || commitment.owner !== JobKind.Barracks) {
            return;
        }
        const buildingId = commitment.ref;
        const state = this.activeTrainings.get(buildingId);
        if (!state || state.carrierId !== unitId) {
            throw new Error(`Barracks ${buildingId}: carrier ${unitId} transformed without an active training`);
        }

        this.activeTrainings.delete(buildingId);

        this.eventBus.emit('barracks:trainingCompleted', {
            buildingId,
            unitType: state.recipe.unitType,
            soldierLevel: state.recipe.soldierLevel,
            unitId,
        });

        log.debug(
            `Barracks ${buildingId}: training completed, carrier ${unitId} → ` +
                `${state.recipe.unitType} L${state.recipe.soldierLevel}`
        );
    }

    // =========================================================================
    // Job outcomes (called by the Barracks job handler)
    // =========================================================================

    /**
     * The Barracks job of `unitId` ended early (failed, preempted, abandoned on restore, carrier
     * removed). Frees the barracks for its next recipe — the interrupted recipe stays consumed.
     * No-op when the job ended after its transform (the training already completed).
     */
    interruptTraining(buildingId: number, unitId: number, reason: InterruptReason): void {
        const state = this.activeTrainings.get(buildingId);
        if (!state || state.carrierId !== unitId) {
            return;
        }
        this.activeTrainings.delete(buildingId);
        this.eventBus.emit('barracks:trainingInterrupted', { buildingId, reason });
        log.debug(`Barracks ${buildingId}: training of carrier ${unitId} interrupted (${reason})`);
    }

    // =========================================================================
    // Restore
    // =========================================================================

    /**
     * Rebuild the active trainings from the restored Barracks commitments (their jobs resume later,
     * in onRestoreResume). Skips units that already transformed (saved in the FIGHT wait — their
     * training completed) and jobs of barracks that are not registered (abandoned on resume).
     */
    rebuildFromCommitments(): void {
        for (const unitId of this.jobs.commitments.unitsOwnedBy(JobKind.Barracks)) {
            const params = this.jobs.paramsOf(unitId) as BarracksJobParams;
            const race = this.barracksRaces.get(params.barracksId);
            const unit = this.gameState.getEntityOrThrow(unitId, 'restored barracks trainee');
            if (race === undefined || unit.subType === params.unitType) {
                continue;
            }
            if (this.activeTrainings.has(params.barracksId)) {
                throw new Error(`Barracks ${params.barracksId}: two restored trainings (carrier ${unitId})`);
            }
            const recipe = getTrainingRecipeSet(race).recipes[params.recipeIndex]!;
            this.activeTrainings.set(params.barracksId, { recipe, carrierId: unitId });
        }
    }

    // =========================================================================
    // Queries
    // =========================================================================

    /** Get the active training state for a barracks, or undefined if idle. */
    getTrainingState(buildingId: number): BarracksTrainingState | undefined {
        return this.activeTrainings.get(buildingId);
    }

    /** Get all available training recipes for a barracks. */
    getRecipes(buildingId: number): readonly TrainingRecipe[] {
        const race = this.barracksRaces.get(buildingId);
        if (!race) {
            return [];
        }
        return getTrainingRecipes(race);
    }

    /** Returns true if `buildingId` is a registered (trainable) barracks. */
    isBarracks(buildingId: number): boolean {
        return this.barracksRaces.has(buildingId);
    }

    /** Returns true if a barracks has an active training session in progress. */
    isTraining(buildingId: number): boolean {
        return this.activeTrainings.has(buildingId);
    }
}
