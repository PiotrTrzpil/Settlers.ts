/**
 * Barracks Training Manager
 *
 * Manages the training lifecycle for all barracks buildings:
 * 1. Checks recipe selection via ProductionControlManager
 * 2. Dispatches recruitment via RecruitSystem (carrier finding, material
 *    reservation from building input inventory, job assignment, transform)
 * 3. Tracks active training state per barracks
 * 4. Listens for unit:recruited to emit barracks-specific completion events
 */

import type { GameState } from '@/game/game-state';
import type { CoreDeps } from '../feature';
import type { ProductionControlManager } from '@/game/features/production-control';
import type { EventBus } from '@/game/event-bus';
import { EventSubscriptionManager } from '@/game/event-bus';
import { type Race } from '@/game/core/race';
import { type UnitType, getUnitTypeAtLevel } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { choreo, type ChoreoJobState } from '@/game/features/settler-tasks';
import { ChoreoTaskType } from '@/game/systems/choreo';
import type { RecruitSystem } from '@/game/systems/recruit/recruit-system';
import { getTrainingRecipeSet, getTrainingRecipes } from './training-recipes';
import type { TrainingRecipe, BarracksTrainingState } from './types';
import { ProductionMode } from '@/game/features/production-control';
import { createLogger } from '@/utilities/logger';
import { UNIT_XML_PREFIX } from '@/game/renderer/sprite-metadata';
import { xmlKey } from '@/game/animation/animation';

const log = createLogger('BarracksTraining');

/** Training duration in animation frames (at 10fps = 3 seconds). */
export const TRAINING_DURATION_FRAMES = 30;

export interface BarracksTrainingManagerConfig extends CoreDeps {
    productionControlManager: ProductionControlManager;
    recruitSystem: RecruitSystem;
}

export class BarracksTrainingManager {
    private readonly gameState: GameState;
    private readonly pcm: ProductionControlManager;
    private readonly eventBus: EventBus;
    private readonly recruitSystem: RecruitSystem;
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

    /** Unregister a barracks building and clean up all associated state. */
    removeBarracks(buildingId: number): void {
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
            // Choreography system drives progression — nothing else to do while active.
            // If the carrier is killed, UnitTransformer's onForcedRelease clears the
            // building reservation; unit:recruited won't fire so activeTrainings stays
            // until barracks:trainingInterrupted is emitted below.
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

        // 2. Dispatch recruitment via RecruitSystem — handles carrier finding,
        //    material reservation from building input inventory, job assignment,
        //    and carrier transform registration.
        const barracks = this.gameState.getEntityOrThrow(buildingId, 'barracks for training');
        const targetUnitType = getUnitTypeAtLevel(recipe.unitType, recipe.soldierLevel);
        const doorPos = getBuildingDoorPos(barracks, barracks.race, BuildingType.Barrack);

        const carrierId = this.recruitSystem.dispatchRecruitmentFromBuilding(
            targetUnitType,
            barracks.player,
            buildingId,
            recipe.inputs,
            {
                buildJob: candidate =>
                    buildTrainingJob(
                        buildingId,
                        doorPos.x,
                        doorPos.y,
                        targetUnitType,
                        candidate.reservationId!,
                        TRAINING_DURATION_FRAMES
                    ),
            },
            'input'
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

    private handleUnitRecruited(unitId: number): void {
        for (const [buildingId, state] of this.activeTrainings) {
            if (state.carrierId !== unitId) {
                continue;
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
            return;
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

    /** Returns true if a barracks has an active training session in progress. */
    isTraining(buildingId: number): boolean {
        return this.activeTrainings.has(buildingId);
    }
}

// =========================================================================
// Training choreography job builder
// =========================================================================

/**
 * Build a ChoreoJobState for a barracks training cycle.
 *
 * Nodes:
 *   1. GO_TO_TARGET              — carrier walks to the barracks door
 *   2. TRANSFORM_RECRUIT_BUILDING — withdraw materials + emit recruitment:completed
 *   3. WAIT (FIGHT)              — now-soldier plays fighting animation at the door
 */
function buildTrainingJob(
    barracksId: number,
    doorX: number,
    doorY: number,
    targetUnitType: UnitType,
    reservationId: number,
    durationFrames: number
): ChoreoJobState {
    const prefix = UNIT_XML_PREFIX[targetUnitType]!;
    const fightJobPart = xmlKey(prefix, 'FIGHT');

    return choreo('BARRACKS_TRAINING')
        .goTo({ x: doorX, y: doorY })
        .transformRecruitBuilding(targetUnitType, reservationId)
        .addNode(ChoreoTaskType.WAIT, { duration: durationFrames, jobPart: fightJobPart })
        .target(barracksId)
        .build();
}
