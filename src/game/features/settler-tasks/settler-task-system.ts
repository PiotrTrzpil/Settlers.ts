/**
 * SettlerTaskSystem — the settler-tasks tick system and composition root.
 *
 * Builds the feature's peers (UnitRuntimeStore, WorkerAssignments, JobOwnerRegistry,
 * JobOutcomes, MoveTaskRunner, JobRunner, JobService, WorkerAutonomy, UnitVisualSync,
 * SettlerLifecycleCoordinator, UnitRemovalHandler) and runs the per-unit tick loop that
 * dispatches each unit to them. Owns only the tick, its sub-timings and the feature-level
 * registration / debug surface.
 */

import type { GameState } from '../../game-state';
import type { TickSystem } from '../../core/tick-system';
import { EntityType, UnitType, type Entity, getEntityIfType } from '../../entity';
import { isAngelUnitType } from '../../core/unit-types';
import { createLogger } from '@/utilities/logger';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { SearchType, SettlerState, type WorkHandler, type SettlerConfig } from './types';
import { buildAllSettlerConfigs } from '../../data/settler-data-access';
import { createCarrierHandler } from './work-handlers';
import { WorkHandlerRegistry } from './work-handler-registry';
import { IdleAnimationController } from './idle-animation-controller';
import { JobChoreographyStore } from './job-choreography-store';
import { BuildingPositionResolverImpl } from './building-position-resolver';
import { registerCoreExecutors } from './choreo-executors';
import { IdleSearchCooldowns } from './idle-search-cooldowns';
import { UnitRuntimeStore, type UnitRuntime } from './unit-runtime';
import { WorkerAssignments } from './worker-assignments';
import type { JobRunner } from './job-runner';
import { WorkerAutonomy } from './worker-autonomy';
import { UnitVisualSync } from './unit-visual-sync';
import { SettlerLifecycleCoordinator } from './settler-lifecycle';
import type { SettlerTaskSystemConfig } from './settler-task-config';
import { dumpSettlerDebug, dumpWorkerAssignments, type SettlerDebugEntry } from './internal/settler-debug';
import type { JobOwnerRegistry } from './internal/job-owners';
import type { MoveTaskRunner } from './internal/move-tasks';
import type { UnitRemovalHandler } from './internal/unit-removal';
import { PendingJobResumes, resumePendingJobs, type JobResumeDeps } from './internal/job-resume';
import { createJobRuntime } from './internal/job-runtime';
import type { JobServiceImpl } from './job-service';
export type { SettlerTaskSystemConfig } from './settler-task-config';

const log = createLogger('SettlerTaskSystem');

/** Category of work performed for a unit in one tick — used for the sub-timing breakdown. */
const enum TickCategory {
    MOVE_TASK = 0,
    IDLE_SEARCH = 1,
    JOB_EXEC = 2,
    IDLE_ANIM = 3,
    COMBAT_SKIP = 4,
    /** Idle settler that skipped search (cooldown, carrier, military) */
    IDLE_SKIP = 5,
}

/** Accumulated milliseconds per TickCategory. */
type CategoryTimes = [number, number, number, number, number, number];

export class SettlerTaskSystem implements TickSystem {
    readonly runtimes: UnitRuntimeStore;
    readonly assignments: WorkerAssignments;
    readonly jobRunner: JobRunner;
    readonly jobs: JobServiceImpl;
    readonly owners: JobOwnerRegistry;
    readonly moveTasks: MoveTaskRunner;
    /** Restored owned jobs waiting for the final restore pass (filled by settler-task persistence). */
    readonly pendingResumes = new PendingJobResumes();
    /** COMMITMENTS-priority unit removal (registered with the cleanup registry by the feature). */
    readonly unitRemoval: UnitRemovalHandler;

    private readonly gameState: GameState;
    private readonly isInCombat: (entityId: number) => boolean;
    private readonly settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    private readonly choreographyStore: JobChoreographyStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly buildingPositionResolver: BuildingPositionResolverImpl;
    private readonly idleCooldowns: IdleSearchCooldowns;
    private readonly autonomy: WorkerAutonomy;
    private readonly visualSync: UnitVisualSync;
    private readonly lifecycleCoordinator: SettlerLifecycleCoordinator;
    private readonly resumeDeps: JobResumeDeps;
    private lastSubTimings: Record<string, number> = {};

    constructor(config: SettlerTaskSystemConfig) {
        this.gameState = config.gameState;
        this.isInCombat = config.isInCombat;
        this.settlerConfigs = buildAllSettlerConfigs();
        this.choreographyStore = new JobChoreographyStore();
        this.handlerRegistry = new WorkHandlerRegistry();

        const handlerErrorLogger = new ThrottledLogger(log, 2000);
        const animController = new IdleAnimationController(
            config.visualService,
            this.gameState.rng,
            this.gameState.movement
        );
        this.buildingPositionResolver = new BuildingPositionResolverImpl({
            gameState: this.gameState,
            inventoryManager: config.inventoryManager,
            workAreaStore: config.workAreaStore,
        });

        this.idleCooldowns = new IdleSearchCooldowns(config.tickScheduler);
        this.runtimes = new UnitRuntimeStore(animController, this.idleCooldowns);
        this.assignments = new WorkerAssignments(
            this.runtimes,
            config.locationManager,
            this.gameState,
            config.eventBus,
            config.territoryCheck,
            config.commitments
        );
        const jobRuntime = createJobRuntime({
            gameState: this.gameState,
            eventBus: config.eventBus,
            choreoSystem: config.choreoSystem,
            triggerSystem: config.triggerSystem,
            materialTransfer: config.materialTransfer,
            locationManager: config.locationManager,
            runtimes: this.runtimes,
            assignments: this.assignments,
            settlerConfigs: this.settlerConfigs,
            handlerRegistry: this.handlerRegistry,
            choreographyStore: this.choreographyStore,
            animController,
            idleCooldowns: this.idleCooldowns,
            handlerErrorLogger,
            commitments: config.commitments,
            commitmentWriter: config.commitmentWriter,
            pendingResumes: this.pendingResumes,
        });
        this.owners = jobRuntime.owners;
        this.moveTasks = jobRuntime.moveTasks;
        this.jobRunner = jobRuntime.jobRunner;
        this.jobs = jobRuntime.jobs;
        this.unitRemoval = jobRuntime.unitRemoval;
        this.resumeDeps = jobRuntime.resumeDeps;
        this.autonomy = new WorkerAutonomy({
            gameState: this.gameState,
            eventBus: config.eventBus,
            jobRunner: this.jobRunner,
            choreographyStore: this.choreographyStore,
            handlerRegistry: this.handlerRegistry,
            inventoryManager: config.inventoryManager,
            buildingPositionResolver: this.buildingPositionResolver,
            locationManager: config.locationManager,
            animController,
            idleCooldowns: this.idleCooldowns,
            handlerErrorLogger,
            missingHandlerLogger: new ThrottledLogger(log, 5000),
        });
        this.visualSync = new UnitVisualSync(this.gameState, config.visualService, animController);
        this.lifecycleCoordinator = new SettlerLifecycleCoordinator({
            gameState: this.gameState,
            eventBus: config.eventBus,
            tickScheduler: config.tickScheduler,
            runtimes: this.runtimes,
            outcomes: jobRuntime.outcomes,
            moveTasks: this.moveTasks,
            assignments: this.assignments,
            idleCooldowns: this.idleCooldowns,
        });

        // Domain-free executors only — domain features register their own task types.
        registerCoreExecutors(config.choreoSystem, {
            gameState: this.gameState,
            buildingPositionResolver: this.buildingPositionResolver,
            triggerSystem: config.triggerSystem,
            handlerErrorLogger,
        });

        this.lifecycleCoordinator.registerEvents();
        this.visualSync.registerEvents(config.eventBus);

        this.handlerRegistry.register(SearchType.GOOD, createCarrierHandler());

        log.debug(
            `Loaded ${this.settlerConfigs.size} settler configs, ${this.choreographyStore.cacheSize} cached jobs`
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Feature-level registration and services
    // ─────────────────────────────────────────────────────────────

    /** Domain features plug in their work handlers (production-control → WORKPLACE, trees → TREE, …). */
    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
        this.handlerRegistry.register(searchType, handler);
    }

    /** Final restore pass: build and resume the restored owned jobs (see job-resume.ts). */
    resumeRestoredJobs(): void {
        resumePendingJobs(this.resumeDeps, this.pendingResumes);
    }

    getPositionResolver(): BuildingPositionResolverImpl {
        return this.buildingPositionResolver;
    }

    getChoreographyStore(): JobChoreographyStore {
        return this.choreographyStore;
    }

    /** True for units with a settler config (choreography jobs / idle search). */
    isManaged(entityId: number): boolean {
        const entity = getEntityIfType(this.gameState, entityId, EntityType.Unit);
        if (!entity) {
            return false;
        }
        return this.settlerConfigs.has(entity.subType as UnitType);
    }

    // ─────────────────────────────────────────────────────────────
    // Debug
    // ─────────────────────────────────────────────────────────────

    /** Verbose choreography trace events (choreo:nodeStarted / nodeCompleted / animationApplied / waitingAtHome). */
    get verbose(): boolean {
        return this.jobRunner.verbose;
    }

    set verbose(value: boolean) {
        this.jobRunner.verbose = value;
    }

    getDebugInfo(): SettlerDebugEntry[] {
        return dumpSettlerDebug(this.runtimes, this.jobs.commitments);
    }

    dumpWorkerAssignments(): string {
        return dumpWorkerAssignments(this.runtimes, this.jobRunner);
    }

    getSubTimings(): Record<string, number> {
        return this.lastSubTimings;
    }

    // ─────────────────────────────────────────────────────────────
    // TickSystem
    // ─────────────────────────────────────────────────────────────

    /** Cleanup registry hook — the lifecycle coordinator releases the unit's or building's state. */
    onEntityRemoved(entityId: number): void {
        this.lifecycleCoordinator.onEntityRemoved(entityId);
    }

    destroy(): void {
        this.lifecycleCoordinator.destroy();
        this.visualSync.destroy();
        this.idleCooldowns.destroy();
    }

    tick(dt: number): void {
        const cats: CategoryTimes = [0, 0, 0, 0, 0, 0];
        this.autonomy.resetTickStats();

        const unitIds = this.gameState.entityIndex.idsOfType(EntityType.Unit);
        for (const id of unitIds) {
            const entity = this.gameState.getEntity(id);
            if (!entity) {
                continue;
            }
            if (isAngelUnitType(entity.subType as UnitType)) {
                continue;
            }

            const start = performance.now();
            try {
                const runtime = this.runtimes.getOrCreate(entity.id);
                const cat = this.updateUnit(entity, runtime, dt);
                cats[cat] += performance.now() - start;
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Unhandled error updating unit ${entity.id}`, err);
                cats[TickCategory.JOB_EXEC] += performance.now() - start;
            }
        }

        this.recordSubTimings(cats);
    }

    /** One unit's tick: move task first, then its job or idle search, else idle animation. */
    private updateUnit(unit: Entity, runtime: UnitRuntime, dt: number): TickCategory {
        if (runtime.moveTask) {
            this.visualSync.syncWithMovement(unit, runtime);
            this.moveTasks.tick(unit, runtime);
            return TickCategory.MOVE_TASK;
        }

        const config = this.settlerConfigs.get(unit.subType as UnitType);
        if (config) {
            if (runtime.state !== SettlerState.WORKING && !this.isInCombat(unit.id)) {
                this.visualSync.syncWithMovement(unit, runtime);
            }
            return this.updateSettler(unit, config, runtime, dt);
        }

        // Combat system manages the animation of units actively in combat.
        if (this.isInCombat(unit.id)) {
            return TickCategory.COMBAT_SKIP;
        }

        this.visualSync.syncWithMovement(unit, runtime);
        this.visualSync.updateIdle(unit, runtime, dt);
        return TickCategory.IDLE_ANIM;
    }

    /** State dispatch for a unit with a settler config. */
    private updateSettler(settler: Entity, config: SettlerConfig, runtime: UnitRuntime, dt: number): TickCategory {
        switch (runtime.state) {
            case SettlerState.IDLE: {
                const didSearch = this.autonomy.tickIdle(settler, config, runtime);
                // The search may have started a job; combat system manages animation of fighting units.
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- tickIdle mutates runtime.state
                if (runtime.state === SettlerState.IDLE && !this.isInCombat(settler.id)) {
                    this.visualSync.updateIdle(settler, runtime, dt);
                }
                return didSearch ? TickCategory.IDLE_SEARCH : TickCategory.IDLE_SKIP;
            }

            case SettlerState.WORKING:
                this.jobRunner.tickJob(settler, config, runtime, dt);
                // Sync direction immediately after task execution (FACE_POS sets it mid-tick, avoid one-frame lag)
                this.visualSync.syncWithMovement(settler, runtime);
                this.autonomy.afterJobTick(settler, runtime);
                return TickCategory.JOB_EXEC;

            case SettlerState.INTERRUPTED:
                // Return to idle after interruption — search immediately on next tick
                this.jobRunner.clearInterrupted(runtime);
                this.autonomy.searchImmediately(runtime);
                return TickCategory.IDLE_SKIP;
        }
    }

    private recordSubTimings(cats: Readonly<CategoryTimes>): void {
        const sub: Record<string, number> = {
            'idle-search': cats[TickCategory.IDLE_SEARCH],
            '  searches': this.autonomy.idleSearchCount,
            '  runtimes': this.runtimes.size,
            'idle-skip': cats[TickCategory.IDLE_SKIP],
            'job-exec': cats[TickCategory.JOB_EXEC],
            'move-task': cats[TickCategory.MOVE_TASK],
            'idle-anim': cats[TickCategory.IDLE_ANIM],
        };
        for (const [k, v] of Object.entries(this.autonomy.idleTimings)) {
            sub[`  ${k}`] = v;
        }
        this.lastSubTimings = sub;
    }
}
