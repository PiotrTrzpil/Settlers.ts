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
import type { CoreDeps } from '../feature';
import type { BuildingInventoryManager } from '@/game/features/inventory';
import type { CarrierRegistry } from '@/game/features/carriers';
import type { SettlerTaskSystem } from '@/game/features/settler-tasks';
import type { ProductionControlManager } from '@/game/features/production-control';
import type { EventBus } from '@/game/event-bus';
import { type Race } from '@/game/core/race';
import { UnitType } from '@/game/core/unit-types';
import { type EMaterialType } from '@/game/economy/material-type';
import { BuildingType } from '@/game/buildings/building-type';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { choreo, type ChoreoJobState } from '@/game/features/settler-tasks/choreo-types';
import { getTrainingRecipeSet, getTrainingRecipes } from './training-recipes';
import type { TrainingRecipe, BarracksTrainingState } from './types';
import { createLogger } from '@/utilities/logger';
import type { IdleCarrierPool } from '@/game/features/carriers';
import type { UnitReservationRegistry } from '@/game/systems/unit-reservation';
import { sortedEntries } from '@/utilities/collections';
import type { Persistable } from '@/game/persistence';
import type { SerializedBarracksTraining } from '@/game/state/game-state-persistence';

const log = createLogger('BarracksTraining');

/** Training duration in animation frames (at 10fps = 3 seconds). */
export const TRAINING_DURATION_FRAMES = 30;

export interface BarracksTrainingManagerConfig extends CoreDeps {
    inventoryManager: BuildingInventoryManager;
    carrierRegistry: CarrierRegistry;
    idleCarrierPool: IdleCarrierPool;
    settlerTaskSystem: SettlerTaskSystem;
    productionControlManager: ProductionControlManager;
    unitReservation: UnitReservationRegistry;
}

export class BarracksTrainingManager implements Persistable<SerializedBarracksTraining> {
    readonly persistKey = 'barracksTraining' as const;
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly carrierRegistry: CarrierRegistry;
    private readonly settlerTaskSystem: SettlerTaskSystem;
    private readonly pcm: ProductionControlManager;
    private readonly eventBus: EventBus;
    private readonly idleCarrierPool: IdleCarrierPool;
    private readonly unitReservation: UnitReservationRegistry;

    /** Per-barracks race mapping (set at initBarracks). */
    private readonly barracksRaces = new Map<number, Race>();

    /** Active training state per barracks. Absent = idle, ready for new training. */
    private readonly activeTrainings = new Map<number, BarracksTrainingState>();

    constructor(config: BarracksTrainingManagerConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
        this.carrierRegistry = config.carrierRegistry;
        this.settlerTaskSystem = config.settlerTaskSystem;
        this.pcm = config.productionControlManager;
        this.eventBus = config.eventBus;
        this.idleCarrierPool = config.idleCarrierPool;
        this.unitReservation = config.unitReservation;
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
        this.pcm.initBuilding(buildingId, recipeSet.recipes.length);
    }

    /** Unregister a barracks building and clean up all associated state. */
    removeBarracks(buildingId: number): void {
        this.barracksRaces.delete(buildingId);
        const active = this.activeTrainings.get(buildingId);
        if (active) {
            this.unitReservation.release(active.carrierId);
            this.activeTrainings.delete(buildingId);
        }
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
            // Choreography system drives progression — nothing else to do while active.
            // If the carrier is killed, UnitReservationRegistry fires onForcedRelease which
            // clears activeTrainings and emits the interrupted event automatically.
            return;
        }

        // No active training — attempt to start one
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

        // 2. Verify inventory holds all required inputs
        if (!this.hasInputs(buildingId, recipe)) {
            return;
        }

        // 3. Locate an idle carrier for this player
        const barracks = this.gameState.getEntityOrThrow(buildingId, 'barracks for training');
        const carrierId = this.idleCarrierPool.findNearest(barracks.x, barracks.y, barracks.player);
        if (carrierId === null) {
            return;
        }

        // 4. All conditions met — now commit the recipe (consume from queue in manual mode)
        this.pcm.getNextRecipeIndex(buildingId);

        // 5. Consume inputs
        this.consumeInputs(buildingId, recipe);

        // 6. Build and assign training choreography job
        const doorPos = getBuildingDoorPos(barracks.x, barracks.y, barracks.race, BuildingType.Barrack);
        const job = buildTrainingJob(buildingId, doorPos.x, doorPos.y, TRAINING_DURATION_FRAMES);
        const assigned = this.settlerTaskSystem.assignJob(carrierId, job, doorPos);
        if (!assigned) {
            log.debug(`Barracks ${buildingId}: assignJob failed for carrier ${carrierId}, reverting`);
            return;
        }

        // 7. Remove carrier from logistics so it won't be reassigned
        this.carrierRegistry.remove(carrierId);

        // 8. Reserve the carrier so player move commands cannot interrupt it.
        //    onForcedRelease handles the carrier-killed case automatically.
        this.unitReservation.reserve(carrierId, {
            purpose: 'barracks-training',
            onForcedRelease: () => {
                this.activeTrainings.delete(buildingId);
                this.eventBus.emit('barracks:trainingInterrupted', {
                    buildingId,
                    reason: 'carrier_killed',
                    level: 'warn',
                });
                log.debug(`Barracks ${buildingId}: carrier ${carrierId} killed, training interrupted`);
            },
        });

        // 9. Track active training
        this.activeTrainings.set(buildingId, { recipe, carrierId });

        this.eventBus.emit('barracks:trainingStarted', {
            buildingId,
            recipe,
            unitId: carrierId,
            level: 'info',
        });

        log.debug(
            `Barracks ${buildingId}: started training ${UnitType[recipe.unitType]} L${recipe.soldierLevel}, carrier ${carrierId}`
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
        this.unitReservation.release(state.carrierId);
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
        if (!race) {
            return [];
        }
        return getTrainingRecipes(race);
    }

    /** Returns true if a barracks has an active training session in progress. */
    isTraining(buildingId: number): boolean {
        return this.activeTrainings.has(buildingId);
    }

    // =========================================================================
    // Persistable
    // =========================================================================

    serialize(): SerializedBarracksTraining {
        const races: SerializedBarracksTraining['races'] = [];
        for (const [buildingId, race] of this.barracksRaces) {
            races.push({ buildingId, race: race as number });
        }

        const activeTrainings: SerializedBarracksTraining['activeTrainings'] = [];
        for (const [buildingId, state] of this.activeTrainings) {
            activeTrainings.push({
                buildingId,
                carrierId: state.carrierId,
                recipe: {
                    inputs: state.recipe.inputs.map(i => ({ material: i.material as number, count: i.count })),
                    unitType: state.recipe.unitType as number,
                    level: state.recipe.soldierLevel,
                },
            });
        }

        return { races, activeTrainings };
    }

    deserialize(data: SerializedBarracksTraining): void {
        this.barracksRaces.clear();
        for (const entry of data.races) {
            this.barracksRaces.set(entry.buildingId, entry.race as Race);
        }

        this.activeTrainings.clear();
        for (const entry of data.activeTrainings) {
            const recipe: TrainingRecipe = {
                inputs: entry.recipe.inputs.map(i => ({
                    material: i.material as EMaterialType,
                    count: i.count,
                })),
                unitType: entry.recipe.unitType as UnitType,
                soldierLevel: entry.recipe.level,
            };
            this.activeTrainings.set(entry.buildingId, {
                recipe,
                carrierId: entry.carrierId,
            });
            // Restore reservation so the carrier cannot be interrupted after load.
            const buildingId = entry.buildingId;
            const carrierId = entry.carrierId;
            this.unitReservation.reserve(carrierId, {
                purpose: 'barracks-training',
                onForcedRelease: () => {
                    this.activeTrainings.delete(buildingId);
                    this.eventBus.emit('barracks:trainingInterrupted', {
                        buildingId,
                        reason: 'carrier_killed',
                        level: 'warn',
                    });
                },
            });
        }
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
function buildTrainingJob(barracksId: number, doorX: number, doorY: number, durationFrames: number): ChoreoJobState {
    return choreo('BARRACKS_TRAINING')
        .goTo(doorX, doorY)
        .hidden(durationFrames, 'BARRACKS_TRAINING')
        .changeTypeAtBarracks()
        .target(barracksId)
        .build();
}
