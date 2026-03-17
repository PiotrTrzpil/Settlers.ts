/**
 * Feature-specific game event payload types — construction, training, recruitment,
 * settler location, garrison, siege, worker assignment, and victory events.
 *
 * Split from event-types.ts to keep files under the line limit.
 * Merged back into GameEvents via intersection in event-types.ts.
 */

import type { BuildingType } from './buildings/types';
import type { Race } from './core/race';
import type { UnitType } from './core/unit-types';
import type { EMaterialType } from './economy';
import type { MapObjectType } from './types/map-object-types';
import type { EntityType } from './entity';
import type { GameEventBase, TrainingRecipe } from './event-types';

/** Feature-specific events — merged into GameEvents via intersection. */
export interface GameEventsFeatures {
    // === Tree Events ===

    /** Emitted when a tree is planted by a forester */
    'tree:planted': GameEventBase & {
        entityId: number;
        treeType: MapObjectType;
        x: number;
        y: number;
    };

    /** Emitted when a tree finishes growing and becomes a full tree */
    'tree:matured': {
        entityId: number;
    };

    /** Emitted when a tree is fully cut down */
    'tree:cut': {
        entityId: number;
    };

    // === Crop Events ===

    /** Emitted when a crop is planted by a farmer */
    'crop:planted': GameEventBase & {
        entityId: number;
        cropType: MapObjectType;
        x: number;
        y: number;
    };

    /** Emitted when a crop finishes growing and becomes ready for harvest */
    'crop:matured': {
        entityId: number;
        cropType: MapObjectType;
    };

    /** Emitted when a crop is fully harvested */
    'crop:harvested': {
        entityId: number;
        cropType: MapObjectType;
    };

    // === Combat Events ===

    /** Emitted when a unit takes damage from combat */
    'combat:unitAttacked': GameEventBase & {
        unitId: number;
        targetId: number;
        damage: number;
        remainingHealth: number;
    };

    /** Emitted when a unit is killed in combat */
    'combat:unitDefeated': GameEventBase & {
        unitId: number;
        defeatedBy: number;
    };

    // === Entity Lifecycle Events ===

    /**
     * Emitted when any entity is added to the game.
     * Systems subscribe to handle type-specific initialization
     * (e.g., MovementSystem creates controllers for units).
     */
    'entity:created': GameEventBase & {
        entityId: number;
        entityType: EntityType;
        subType: number | string;
        x: number;
        y: number;
        player: number;
        /** Initial visual variation (sprite offset from map data). 0 for most entities. */
        variation: number;
    };

    /**
     * Emitted when any entity is removed from the game.
     * Systems should subscribe to clean up per-entity state.
     */
    'entity:removed': {
        entityId: number;
    };

    // === Pile Events ===

    /** Emitted after a free pile entity is fully created (kind + quantity set). */
    'pile:freePilePlaced': {
        entityId: number;
        materialType: EMaterialType;
        quantity: number;
    };

    // === Construction Events ===

    /** Emitted when the first digger starts working on a construction site */
    'construction:diggingStarted': {
        buildingId: number;
    };
    /** Emitted when a single tile's terrain is leveled during construction */
    'construction:tileCompleted': GameEventBase & {
        buildingId: number;
        x: number;
        y: number;
        targetHeight: number;
        isFootprint: boolean;
    };
    /** Emitted when terrain leveling is complete for a construction site */
    'construction:levelingComplete': {
        buildingId: number;
    };
    /** Emitted when the first builder starts constructing */
    'construction:buildingStarted': {
        buildingId: number;
    };
    /** Emitted when a material is delivered to a construction site inventory */
    'construction:materialDelivered': {
        buildingId: number;
        material: EMaterialType;
    };
    /** Emitted when delivered material overflows (destination full) — used to keep delivery count in sync */
    'construction:materialOverflowed': {
        buildingId: number;
        material: EMaterialType;
        amount: number;
    };
    /** Emitted when construction progress reaches 1.0 */
    'construction:progressComplete': {
        buildingId: number;
    };
    /** Emitted when a digger or builder claims a slot on a construction site. */
    'construction:workerAssigned': GameEventBase & {
        buildingId: number;
        unitId: number;
        role: 'digger' | 'builder';
    };
    /** Emitted when a digger or builder releases their slot (finished or interrupted). */
    'construction:workerReleased': GameEventBase & {
        buildingId: number;
        unitId: number;
        role: 'digger' | 'builder';
    };
    /**
     * Emitted by ConstructionSiteManager when a site needs a worker it doesn't have.
     * RecruitSystem subscribes to this instead of polling ConstructionSiteManager.
     */
    'construction:workerNeeded': GameEventBase & {
        role: 'digger' | 'builder';
        buildingId: number;
        x: number;
        y: number;
        player: number;
    };

    // === Settler Task Events ===

    // --- Verbose Choreography Events (gated by WorkerTaskExecutor.verbose) ---

    /** A choreography node started executing */
    'choreo:nodeStarted': {
        unitId: number;
        jobId: string;
        nodeIndex: number;
        /** Total number of nodes in the job */
        nodeCount: number;
        /** ChoreoTaskType name (e.g. GO_TO_TARGET, WORK_ON_ENTITY) */
        task: string;
        /** Animation jobPart key (empty string if none) */
        jobPart: string;
        /** Duration in frames (0 for open-ended nodes like movement) */
        duration: number;
    };

    /** A choreography node completed and advanced to the next */
    'choreo:nodeCompleted': {
        unitId: number;
        jobId: string;
        nodeIndex: number;
        task: string;
    };

    /** Animation was resolved and applied to a settler */
    'choreo:animationApplied': {
        unitId: number;
        jobPart: string;
        sequenceKey: string;
        loop: boolean;
    };

    /** Settler returned home to wait (output full, input unavailable, or first visit) */
    'choreo:waitingAtHome': {
        unitId: number;
        homeBuilding: number;
        reason: 'output_full' | 'cant_work' | 'first_visit';
    };

    /** Emitted when a settler starts a choreography job (walking to target, gathering, etc.) */
    'settler:taskStarted': GameEventBase & {
        unitId: number;
        jobId: string;
        targetId: number | null;
        targetPos: { x: number; y: number } | null;
        homeBuilding: number | null;
    };

    /** Emitted when a settler completes a choreography job and returns to idle. */
    'settler:taskCompleted': GameEventBase & {
        unitId: number;
        jobId: string;
    };

    /** Emitted when a settler's job is interrupted (target lost, pathfinding failure, etc.) */
    'settler:taskFailed': GameEventBase & {
        unitId: number;
        jobId: string;
        /** Index of the choreography node that was executing when the failure occurred. */
        nodeIndex: number;
        /** The choreography step type that failed (e.g. GO_TO_TARGET, WORK_ON_ENTITY). */
        failedStep: string;
        /** Entity target of the job, if any. */
        targetId: number | null;
        /** Whether work had actually started before the interruption. */
        workStarted: boolean;
        /** Whether the unit was carrying material that was lost. */
        wasCarrying: boolean;
    };

    // === Barracks Training Events ===

    /** Emitted when a barracks begins a training cycle (inputs consumed, carrier recruited). */
    'barracks:trainingStarted': GameEventBase & {
        buildingId: number;
        recipe: TrainingRecipe;
        unitId: number;
    };

    /** Emitted when a barracks completes training — soldier spawned */
    'barracks:trainingCompleted': GameEventBase & {
        buildingId: number;
        unitType: UnitType;
        soldierLevel: number;
        unitId: number;
    };

    /** Emitted when a training cycle is interrupted (e.g. carrier killed en route). */
    'barracks:trainingInterrupted': {
        buildingId: number;
        reason: 'carrier_killed';
    };

    // === Auto-Recruit Events ===

    /** Emitted when a carrier is dispatched to pick up a tool for recruitment. */
    'recruitment:started': GameEventBase & {
        unitId: number;
        targetUnitType: UnitType;
        pileEntityId: number;
        buildingId: number;
    };

    /** Emitted when a carrier completes tool pickup and is ready for transformation. */
    'recruitment:completed': GameEventBase & {
        unitId: number;
        targetUnitType: UnitType;
    };

    /** Emitted when a recruitment fails (pile gone, path blocked, etc.). */
    'recruitment:failed': GameEventBase & {
        unitId: number;
        reason: string;
    };

    /** Emitted when a carrier is transformed into a different unit type. */
    'unit:transformed': GameEventBase & {
        unitId: number;
        fromType: UnitType;
        toType: UnitType;
    };

    // === Settler Location Events ===

    /**
     * Emitted when a building is destroyed while a settler is approaching it with
     * intent to enter. Features identify whether the settler is theirs via their own
     * data structures (garrison via UnitReservationRegistry, settler-tasks via runtimes map).
     */
    'settler-location:approachInterrupted': GameEventBase & {
        unitId: number;
        buildingId: number;
    };

    /** Emitted when a settler enters a building (transitions to Inside). */
    'settler-location:entered': GameEventBase & {
        unitId: number;
        buildingId: number;
    };

    // === Garrison Events ===

    /** Emitted when a unit enters a tower garrison (becomes hidden). */
    'garrison:unitEntered': GameEventBase & {
        buildingId: number;
        unitId: number;
        unitType: UnitType;
    };

    /** Emitted when a unit is ejected from a tower garrison (becomes visible at door). */
    'garrison:unitExited': GameEventBase & {
        buildingId: number;
        unitId: number;
        unitType: UnitType;
    };

    /** Emitted when a garrisoned bowman fires at an enemy. */
    'garrison:bowmanFired': GameEventBase & {
        buildingId: number;
        unitId: number;
        targetId: number;
        damage: number;
    };

    // === Worker Assignment Events ===

    /** Emitted when a building spawns its dedicated worker at the door. */
    'building:workerSpawned': GameEventBase & {
        buildingId: number;
        unitId: number;
    };

    /** Emitted when a building's worker is lost (died, reassigned by player move command).
     *  NOT emitted when the building itself is destroyed. */
    'building:workerLost': GameEventBase & {
        buildingId: number;
        buildingType: BuildingType;
        unitId: number;
        player: number;
        race: Race;
    };

    // === Siege Events ===

    /** Emitted when a siege begins on a garrison building. */
    'siege:started': {
        buildingId: number;
        attackerPlayer: number;
    };

    /** Emitted when a defender is ejected from a besieged building to fight. */
    'siege:defenderEjected': GameEventBase & {
        buildingId: number;
        unitId: number;
    };

    /** Emitted when an attacker captures an enemy building (all defenders dead). */
    'siege:buildingCaptured': {
        buildingId: number;
        oldPlayer: number;
        newPlayer: number;
    };

    /** Emitted when a building changes ownership (e.g. via siege capture). */
    'building:ownerChanged': {
        buildingId: number;
        buildingType: BuildingType;
        oldPlayer: number;
        newPlayer: number;
    };

    // === Victory Condition Events ===

    /** Emitted when a player is eliminated (last castle destroyed). */
    'game:playerEliminated': GameEventBase & {
        player: number;
    };

    /** Emitted when the game ends (win or loss). */
    'game:ended': {
        /** Winning player index, or null if local player lost. */
        winner: number | null;
        reason: string;
    };

    /** Emitted after game state is restored from a snapshot (reset). */
    'game:stateRestored': Record<string, never>;
}
