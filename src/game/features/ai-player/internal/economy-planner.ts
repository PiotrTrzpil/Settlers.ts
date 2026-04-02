/**
 * Economy Planner — Build order execution and building placement for AI players.
 *
 * Walks a race-specific build order, placing one building per evaluation cycle.
 * Uses spiralSearch from the AI's base position to find valid placement tiles,
 * validating each candidate with canPlaceBuildingFootprint.
 */

import type { BuildingType } from '@/game/buildings/building-type';
import type { Race } from '@/game/core/race';
import type { TerrainData } from '@/game/terrain';
import type { GameState } from '@/game/game-state';
import type { CommandExecutor } from '@/game/commands/command-types';
import type { PlacementFilter } from '@/game/systems/placement/types';
import type { BuildStep } from '../types';
import { canPlaceBuildingFootprint } from '@/game/systems/placement';
import { EntityType, Tile } from '@/game/entity';
import { isNonBlockingMapObject } from '@/game/data/game-data-access';
import { spiralSearch } from '@/game/utils/spiral-search';
import { getPlayerBuildings, getPlayerBasePosition } from './ai-world-queries';

/** Maximum spiral search radius when looking for a valid building position. */
const MAX_SEARCH_RADIUS = 50;

/**
 * Minimum ticks between expensive placement searches.
 * Prevents hammering spiralSearch every single evaluation tick.
 */
const SEARCH_COOLDOWN = 30;

export class EconomyPlanner {
    private readonly state: GameState;
    private readonly terrain: TerrainData;
    private readonly executeCommand: CommandExecutor;
    private readonly getPlacementFilter: () => PlacementFilter | null;
    private readonly buildOrder: readonly BuildStep[];
    private readonly player: number;
    private readonly race: Race;

    private buildOrderIndex = 0;
    private placedForCurrentStep = 0;

    /** Cached placement result from last search. Cleared on placement or failure. */
    private cachedPosition: { x: number; y: number; buildingType: BuildingType } | null = null;
    /** Ticks remaining before next search is allowed. */
    private searchCooldown = 0;

    constructor(deps: {
        gameState: GameState;
        terrain: TerrainData;
        executeCommand: CommandExecutor;
        getPlacementFilter: () => PlacementFilter | null;
        buildOrder: readonly BuildStep[];
        player: number;
        race: Race;
    }) {
        this.state = deps.gameState;
        this.terrain = deps.terrain;
        this.executeCommand = deps.executeCommand;
        this.getPlacementFilter = deps.getPlacementFilter;
        this.buildOrder = deps.buildOrder;
        this.player = deps.player;
        this.race = deps.race;

        // Sync initial index by counting buildings already placed
        this.syncBuildOrderIndex();
    }

    // ── Public API ─────────────────────────────────────────────

    /** Whether there is a next build step and a valid position can be found for it. */
    canPlaceNext(): boolean {
        const step = this.currentStep();
        if (!step) {
            return false;
        }

        // Use cached position if it matches the current step
        if (this.cachedPosition && this.cachedPosition.buildingType === step.buildingType) {
            return true;
        }

        // Respect cooldown to avoid expensive searches every tick
        if (this.searchCooldown > 0) {
            this.searchCooldown--;
            return false;
        }

        const pos = this.findPlacementPosition(step.buildingType);
        if (pos) {
            this.cachedPosition = { ...pos, buildingType: step.buildingType };
            return true;
        }

        this.searchCooldown = SEARCH_COOLDOWN;
        return false;
    }

    /** Place the next building in the build order. Advances index when step count is satisfied. */
    placeNext(): void {
        const step = this.currentStep();
        if (!step) {
            throw new Error(`EconomyPlanner.placeNext: no remaining build steps (player ${this.player})`);
        }

        // Use cached position — canPlaceNext() must have been called first
        const pos = this.cachedPosition;
        if (!pos || pos.buildingType !== step.buildingType) {
            return;
        }

        this.cachedPosition = null;

        const result = this.executeCommand({
            type: 'place_building',
            buildingType: step.buildingType,
            x: pos.x,
            y: pos.y,
            player: this.player,
            race: this.race,
        });

        if (!result.success) {
            return;
        }

        this.placedForCurrentStep++;
        if (this.placedForCurrentStep >= step.count) {
            this.buildOrderIndex++;
            this.placedForCurrentStep = 0;
        }
    }

    /** Current position in the build order array. */
    getBuildOrderIndex(): number {
        return this.buildOrderIndex;
    }

    /** Total number of buildings placed across all steps so far. */
    getBuildingsPlaced(): number {
        let total = 0;
        for (let i = 0; i < this.buildOrderIndex; i++) {
            total += this.buildOrder[i]!.count;
        }
        total += this.placedForCurrentStep;
        return total;
    }

    // ── Internals ────────────────────────────────────────────────

    /** Get the current build step, or undefined if the build order is complete. */
    private currentStep(): BuildStep | undefined {
        return this.buildOrder[this.buildOrderIndex];
    }

    /**
     * Spiral-search outward from the base to find a valid placement position
     * for the given building type.
     */
    private findPlacementPosition(buildingType: BuildingType): Tile | null {
        const basePos = getPlayerBasePosition(this.state, this.player);
        const filter = this.getPlacementFilter();
        const replaceCheck = (id: number) => {
            const e = this.state.getEntity(id);
            return e?.type === EntityType.MapObject && isNonBlockingMapObject(e.subType as number);
        };
        return spiralSearch(
            basePos.x,
            basePos.y,
            this.terrain.width,
            this.terrain.height,
            (x, y) =>
                canPlaceBuildingFootprint(
                    this.terrain,
                    this.state.groundOccupancy,
                    x,
                    y,
                    buildingType,
                    this.race,
                    this.state.buildingFootprint,
                    filter,
                    this.player,
                    replaceCheck
                ),
            MAX_SEARCH_RADIUS
        );
    }

    /**
     * Synchronize the build order index with already-placed buildings.
     * Counts existing buildings of each step's type and advances past
     * steps that are already satisfied.
     */
    private syncBuildOrderIndex(): void {
        this.buildOrderIndex = 0;
        this.placedForCurrentStep = 0;

        while (this.buildOrderIndex < this.buildOrder.length) {
            const step = this.buildOrder[this.buildOrderIndex]!;
            const existing = getPlayerBuildings(this.state, this.player, step.buildingType).length;

            // Count how many of this building type were required by earlier
            // steps (the same building type can appear multiple times in the
            // build order).
            let requiredBefore = 0;
            for (let i = 0; i < this.buildOrderIndex; i++) {
                if (this.buildOrder[i]!.buildingType === step.buildingType) {
                    requiredBefore += this.buildOrder[i]!.count;
                }
            }

            const availableForStep = existing - requiredBefore;
            if (availableForStep >= step.count) {
                this.buildOrderIndex++;
            } else {
                this.placedForCurrentStep = Math.max(0, availableForStep);
                break;
            }
        }
    }
}
