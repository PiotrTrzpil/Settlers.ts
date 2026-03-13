/**
 * Game event payload types — shared type definitions for the EventBus.
 *
 * Extracted from event-bus.ts to keep event type definitions separate from
 * the EventBus class implementation. Features import these types for
 * their event handler signatures.
 */

import type { BuildingType } from './buildings/types';
import type { Race } from './core/race';
import type { UnitType } from './core/unit-types';
import type { EntityType } from './entity';
import type { EMaterialType } from './economy';
import type { GameEventsFeatures } from './event-types-features';

// ─────────────────────────────────────────────────────────────
// Shared payload types — defined here so event-bus has no feature imports.
// Features re-export these from event-bus rather than defining their own.
// ─────────────────────────────────────────────────────────────

/** Single barracks training recipe — inputs consumed to produce one soldier. */
export interface TrainingRecipe {
    /** Materials consumed per training cycle. */
    inputs: readonly { material: EMaterialType; count: number }[];
    /** Base soldier type produced (e.g. Swordsman, not Swordsman2). */
    unitType: UnitType;
    /** Soldier level (1, 2, or 3). */
    soldierLevel: number;
}

/** Controls how the next recipe is selected for a multi-recipe building. */
export enum ProductionMode {
    Even = 'even',
    Proportional = 'proportional',
    Manual = 'manual',
}

/**
 * Common optional fields for timeline extraction.
 * Events that carry entity/player/position data should extend this.
 */
/** Timeline log level — controls filtering in `pnpm timeline --level`. */
export type GameEventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface GameEventBase {
    player?: number;
    x?: number;
    y?: number;
    /** Optional severity level for timeline filtering. Defaults to 'debug' when omitted. */
    level?: GameEventLevel;
    /**
     * Generic entity ID — only for events where the primary entity is NOT a unit or building
     * (e.g. tree, crop, stone, pile). Unit events use `unitId`, building events use `buildingId`.
     */
    entityId?: number;
    /** Entity type tag for timeline enrichment (e.g. EntityType.Tree, EntityType.StackedPile). */
    entityType?: EntityType;
    /** Optional unit type for timeline enrichment. */
    unitType?: UnitType;
    /** Optional building type for timeline enrichment. */
    buildingType?: number;
}

/** Core event map — building, unit, terrain, movement, carrier, logistics, inventory, production events. */
export interface GameEventsCore {
    /** Emitted when a building is successfully placed (construction begins) */
    'building:placed': GameEventBase & {
        buildingId: number;
        buildingType: BuildingType;
        x: number;
        y: number;
        player: number;
    };
    /** Emitted when building construction completes */
    'building:completed': {
        buildingId: number;
        buildingType: BuildingType;
        race: Race;
        /** True when the building was placed as instantly completed (no construction). */
        placedCompleted?: boolean;
        /** True when the building should auto-spawn its dedicated worker. */
        spawnWorker?: boolean;
    };
    /** Emitted when a building is removed/cancelled */
    'building:removed': {
        buildingId: number;
        buildingType: BuildingType;
    };
    /** Emitted when a unit is spawned */
    'unit:spawned': GameEventBase & {
        unitId: number;
        unitType: UnitType;
        x: number;
        y: number;
        player: number;
    };
    /** Emitted when terrain is modified (e.g., during building construction leveling) */
    'terrain:modified': {
        reason: 'leveling' | 'restore' | 'placement' | 'snapshot';
        /** Tile coordinates (absent for bulk operations like snapshot restore). */
        x?: number;
        y?: number;
    };

    // === Movement Events ===

    /**
     * Emitted when a unit stops moving (becomes idle).
     * Used by CarrierSystem for arrival detection.
     * Note: movementStarted and directionChanged were removed - animation
     * is now handled by SettlerTaskSystem directly, not via events.
     */
    'unit:movementStopped': {
        unitId: number;
        direction: number;
    };

    // === Verbose Movement Events (gated by MovementSystem.verbose) ===

    /** A path was requested and found */
    'movement:pathFound': {
        unitId: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
        pathLength: number;
        redirect: boolean;
    };

    /** A path was requested but no route exists */
    'movement:pathFailed': GameEventBase & {
        unitId: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
        level: 'warn';
        /** Whether start tile terrain is passable */
        startPassable: boolean;
        /** Whether goal tile terrain is passable */
        goalPassable: boolean;
        /** Whether start tile is in building occupancy */
        startInBuilding: boolean;
        /** Whether goal tile is in building occupancy */
        goalInBuilding: boolean;
        /** Number of A* nodes searched before failure */
        nodesSearched: number;
        /** Whether the search hit the max node limit */
        exhausted: boolean;
        /** Neighbor diagnostic string (only when nodesSearched <= 1) */
        neighborInfo: string;
    };

    /** Unit stepped onto a new tile */
    'movement:step': GameEventBase & {
        unitId: number;
        x: number;
        y: number;
        pathIdx: number;
        pathLen: number;
    };

    /** Unit's next waypoint is blocked — waiting this tick */
    'movement:blocked': GameEventBase & {
        unitId: number;
        x: number;
        y: number;
        blockerId: number;
        isBuilding: boolean;
    };

    /** Blocked unit escalated (repath or gave up) */
    'movement:escalation': {
        unitId: number;
        result: 'repath' | 'gave_up';
    };

    /** Bump attempt started */
    'movement:bumpAttempt': {
        unitId: number;
        occupantId: number;
        hasController: boolean;
        occupantState?: string;
        occupantBusy?: boolean;
    };

    /** Bump attempt failed — includes reason */
    'movement:bumpFailed': {
        unitId: number;
        occupantId: number;
        reason: string;
        occupantState?: string;
        occupantBusy?: boolean;
        occupantPos?: string;
    };

    /** Unit bumped an occupant to a neighboring tile */
    'movement:bump': {
        unitId: number;
        occupantId: number;
        fromX: number;
        fromY: number;
        toX: number;
        toY: number;
    };

    /** Visual position jumped discontinuously — likely a bug */
    'movement:teleport': GameEventBase & {
        unitId: number;
        distance: number;
        state: string;
        prevState: string;
        level: 'warn';
    };

    // === Carrier Events ===

    /** Emitted when a carrier arrives at a building for pickup */
    'carrier:arrivedForPickup': {
        unitId: number;
        buildingId: number;
    };

    /** Emitted when a carrier arrives at a building for delivery */
    'carrier:arrivedForDelivery': {
        unitId: number;
        buildingId: number;
    };

    /** Emitted when a carrier completes a pickup (material transferred) */
    'carrier:pickupComplete': {
        unitId: number;
        fromBuilding: number;
        material: EMaterialType;
        amount: number;
    };

    /** Emitted when a carrier pickup fails (material not available) */
    'carrier:pickupFailed': {
        unitId: number;
        fromBuilding: number;
        material: EMaterialType;
        /** Amount that was requested but not available */
        requestedAmount: number;
    };

    /** Emitted when a carrier completes a delivery (material transferred) */
    'carrier:deliveryComplete': {
        unitId: number;
        toBuilding: number;
        material: EMaterialType;
        amount: number;
        /** Amount that couldn't be delivered (destination full) */
        overflow: number;
    };

    /** Emitted when a carrier is successfully assigned to a transport job */
    'carrier:assigned': {
        requestId: number;
        unitId: number;
        sourceBuilding: number;
        destBuilding: number;
        material: EMaterialType;
    };

    /** Emitted when a transport job is cancelled (from any path — task interruption, carrier removal, etc.) */
    'carrier:transportCancelled': {
        unitId: number;
        requestId: number;
        reason: string;
    };

    /** Emitted when carrier assignment fails (reservation failed or movement failed) */
    'carrier:assignmentFailed': {
        requestId: number;
        reason: 'reservation_failed' | 'movement_failed';
        sourceBuilding: number;
        destBuilding: number;
        material: EMaterialType;
        unitId?: number;
    };

    /**
     * Emitted (throttled) when no idle carrier is available for a pending request.
     * Deduplicated per (building, material) — fires at most once per ~5 seconds.
     */
    'logistics:noCarrier': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
        sourceBuilding: number;
    };

    // === Logistics Events ===

    /** Emitted when no supply source is found for a pending request */
    'logistics:noMatch': {
        requestId: number;
        buildingId: number;
        materialType: EMaterialType;
    };

    /** Emitted when logistics cleanup completes after a building is destroyed */
    'logistics:buildingCleanedUp': {
        buildingId: number;
        requestsCancelled: number;
        jobsCancelled: number;
    };

    /** Emitted when a new demand is added to the queue */
    'logistics:demandCreated': {
        demandId: number;
        buildingId: number;
        materialType: EMaterialType;
        amount: number;
        priority: number;
    };

    /** Emitted when a demand is consumed (job created for it) */
    'logistics:demandConsumed': {
        demandId: number;
        buildingId: number;
        materialType: EMaterialType;
    };

    /** Emitted when a transport job fulfills delivery */
    'logistics:demandFulfilled': {
        demandId: number;
        buildingId: number;
        materialType: EMaterialType;
    };

    // === Inventory Events ===

    /** Emitted when a building's inventory changes */
    'inventory:changed': {
        buildingId: number;
        materialType: EMaterialType;
        slotType: 'input' | 'output';
        previousAmount: number;
        newAmount: number;
    };

    /** Emitted when a StorageArea's direction setting changes */
    'storage:directionChanged': {
        buildingId: number;
        materialType: EMaterialType;
    };

    // === Production Control Events ===

    /** Emitted when a building's production mode changes */
    'production:modeChanged': {
        buildingId: number;
        mode: ProductionMode;
    };
}

/** Combined game events — core + feature-specific events. */
export type GameEvents = GameEventsCore & GameEventsFeatures;

export type { GameEventsFeatures } from './event-types-features';
