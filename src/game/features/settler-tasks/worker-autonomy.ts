/**
 * WorkerAutonomy — what an idle unit decides to do by itself.
 *
 * Idle work search: looks up the unit's work handlers, finds an entity / position
 * target, selects a choreography job (JobSelector) and asks JobRunner to start it.
 * Waits at home instead when the workplace output is full or the target cannot be
 * worked, walks a new worker to its workplace first (first visit), and paces searches
 * through IdleSearchCooldowns (retry cooldown, post-job rest).
 */

import type { Entity, Tile, TileWithEntity } from '../../entity';
import { UnitType, BuildingType } from '../../entity';
import type { ThrottledLogger } from '@/utilities/throttled-logger';
import { hexDistance } from '../../systems/hex-directions';
import { getBuildingDoorPos, getWorkerBuildingTypes } from '../../data/game-data-access';
import type { GameState } from '../../game-state';
import type { EventBus } from '../../event-bus';
import type { BuildingInventoryManager } from '../inventory';
import type { ISettlerBuildingLocationManager } from '../settler-location';
import {
    SearchType,
    SettlerState,
    type SettlerConfig,
    type EntityWorkHandler,
    type PositionWorkHandler,
} from './types';
import { resolveSearchArea, type ChoreoJob, type BuildingPositionResolver } from './choreo-types';
import type { JobChoreographyStore } from './job-choreography-store';
import type { WorkHandlerRegistry } from './work-handler-registry';
import type { IdleAnimationController } from './idle-animation-controller';
import type { UnitRuntime } from './unit-runtime';
import type { JobRunner } from './job-runner';
import { JobSelector } from './job-selector';
import { IDLE_SEARCH_COOLDOWN, POST_JOB_REST_TICKS, type IdleSearchCooldowns } from './idle-search-cooldowns';
import { isWorkplaceOutputFull } from './internal/workplace-output';
import { safeCall } from './safe-call';

type WaitReason = 'output_full' | 'cant_work' | 'first_visit';

interface SearchTargets {
    entity: TileWithEntity | null;
    position: Tile | null;
}

export interface WorkerAutonomyConfig {
    gameState: GameState;
    eventBus: EventBus;
    jobRunner: JobRunner;
    choreographyStore: JobChoreographyStore;
    handlerRegistry: WorkHandlerRegistry;
    inventoryManager: BuildingInventoryManager;
    buildingPositionResolver: BuildingPositionResolver;
    locationManager: ISettlerBuildingLocationManager;
    animController: IdleAnimationController;
    idleCooldowns: IdleSearchCooldowns;
    handlerErrorLogger: ThrottledLogger;
    missingHandlerLogger: ThrottledLogger;
}

export class WorkerAutonomy {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly jobRunner: JobRunner;
    private readonly jobSelector: JobSelector;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly buildingPositionResolver: BuildingPositionResolver;
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly animController: IdleAnimationController;
    private readonly idleCooldowns: IdleSearchCooldowns;
    private readonly handlerErrorLogger: ThrottledLogger;
    private readonly missingHandlerLogger: ThrottledLogger;

    /** Accumulated idle-search sub-timings for the current tick (reset by resetTickStats). */
    readonly idleTimings: Record<string, number> = { selectJob: 0, canWork: 0, startJob: 0 };
    /** Number of idle searches performed in the current tick. */
    idleSearchCount = 0;

    constructor(cfg: WorkerAutonomyConfig) {
        this.gameState = cfg.gameState;
        this.eventBus = cfg.eventBus;
        this.jobRunner = cfg.jobRunner;
        this.jobSelector = new JobSelector(cfg.choreographyStore);
        this.handlerRegistry = cfg.handlerRegistry;
        this.inventoryManager = cfg.inventoryManager;
        this.buildingPositionResolver = cfg.buildingPositionResolver;
        this.locationManager = cfg.locationManager;
        this.animController = cfg.animController;
        this.idleCooldowns = cfg.idleCooldowns;
        this.handlerErrorLogger = cfg.handlerErrorLogger;
        this.missingHandlerLogger = cfg.missingHandlerLogger;
    }

    /** Zero the per-tick idle-search statistics (keys are kept so sub-timings stay stable). */
    resetTickStats(): void {
        for (const k of Object.keys(this.idleTimings)) {
            this.idleTimings[k] = 0;
        }
        this.idleSearchCount = 0;
    }

    /**
     * Idle unit tick: search for work when the unit searches autonomously and its cooldown
     * has elapsed; on failure, retry after IDLE_SEARCH_COOLDOWN.
     * @returns true if a search was performed.
     */
    tickIdle(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): boolean {
        // Dispatch-only units (military) and carriers skip idle work search.
        if (config.search === SearchType.GOOD || config.search === SearchType.NONE) {
            return false;
        }
        if (!runtime.idleSearchReady) {
            return false;
        }
        const found = this.searchForWork(settler, config, runtime);
        if (!found) {
            this.idleCooldowns.start(settler.id, runtime, IDLE_SEARCH_COOLDOWN);
        }
        return true;
    }

    /**
     * Pace the next search after a job tick ended the job.
     * Interrupted → search immediately to recover. Completed → brief rest for home-building
     * workers (matches S4 pacing); roaming workers (diggers, builders) work continuously.
     */
    afterJobTick(settler: Entity, runtime: UnitRuntime): void {
        if (runtime.state === SettlerState.WORKING) {
            return;
        }
        if (runtime.state === SettlerState.IDLE && runtime.homeAssignment) {
            this.idleCooldowns.start(settler.id, runtime, POST_JOB_REST_TICKS);
        } else {
            runtime.idleSearchReady = true;
        }
    }

    /** A unit recovering from an interrupted job searches on its next idle tick. */
    searchImmediately(runtime: UnitRuntime): void {
        runtime.idleSearchReady = true;
    }

    // ─────────────────────────────────────────────────────────────
    // Work search
    // ─────────────────────────────────────────────────────────────

    /** Find a target and start a job. Returns true if a job was started. */
    private searchForWork(settler: Entity, config: SettlerConfig, runtime: UnitRuntime): boolean {
        this.idleSearchCount++;
        const entityHandler = this.handlerRegistry.getEntityHandler(config.search);
        // Position handler may be registered under a separate plantSearch type (e.g. GRAIN_SEED_POS)
        const positionHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);

        if (!entityHandler && !positionHandler) {
            if (!this.handlerRegistry.hasAnyHandler(config.search)) {
                // Genuinely missing handler — feature not yet implemented
                this.missingHandlerLogger.warn(
                    `No work handler registered for search type: ${config.search}. ` +
                        `Settler ${settler.id} (${settler.subType as UnitType}) will stay idle until feature is implemented.`
                );
            }
            // NullWorkHandler (carrier, builder) or missing handler — settler stays idle, no warning
            return false;
        }

        // Resolve home building from existing assignment (push-based — no scanning)
        const homeBuilding = runtime.homeAssignment
            ? // eslint-disable-next-line no-restricted-syntax -- value is nullable by API contract; null coercion
              (this.gameState.getEntity(runtime.homeAssignment.buildingId) ?? null)
            : null;

        // WORKPLACE settlers without an assignment skip work search — assignment comes from push only
        if (!homeBuilding && getWorkerBuildingTypes(settler.race, settler.subType as UnitType)) {
            return false;
        }

        // A worker inside its building still searches; startJob() exits the building when work is
        // found, otherwise it stays inside (returnHomeAndWait is a no-op when already inside).
        if (homeBuilding && !this.ensureFirstVisit(settler, runtime, homeBuilding)) {
            return false;
        }

        let t0 = performance.now();
        const targets = this.findTargets(settler, entityHandler, positionHandler, homeBuilding);
        this.addTiming(`find:${config.search}`, performance.now() - t0);
        if (!targets) {
            return false; // error already logged
        }

        t0 = performance.now();
        const selected = this.jobSelector.selectJob(settler, config, targets.entity, homeBuilding, targets.position);
        this.addTiming('selectJob', performance.now() - t0);
        if (!selected) {
            return false;
        }

        t0 = performance.now();
        const shouldWait = this.shouldWaitBeforeStarting(
            settler,
            homeBuilding,
            selected,
            entityHandler,
            targets.entity
        );
        this.addTiming('canWork', performance.now() - t0);
        if (shouldWait) {
            return false;
        }

        t0 = performance.now();
        this.jobRunner.startJob(settler, runtime, selected, targets.entity, homeBuilding, targets.position);
        this.addTiming('startJob', performance.now() - t0);
        return true;
    }

    /** Accumulate elapsed time into the named idle timing bucket. */
    private addTiming(key: string, elapsed: number): void {
        // eslint-disable-next-line no-restricted-syntax -- idleTimings is an index-typed object; absent key means 0 elapsed so far
        this.idleTimings[key] = (this.idleTimings[key] ?? 0) + elapsed;
    }

    /** Ensure a worker has visited their home building. Returns true if ready to work. */
    private ensureFirstVisit(settler: Entity, runtime: UnitRuntime, home: Entity): boolean {
        if (runtime.homeAssignment!.hasVisited) {
            return true;
        }
        if (this.locationManager.isInside(settler.id, home.id)) {
            runtime.homeAssignment!.hasVisited = true;
            return true;
        }
        this.returnHomeAndWait(settler, home, 'first_visit');
        return false;
    }

    /** Find entity and position targets for a settler. Returns null if a handler errored. */
    private findTargets(
        settler: Entity,
        entityHandler: EntityWorkHandler | undefined,
        positionHandler: PositionWorkHandler | undefined,
        homeBuilding: Entity | null
    ): SearchTargets | null {
        const entity = entityHandler ? this.findEntityTarget(entityHandler, settler, homeBuilding) : null;
        if (entity === undefined) {
            return null;
        }

        const position =
            !entity && positionHandler ? this.findPositionTarget(positionHandler, settler, homeBuilding) : null;
        if (position === undefined) {
            return null;
        }

        return { entity, position };
    }

    /** Entity handler target; undefined when the handler threw (logged at this boundary). */
    private findEntityTarget(
        handler: EntityWorkHandler,
        settler: Entity,
        homeBuilding: Entity | null
    ): TileWithEntity | null | undefined {
        const area = resolveSearchArea(settler, homeBuilding ? homeBuilding.id : null, this.buildingPositionResolver);
        return safeCall(
            () => handler.findTarget(area, settler.id, settler.player),
            this.handlerErrorLogger,
            `findTarget failed for settler ${settler.id}`
        );
    }

    /** Position handler target (plant/seed jobs); undefined when the handler threw. */
    private findPositionTarget(
        handler: PositionWorkHandler,
        settler: Entity,
        homeBuilding: Entity | null
    ): Tile | null | undefined {
        const area = resolveSearchArea(settler, homeBuilding ? homeBuilding.id : null, this.buildingPositionResolver);
        return safeCall(
            () => handler.findPosition(area, settler.id),
            this.handlerErrorLogger,
            `findPosition failed for settler ${settler.id}`
        );
    }

    /** Check if the settler should wait (output full or input unavailable) instead of starting. */
    private shouldWaitBeforeStarting(
        settler: Entity,
        homeBuilding: Entity | null,
        job: ChoreoJob,
        entityHandler: EntityWorkHandler | undefined,
        entityTarget: TileWithEntity | null
    ): boolean {
        if (homeBuilding && isWorkplaceOutputFull(this.inventoryManager, homeBuilding, job)) {
            this.returnHomeAndWait(settler, homeBuilding, 'output_full');
            return true;
        }
        if (entityHandler?.canWork && entityTarget && !entityHandler.canWork(entityTarget.entityId)) {
            if (homeBuilding) {
                this.returnHomeAndWait(settler, homeBuilding, 'cant_work');
            }
            return true;
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────────
    // Waiting at home
    // ─────────────────────────────────────────────────────────────

    /** Walk to the workplace door (or step inside when already there) and wait for work. */
    private returnHomeAndWait(settler: Entity, homeBuilding: Entity, reason: WaitReason): void {
        // Settler is already inside their building — nothing to do.
        // This can happen when enterBuilding() removed the movement controller
        // but the settler hasn't marked hasVisited yet on the next idle tick.
        if (this.locationManager.isInside(settler.id)) {
            return;
        }

        const controller = this.gameState.movement.getController(settler.id);
        if (!controller) {
            this.handlerErrorLogger.error(
                `Settler ${settler.id} has no movement controller in returnHomeAndWait`,
                new Error(`Settler ${settler.id} has no movement controller`)
            );
            return;
        }

        const door = getBuildingDoorPos(homeBuilding, homeBuilding.race, homeBuilding.subType as BuildingType);
        const dist = hexDistance(settler.x, settler.y, door.x, door.y);

        if (dist <= 1) {
            this.emitWaitingAtHome(settler, homeBuilding, reason);
            this.locationManager.enterBuilding(settler.id, homeBuilding.id);
            this.animController.setIdleAnimation(settler);
            return;
        }

        if (controller.state === 'idle') {
            this.emitWaitingAtHome(settler, homeBuilding, reason);
            this.gameState.movement.moveUnit(settler.id, door);
        }
    }

    /** Verbose trace only (gated by JobRunner.verbose). */
    private emitWaitingAtHome(settler: Entity, home: Entity, reason: WaitReason): void {
        if (!this.jobRunner.verbose) {
            return;
        }
        this.eventBus.emit('choreo:waitingAtHome', {
            unitId: settler.id,
            homeBuilding: home.id,
            reason,
        });
    }
}
