/**
 * game-view-state.ts — Reactive bridge between GameState and Vue components.
 *
 * This is the single source of truth for game state that the UI needs:
 * input mode, selection, and entity counts. Updated from the game loop
 * every tick.
 *
 * Exposed on `window.__settlers__.view` for e2e tests.
 */

import { reactive } from 'vue';
import { EntityType } from './entity';
import { MapObjectType } from '@/game/types/map-object-types';
import { isResourceDeposit, getEnvironmentSubLayer, EnvironmentSubLayer } from './renderer/layer-visibility';
import type { GameState } from './game-state';
import { getBridge } from './debug-bridge';

export interface GameViewStateData {
    /** Increments every update — use as a reactive dirty flag in Vue computeds */
    tick: number;

    /** True when game ticks are paused (sprites not loaded yet, or game paused) */
    ticksPaused: boolean;

    // Input mode (written by InputManager onModeChange callback)
    mode: string;
    placeBuildingType: number;
    placePileType: number;
    placeUnitType: number;
    placeUnitLevel: number;

    // Selection
    selectedEntityId: number | null;
    selectedCount: number;

    // Entity counts
    entityCount: number;
    buildingCount: number;
    unitCount: number;
    pileCount: number;
    environmentCount: number;
    treeCount: number;
    stoneCount: number;
    plantCount: number;
    otherCount: number;
    unitsMoving: number;
    totalPathSteps: number;
}

export class GameViewState {
    public readonly state: GameViewStateData;

    // Throttle entity counting — no need to count every tick
    private lastEntityCountUpdate = 0;
    private static readonly ENTITY_COUNT_INTERVAL = 500; // ms

    constructor() {
        this.state = reactive<GameViewStateData>({
            tick: 0,
            ticksPaused: true,
            mode: 'select',
            placeBuildingType: 0,
            placePileType: 0,
            placeUnitType: 0,
            placeUnitLevel: 1,
            selectedEntityId: null,
            selectedCount: 0,
            entityCount: 0,
            buildingCount: 0,
            unitCount: 0,
            pileCount: 0,
            environmentCount: 0,
            treeCount: 0,
            stoneCount: 0,
            plantCount: 0,
            otherCount: 0,
            unitsMoving: 0,
            totalPathSteps: 0,
        });

        // Expose on bridge for e2e tests
        const bridge = getBridge();
        bridge.view = this.state;
        bridge.viewState = this;
    }

    /**
     * Update view state from game state.
     * Called from GameLoop.tick() so Vue components see up-to-date data.
     */
    // eslint-disable-next-line complexity -- switch-exhaustiveness-check forces explicit cases for EntityType.Decoration
    public updateFromGameState(gameState: GameState): void {
        this.state.tick++;

        // Always update total count (cheap)
        this.state.entityCount = gameState.entities.length;

        // Always update selection (cheap)
        this.state.selectedEntityId = gameState.selection.selectedEntityId;
        this.state.selectedCount = gameState.selection.selectedEntityIds.size;

        // Throttle expensive per-entity counting
        const now = performance.now();
        if (now - this.lastEntityCountUpdate < GameViewState.ENTITY_COUNT_INTERVAL) {
            return;
        }
        this.lastEntityCountUpdate = now;

        let buildings = 0;
        let units = 0;
        let resources = 0;
        let environment = 0;
        let trees = 0;
        let stones = 0;
        let plants = 0;
        let other = 0;

        for (const e of gameState.entities) {
            switch (e.type) {
            case EntityType.Building:
                buildings++;
                break;
            case EntityType.Unit:
                units++;
                break;
            case EntityType.StackedPile:
                resources++;
                break;
            case EntityType.MapObject: {
                const objType = e.subType as MapObjectType;
                if (isResourceDeposit(objType)) {
                    resources++;
                } else {
                    environment++;
                    switch (getEnvironmentSubLayer(objType)) {
                    case EnvironmentSubLayer.Trees:
                        trees++;
                        break;
                    case EnvironmentSubLayer.Stones:
                        stones++;
                        break;
                    case EnvironmentSubLayer.Plants:
                        plants++;
                        break;
                    case EnvironmentSubLayer.Other:
                        other++;
                        break;
                    }
                }
                break;
            }
            case EntityType.Decoration:
            case EntityType.None:
                break;
            }
        }
        this.state.buildingCount = buildings;
        this.state.unitCount = units;
        this.state.pileCount = resources;
        this.state.environmentCount = environment;
        this.state.treeCount = trees;
        this.state.stoneCount = stones;
        this.state.plantCount = plants;
        this.state.otherCount = other;

        let moving = 0;
        let pathSteps = 0;
        for (const controller of gameState.movement.getAllControllers()) {
            const remaining = controller.path.length - controller.pathIndex;
            if (remaining > 0) {
                moving++;
                pathSteps += remaining;
            }
        }
        this.state.unitsMoving = moving;
        this.state.totalPathSteps = pathSteps;
    }

    /** Reset state counters (e.g. on game restart / HMR). */
    public reset(): void {
        this.state.tick = 0;
        this.lastEntityCountUpdate = 0;
    }

    /**
     * Force an immediate entity count update, bypassing the throttle.
     * Used by e2e tests after state mutations so count assertions resolve
     * without waiting for the next throttle window (~500ms).
     */
    public forceCountUpdate(): void {
        this.lastEntityCountUpdate = 0;
    }
}
