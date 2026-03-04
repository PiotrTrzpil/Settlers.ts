/**
 * Barracks Training Manager
 *
 * Manages the training lifecycle for all barracks buildings:
 * 1. Checks recipe selection via ProductionControlManager
 * 2. Verifies inventory has required inputs
 * 3. Finds nearest idle carrier belonging to the same player
 * 4. Builds training choreography job and assigns to carrier
 * 5. Tracks active training state per barracks
 */

import type { GameState } from '@/game/game-state';
import type { BuildingInventoryManager } from '@/game/features/inventory';
import type { CarrierManager } from '@/game/features/carriers';
import type { SettlerTaskSystem } from '@/game/features/settler-tasks';
import type { ProductionControlManager } from '@/game/features/production-control';
import type { EventBus } from '@/game/event-bus';
import type { Race } from '@/game/race';
import { UnitType } from '@/game/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import { getBuildingDoorPos } from '@/game/game-data-access';
import {
    ChoreoTaskType,
    createChoreoJobState,
    type ChoreoNode,
    type ChoreoJobState,
} from '@/game/features/settler-tasks/choreo-types';
import { getTrainingRecipeSet, getTrainingRecipes } from './training-recipes';
import type { TrainingRecipe, BarracksTrainingState } from './types';
import { LogHandler } from '@/utilities/log-handler';
import { sortedEntries } from '@/utilities/collections';

const log = new LogHandler('BarracksTraining');

/** Training duration in animation frames (at 10fps = 3 seconds). */
export const TRAINING_DURATION_FRAMES = 30;

export interface BarracksTrainingManagerConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
    carrierManager: CarrierManager;
    settlerTaskSystem: SettlerTaskSystem;
    productionControlManager: ProductionControlManager;
    eventBus: EventBus;
}

export class BarracksTrainingManager {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly carrierManager: CarrierManager;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly pcm: ProductionControlManager;
    private readonly eventBus: EventBus;

    /** Per-barracks race mapping (set at initBarracks). */
    private readonly barracksRaces = new Map<number, Race>();

    /** Active training state per barracks. Absent = idle, ready for new training. */
    private readonly activeTrainings = new Map<number, BarracksTrainingState>();

    constructor(config: BarracksTrainingManagerConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
        this.carrierManager = config.carrierManager;
        this.settlerTaskSystem = config.settlerTaskSystem;
        this.pcm = config.productionControlManager;
        this.eventBus = config.eventBus;
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
        if (recipeSet.recipes.length === 0) return;

        this.barracksRaces.set(buildingId, race);
        this.pcm.initBuilding(buildingId, recipeSet.recipes.length);
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
        const active = this.activeTrainings.get(buildingId);

        if (active) {
            // Check if carrier still exists (may have been killed en route)
            const carrier = this.gameState.getEntity(active.carrierId);
            if (!carrier) {
                // Carrier died — clear state, consumed materials are lost
                this.activeTrainings.delete(buildingId);
                this.eventBus.emit('barracks:trainingInterrupted', {
                    buildingId,
                    reason: 'carrier_killed',
                });
                log.debug(`Barracks ${buildingId}: carrier ${active.carrierId} killed, training interrupted`);
            }
            // Choreography system drives progression — nothing else to do while active
            return;
        }

        // No active training — attempt to start one
        this.tryStartTraining(buildingId);
    }

    private tryStartTraining(buildingId: number): void {
        const race = this.barracksRaces.get(buildingId);
        if (!race) throw new Error(`No race for barracks ${buildingId} in BarracksTrainingManager`);

        // 1. Peek at the next recipe WITHOUT consuming it from the queue
        const recipeIndex = this.pcm.peekNextRecipeIndex(buildingId);
        if (recipeIndex === null) return;

        const recipeSet = getTrainingRecipeSet(race);
        const recipe = recipeSet.recipes[recipeIndex];
        if (!recipe) {
            log.warn(`Barracks ${buildingId}: recipe index ${recipeIndex} out of range for race ${race}`);
            return;
        }

        // 2. Verify inventory holds all required inputs
        if (!this.hasInputs(buildingId, recipe)) return;

        // 3. Locate an idle carrier for this player
        const barracks = this.gameState.getEntityOrThrow(buildingId, 'barracks for training');
        const carrierId = this.findIdleCarrier(barracks.player, barracks.x, barracks.y);
        if (carrierId === null) return;

        // 4. All conditions met — now commit the recipe (consume from queue in manual mode)
        this.pcm.getNextRecipeIndex(buildingId);

        // 5. Consume inputs
        this.consumeInputs(buildingId, recipe);

        // 6. Build and assign training choreography job
        const doorPos = getBuildingDoorPos(barracks.x, barracks.y, barracks.race, BuildingType.Barrack);
        const job = buildTrainingJob(buildingId, barracks.x, barracks.y, TRAINING_DURATION_FRAMES);
        const assigned = this.settlerTaskSystem.assignJob(carrierId, job, doorPos);
        if (!assigned) {
            log.debug(`Barracks ${buildingId}: assignJob failed for carrier ${carrierId}, reverting`);
            return;
        }

        // 7. Remove carrier from logistics so it won't be reassigned
        this.carrierManager.removeCarrier(carrierId);

        // 8. Track active training
        this.activeTrainings.set(buildingId, { recipe, carrierId });

        this.eventBus.emit('barracks:trainingStarted', {
            buildingId,
            recipe,
            carrierId,
        });

        log.debug(
            `Barracks ${buildingId}: started training ${UnitType[recipe.unitType]} L${recipe.level}, carrier ${carrierId}`
        );
    }

    private hasInputs(buildingId: number, recipe: TrainingRecipe): boolean {
        for (const { material, count } of recipe.inputs) {
            if (this.inventoryManager.getInputAmount(buildingId, material) < count) {
                return false;
            }
        }
        return true;
    }

    private consumeInputs(buildingId: number, recipe: TrainingRecipe): void {
        for (const { material, count } of recipe.inputs) {
            this.inventoryManager.withdrawInput(buildingId, material, count);
        }
    }

    /**
     * Find the nearest idle carrier belonging to `player` near the given position.
     * Iterates all carriers managed by CarrierManager, filters by player entity lookup
     * and `canAssignJobTo`, then selects the closest by Euclidean distance squared.
     */
    private findIdleCarrier(player: number, nearX: number, nearY: number): number | null {
        let bestId: number | null = null;
        let bestDistSq = Infinity;

        for (const carrierState of this.carrierManager.getAllCarriers()) {
            if (!this.carrierManager.canAssignJobTo(carrierState.entityId)) continue;

            const entity = this.gameState.getEntity(carrierState.entityId);
            if (!entity || entity.player !== player) continue;

            const dx = entity.x - nearX;
            const dy = entity.y - nearY;
            const distSq = dx * dx + dy * dy;

            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestId = carrierState.entityId;
            }
        }

        return bestId;
    }

    // =========================================================================
    // State lookup API (for CHANGE_TYPE_AT_BARRACKS executor)
    // =========================================================================

    /**
     * Find the active training state for a carrier.
     * Used by the CHANGE_TYPE_AT_BARRACKS choreography executor to identify
     * which recipe to apply when the carrier completes training.
     */
    getTrainingForCarrier(carrierId: number): { buildingId: number; recipe: TrainingRecipe } | undefined {
        for (const [buildingId, state] of sortedEntries(this.activeTrainings)) {
            if (state.carrierId === carrierId) {
                return { buildingId, recipe: state.recipe };
            }
        }
        return undefined;
    }

    /**
     * Called by the CHANGE_TYPE_AT_BARRACKS executor after successful unit conversion.
     * Clears the active training state so the barracks can start a new cycle.
     */
    completeTraining(buildingId: number): void {
        const state = this.activeTrainings.get(buildingId);
        if (!state) {
            log.warn(`completeTraining: no active training for barracks ${buildingId}`);
            return;
        }
        this.activeTrainings.delete(buildingId);
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
        if (!race) return [];
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
 *   1. GO_TO_TARGET   — carrier walks to the barracks door
 *   2. WAIT_VIRTUAL   — carrier waits inside barracks for durationFrames
 *   3. CHANGE_TYPE_AT_BARRACKS — choreography executor converts carrier to soldier
 */
function buildTrainingJob(
    barracksId: number,
    barracksX: number,
    barracksY: number,
    durationFrames: number
): ChoreoJobState {
    const nodes: ChoreoNode[] = [
        {
            task: ChoreoTaskType.GO_TO_TARGET,
            jobPart: '',
            x: 0,
            y: 0,
            duration: 0,
            dir: -1,
            forward: true,
            visible: true,
            useWork: false,
            entity: '',
            trigger: '',
        },
        {
            task: ChoreoTaskType.WAIT_VIRTUAL,
            jobPart: '',
            x: 0,
            y: 0,
            duration: durationFrames,
            dir: -1,
            forward: true,
            visible: false,
            useWork: false,
            entity: '',
            trigger: 'BARRACKS_TRAINING',
        },
        {
            task: ChoreoTaskType.CHANGE_TYPE_AT_BARRACKS,
            jobPart: '',
            x: 0,
            y: 0,
            duration: 0,
            dir: -1,
            forward: true,
            visible: true,
            useWork: false,
            entity: '',
            trigger: '',
        },
    ];

    const job = createChoreoJobState('BARRACKS_TRAINING', nodes);
    job.targetId = barracksId;
    job.targetPos = { x: barracksX, y: barracksY };
    return job;
}
