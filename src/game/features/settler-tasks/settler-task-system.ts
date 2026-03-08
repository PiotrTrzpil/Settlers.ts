/**
 * Settler Task System - manages ALL unit behaviors via tasks.
 *
 * Coordinator that wires together sub-systems:
 * - WorkHandlerRegistry: domain handler registration and lookup
 * - UnitStateMachine: per-unit IDLE/WORKING/INTERRUPTED state transitions
 * - WorkerTaskExecutor: choreography-driven job execution (XML-defined)
 * - IdleAnimationController: idle turning and animation helpers
 *
 * Domain systems (WoodcuttingSystem, etc.) register work handlers
 * that are called when settlers perform WORK_ON_ENTITY tasks.
 */

import type { GameState } from '../../game-state';
import type { CoreDeps } from '../feature';
import type { TickSystem } from '../../core/tick-system';
import type { Persistable } from '../../persistence/types';
import { EntityType, UnitType, type Entity } from '../../entity';
import { isAngelUnitType } from '../../core/unit-types';
import { createLogger } from '@/utilities/logger';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { sortedEntries } from '@/utilities/collections';
import { JobType, SearchType, SettlerState, type JobState, type WorkHandler, type SettlerConfig } from './types';
import type { ChoreoJobState, ChoreoNode, TransportJobOps } from './choreo-types';
import { buildAllSettlerConfigs } from '../../data/settler-data-access';
import type { BuildingInventoryManager, BuildingPileRegistry } from '../inventory';
import type { PileRegistry } from '../inventory/pile-registry';
import { createWorkplaceHandler, createCarrierHandler } from './work-handlers';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { WorkHandlerRegistry } from './work-handler-registry';
import { IdleAnimationController } from './idle-animation-controller';
import { WorkerTaskExecutor } from './worker-task-executor';
import { UnitStateMachine, type UnitRuntime } from './unit-state-machine';
import { JobChoreographyStore } from './job-choreography-store';
import { BuildingPositionResolverImpl } from './building-position-resolver';
import { JobPartResolverImpl } from './job-part-resolver';
import { TriggerSystemImpl } from '../building-overlays/trigger-system';
import { getGameDataLoader } from '@/resources/game-data';
import type { WorkAreaStore } from '../work-areas/work-area-store';
import type { BuildingOverlayManager } from '../building-overlays/building-overlay-manager';
import type { OreVeinData } from '../ore-veins/ore-vein-data';
import type { ProductionControlManager } from '../production-control';
import type { BarracksTrainingManager } from '../barracks';
import type { ConstructionSiteManager } from '../building-construction/construction-site-manager';
import type { Command, CommandResult } from '../../commands';
import type { MaterialTransfer } from '../material-transfer';
import type { ChoreoSystem } from '../../systems/choreo';
import type { ISettlerBuildingLocationManager } from '../settler-location/types';

const log = createLogger('SettlerTaskSystem');

/** How often to run the orphan-runtime safety net (in ticks) */
const ORPHAN_CHECK_INTERVAL = 60;

/** How many ticks an idle settler waits before re-scanning for work. */
const IDLE_SEARCH_COOLDOWN = 10;

/** Local alias — Map from UnitType to settler config. */
type SettlerConfigs = Map<UnitType, SettlerConfig>;

/** Configuration for SettlerTaskSystem dependencies */
export interface SettlerTaskSystemConfig extends CoreDeps {
    choreoSystem: ChoreoSystem;
    visualService: EntityVisualService;
    inventoryManager: BuildingInventoryManager;
    /** Lazy getter — pile slot registry for live entity lookup. */
    getPileSlotRegistry: () => PileRegistry | null;
    /** Lazy getter — pile registry may be set after construction (game data load). */
    getPileRegistry: () => BuildingPileRegistry | null;
    /** Work area store for resolving building work-center positions. */
    workAreaStore: WorkAreaStore;
    /** Building overlay manager for trigger-driven overlay animations. */
    buildingOverlayManager: BuildingOverlayManager;
    /** Lazy getter — resolved on first use (production control may init after construction). */
    getProductionControlManager?: () => ProductionControlManager;
    /** Lazy getter — resolved on first use (barracks training manager inits after construction). */
    getBarracksTrainingManager?: () => BarracksTrainingManager;
    /** Construction site manager — used to filter out buildings still under construction. */
    constructionSiteManager: ConstructionSiteManager;
    /** Command executor for entity creation/removal during simulation. */
    executeCommand: (cmd: Command) => CommandResult;
    /** Material transfer service — unified material movement & conservation. */
    materialTransfer: MaterialTransfer;
    /** Returns true if the entity is actively in combat (fighting or pursuing). */
    isInCombat?: (entityId: number) => boolean;
    /** Location manager for tracking settler approach/inside state. */
    locationManager: ISettlerBuildingLocationManager;
}

// ─────────────────────────────────────────────────────────────
// Serialization types
// ─────────────────────────────────────────────────────────────

interface SerializedChoreoJob {
    jobId: string;
    nodes: ChoreoNode[];
    nodeIndex: number;
    progress: number;
    visible: boolean;
    activeTrigger: string;
    targetId: number | null;
    targetPos: { x: number; y: number } | null;
    carryingGood: number | null;
    workStarted: boolean;
}

interface SerializedUnitRuntime {
    entityId: number;
    state: string;
    lastDirection: number;
    homeAssignment: { buildingId: number; hasVisited: boolean } | null;
    job: SerializedChoreoJob | null;
}

/**
 * Manages all unit behaviors through task execution.
 */
export class SettlerTaskSystem implements TickSystem, Persistable<SerializedUnitRuntime[]> {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly settlerConfigs: SettlerConfigs;
    private readonly choreographyStore: JobChoreographyStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly buildingPositionResolver: BuildingPositionResolverImpl;
    private readonly workerExecutor: WorkerTaskExecutor;
    private readonly stateMachine: UnitStateMachine;
    private readonly runtimes = new Map<number, UnitRuntime>();
    /** Tracks how many workers are assigned to each building (for occupancy limits). */
    private readonly buildingOccupants = new Map<number, number>();
    /** Per-tile ore data — set after terrain is loaded via setOreVeinData(). */
    private oreVeinData: OreVeinData | undefined;
    /** Tick counter for throttling the orphan-runtime safety net */
    private ticksSinceOrphanCheck = 0;
    /** Late-bound transport job ops — set by LogisticsDispatcherFeature after construction. */
    private _transportJobOps: TransportJobOps | null = null;
    /** Location manager — owns approaching/inside state and entity.hidden transitions. */
    private readonly locationManager: ISettlerBuildingLocationManager;

    /** Internal timing breakdown from last tick (exposed via getSubTimings). */
    private lastSubTimings: Record<string, number> = {};

    constructor(config: SettlerTaskSystemConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
        this.locationManager = config.locationManager;

        this.settlerConfigs = buildAllSettlerConfigs();
        this.choreographyStore = new JobChoreographyStore();

        // Throttled loggers shared across sub-systems
        const handlerErrorLogger = new ThrottledLogger(log, 2000);
        const missingHandlerLogger = new ThrottledLogger(log, 5000);

        const jobPartResolver = new JobPartResolverImpl();
        const triggerSystem = new TriggerSystemImpl({
            setWorkingOverlay: (buildingId, working) => config.buildingOverlayManager.setWorking(buildingId, working),
            gameState: this.gameState,
            dataLoader: getGameDataLoader(),
        });

        this.buildingPositionResolver = new BuildingPositionResolverImpl({
            gameState: this.gameState,
            getPileSlotRegistry: config.getPileSlotRegistry,
            getPileRegistry: config.getPileRegistry,
            workAreaStore: config.workAreaStore,
        });

        this.handlerRegistry = new WorkHandlerRegistry();

        this.animController = new IdleAnimationController(config.visualService, this.gameState.rng);

        const constructionSiteManager = config.constructionSiteManager;
        // Lazy proxy — LogisticsDispatcher sets the real impl after construction via setTransportJobOps().
        const transportJobOps: TransportJobOps = {
            getJob: jobId => this._transportJobOps!.getJob(jobId),
            pickUp: jobId => this._transportJobOps!.pickUp(jobId),
            deliver: jobId => this._transportJobOps!.deliver(jobId),
            cancel: jobId => this._transportJobOps!.cancel(jobId),
        };

        this.workerExecutor = new WorkerTaskExecutor({
            choreoSystem: config.choreoSystem,
            gameState: this.gameState,
            choreographyStore: this.choreographyStore,
            handlerRegistry: this.handlerRegistry,
            animController: this.animController,
            handlerErrorLogger,
            missingHandlerLogger,
            isBuildingAvailable: (buildingId: number) => !constructionSiteManager.hasSite(buildingId),
            eventBus: config.eventBus,
            inventoryManager: this.inventoryManager,
            buildingPositionResolver: this.buildingPositionResolver,
            triggerSystem,
            getWorkerHomeBuilding: this.getAssignedBuilding.bind(this),
            jobPartResolver,
            materialTransfer: config.materialTransfer,
            transportJobOps,
            getBarracksTrainingManager: config.getBarracksTrainingManager,
            executeCommand: config.executeCommand,
        });

        this.stateMachine = new UnitStateMachine({
            gameState: this.gameState,
            visualService: config.visualService,
            settlerConfigs: this.settlerConfigs,
            animController: this.animController,
            workerExecutor: this.workerExecutor,
            buildingOccupants: this.buildingOccupants,
            isInCombat: config.isInCombat ?? (() => false),
            claimBuilding: this.claimBuilding.bind(this),
            releaseBuilding: this.releaseBuilding.bind(this),
            idleSearchCooldown: IDLE_SEARCH_COOLDOWN,
        });

        // Register built-in WORKPLACE handler for building workers
        this.handlerRegistry.register(
            SearchType.WORKPLACE,
            createWorkplaceHandler(
                this.gameState,
                this.inventoryManager,
                this.getAssignedWorkplace.bind(this),
                () => this.oreVeinData,
                config.getProductionControlManager
            )
        );

        // Register GOOD handler for carriers (they get jobs assigned externally by LogisticsDispatcher)
        this.handlerRegistry.register(SearchType.GOOD, createCarrierHandler());

        // Subscribe: when a transport job is cancelled (stall recovery, building destroyed, etc.),
        // interrupt the carrier's active task so it drops carried material as a free pile.
        config.eventBus.on('carrier:transportCancelled', ({ carrierId }) => {
            const runtime = this.runtimes.get(carrierId);
            if (!runtime?.job) return;

            const entity = this.gameState.getEntity(carrierId);
            if (!entity) return;

            const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
            if (!unitConfig) return;

            this.interruptJobForCleanup(entity, unitConfig, runtime);
            runtime.job = null;
        });

        // Subscribe: when a building is destroyed while a worker settler is approaching it,
        // clear their home assignment, interrupt any active job, and cancel movement.
        // Note: onBuildingRemoved may have already run (called from onEntityRemoved directly);
        // the homeAssignment check ensures we don't double-process.
        config.eventBus.on('settler-location:approachInterrupted', ({ settlerId, buildingId }) => {
            if (!this.runtimes.has(settlerId)) return;
            const runtime = this.runtimes.get(settlerId)!;
            if (runtime.homeAssignment?.buildingId !== buildingId) return;

            runtime.homeAssignment = null;

            if (runtime.job) {
                const entity = this.gameState.getEntity(settlerId);
                if (entity) {
                    const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
                    if (unitConfig) {
                        this.interruptJobForCleanup(entity, unitConfig, runtime);
                    }
                }
                runtime.job = null;
            }

            if (runtime.moveTask) {
                runtime.moveTask = null;
            }
            this.gameState.movement.getController(settlerId)?.clearPath();
        });

        log.debug(
            `Loaded ${this.settlerConfigs.size} settler configs, ${this.choreographyStore.cacheSize} cached jobs`
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Persistable implementation
    // ─────────────────────────────────────────────────────────────

    readonly persistKey = 'settlerTasks' as const;

    serialize(): SerializedUnitRuntime[] {
        const result: SerializedUnitRuntime[] = [];
        for (const [entityId, runtime] of this.runtimes) {
            result.push(this.serializeRuntime(entityId, runtime));
        }
        return result;
    }

    deserialize(data: SerializedUnitRuntime[]): void {
        this.runtimes.clear();
        this.buildingOccupants.clear();

        for (const entry of data) {
            const entity = this.gameState.getEntityOrThrow(entry.entityId, 'settler-task restore');

            const runtime = this.getRuntime(entity.id);
            runtime.state = entry.state as SettlerState;
            runtime.lastDirection = entry.lastDirection;

            if (entry.homeAssignment) {
                // skipApproaching=true: location manager restores approach/inside state from its own persistence.
                this.claimBuilding(runtime, entry.homeAssignment.buildingId, true);
                runtime.homeAssignment!.hasVisited = entry.homeAssignment.hasVisited;
            }

            if (entry.job) {
                runtime.job = this.deserializeJob(entry.job);
            }
        }
    }

    private serializeRuntime(entityId: number, runtime: UnitRuntime): SerializedUnitRuntime {
        const job = runtime.job;
        // Transport jobs and active move tasks are not serialized — restart idle on load.
        const hasTransport = job?.transportData !== undefined;
        const hasMoveTask = runtime.moveTask !== null;
        const serializedJob = job && !hasTransport ? this.serializeJob(job) : null;

        return {
            entityId,
            state: hasTransport || hasMoveTask ? SettlerState.IDLE : runtime.state,
            lastDirection: runtime.lastDirection,
            homeAssignment: runtime.homeAssignment
                ? {
                    buildingId: runtime.homeAssignment.buildingId,
                    hasVisited: runtime.homeAssignment.hasVisited,
                }
                : null,
            job: serializedJob,
        };
    }

    private serializeJob(job: ChoreoJobState): SerializedChoreoJob {
        return {
            jobId: job.jobId,
            nodes: job.nodes,
            nodeIndex: job.nodeIndex,
            progress: job.progress,
            visible: job.visible,
            activeTrigger: job.activeTrigger,
            targetId: job.targetId,
            targetPos: job.targetPos ? { x: job.targetPos.x, y: job.targetPos.y } : null,
            carryingGood: job.carryingGood,
            workStarted: job.workStarted,
        };
    }

    private deserializeJob(data: SerializedChoreoJob): ChoreoJobState {
        return {
            type: JobType.CHOREO,
            jobId: data.jobId,
            nodes: data.nodes,
            nodeIndex: data.nodeIndex,
            progress: data.progress,
            visible: data.visible,
            activeTrigger: data.activeTrigger,
            targetId: data.targetId,
            targetPos: data.targetPos ? { x: data.targetPos.x, y: data.targetPos.y } : null,
            carryingGood: data.carryingGood as ChoreoJobState['carryingGood'],
            workStarted: data.workStarted,
            pathRetryCountdown: 0,
        };
    }

    /** Set the transport job ops implementation (called by LogisticsDispatcherFeature after construction). */
    setTransportJobOps(ops: TransportJobOps): void {
        this._transportJobOps = ops;
    }

    /** Expose the building position resolver for external consumers (logistics transport job builder). */
    getPositionResolver(): BuildingPositionResolverImpl {
        return this.buildingPositionResolver;
    }

    /** Expose the choreography store for external consumers (logistics transport job builder). */
    getChoreographyStore(): JobChoreographyStore {
        return this.choreographyStore;
    }

    /** Enable verbose choreography events (nodeStarted, nodeCompleted, animationApplied, waitingAtHome). */
    get verbose(): boolean {
        return this.workerExecutor.verbose;
    }

    set verbose(value: boolean) {
        this.workerExecutor.verbose = value;
    }

    // ─────────────────────────────────────────────────────────────
    // Query API
    // ─────────────────────────────────────────────────────────────

    /**
     * Check if a settler is managed by this system (has active job or is a known type).
     * Other systems should check this before manipulating settler animation.
     */
    isManaged(entityId: number): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return false;
        return this.settlerConfigs.has(entity.subType as UnitType);
    }

    /**
     * Check if a unit is currently working (has active job or move task).
     */
    isWorking(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        if (!runtime) return false;
        return runtime.state === SettlerState.WORKING || runtime.moveTask !== null;
    }

    hasMoveTask(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        return runtime !== undefined && runtime.moveTask !== null;
    }

    /** Get the active job ID for a settler, or null if idle/no job. */
    getActiveJobId(entityId: number): string | null {
        return this.runtimes.get(entityId)?.job?.jobId ?? null;
    }

    /** Get the current settler state (IDLE/WORKING/INTERRUPTED), or null if not tracked. */
    getSettlerState(entityId: number): SettlerState | null {
        return this.runtimes.get(entityId)?.state ?? null;
    }

    /**
     * Return debug info for all managed unit runtimes (for e2e diagnostics).
     * Safe to call at any time — returns plain serializable objects.
     */
    getDebugInfo(): Array<{
        entityId: number;
        state: string;
        jobId: string | null;
        jobType: string | null;
        taskIndex: number | null;
        progress: number | null;
        targetId: number | null;
        carryingGood: number | null;
        assignedBuilding: number | null;
    }> {
        const result = [];
        for (const [entityId, runtime] of this.runtimes) {
            result.push(this.buildDebugEntry(entityId, runtime));
        }
        return result;
    }

    private buildDebugEntry(entityId: number, runtime: UnitRuntime) {
        const job = runtime.job;
        if (!job) {
            return {
                entityId,
                state: runtime.state,
                jobId: null,
                jobType: null,
                taskIndex: null,
                progress: null,
                targetId: null,
                carryingGood: null,
                assignedBuilding: runtime.homeAssignment?.buildingId ?? null,
            };
        }
        return {
            entityId,
            state: runtime.state,
            jobId: job.jobId,
            jobType: job.type,
            taskIndex: job.nodeIndex,
            progress: job.progress,
            targetId: job.targetId,
            carryingGood: job.carryingGood,
            assignedBuilding: runtime.homeAssignment?.buildingId ?? null,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Work handler registration (delegated to registry)
    // ─────────────────────────────────────────────────────────────

    /**
     * Register a work handler for a search type.
     * Domain systems call this to plug into the task system.
     * A search type can have one entity handler and one position handler.
     */
    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
        this.handlerRegistry.register(searchType, handler);
    }

    /** Get the assigned building ID for a settler, or null if unassigned. */
    getAssignedBuilding(settlerId: number): number | null {
        return this.runtimes.get(settlerId)?.homeAssignment?.buildingId ?? null;
    }

    /** Get the assigned building entity for a settler (for workplace handler). */
    private getAssignedWorkplace(settlerId: number): Entity | null {
        const buildingId = this.getAssignedBuilding(settlerId);
        if (buildingId === null) return null;
        return this.gameState.getEntity(buildingId) ?? null;
    }

    /** Provide ore vein data for mine production checks (called from GameServices.setTerrainData). */
    setOreVeinData(data: OreVeinData): void {
        this.oreVeinData = data;
    }

    // ─────────────────────────────────────────────────────────────
    // Building occupancy tracking
    // ─────────────────────────────────────────────────────────────

    /**
     * Assign a building to a worker, incrementing its occupant count.
     * @param skipApproaching When true (deserialization), skips markApproaching — the location
     *   manager restores its own state from its own persistence entry.
     */
    private claimBuilding(runtime: UnitRuntime, buildingId: number, skipApproaching = false): void {
        runtime.homeAssignment = { buildingId, hasVisited: false };
        this.buildingOccupants.set(buildingId, (this.buildingOccupants.get(buildingId) ?? 0) + 1);
        if (!skipApproaching) {
            // Locate the settler ID by reverse-lookup in the runtimes map.
            // claimBuilding is called infrequently (once per assignment), so O(n) is acceptable.
            for (const [id, r] of this.runtimes) {
                if (r === runtime) {
                    this.locationManager.markApproaching(id, buildingId);
                    break;
                }
            }
        }
    }

    /** Release a worker's building assignment, decrementing its occupant count. */
    private releaseBuilding(runtime: UnitRuntime): void {
        if (!runtime.homeAssignment) return;
        const id = runtime.homeAssignment.buildingId;
        const count = this.buildingOccupants.get(id);
        if (count === undefined)
            throw new Error(`No occupant count for building ${id} in SettlerTaskSystem.releaseBuilding`);
        if (count <= 1) {
            this.buildingOccupants.delete(id);
        } else {
            this.buildingOccupants.set(id, count - 1);
        }

        // Locate settler ID by reverse-lookup so we can clean up location state.
        for (const [settlerId, r] of this.runtimes) {
            if (r === runtime) {
                if (this.locationManager.isInside(settlerId)) {
                    this.locationManager.exitBuilding(settlerId);
                } else if (this.locationManager.isCommitted(settlerId)) {
                    this.locationManager.cancelApproach(settlerId);
                }
                break;
            }
        }

        runtime.homeAssignment = null;
    }

    // ─────────────────────────────────────────────────────────────
    // Public API for assigning tasks
    // ─────────────────────────────────────────────────────────────

    /**
     * Assign a simple move task to a unit (for user-initiated movement).
     * This interrupts any current job and starts movement to the target.
     * @returns true if movement was started successfully
     */
    assignMoveTask(entityId: number, targetX: number, targetY: number): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) {
            return false;
        }

        // Start movement via MovementSystem
        const moveSuccess = this.gameState.movement.moveUnit(entityId, targetX, targetY);
        if (!moveSuccess) {
            return false;
        }

        const runtime = this.getRuntime(entityId);

        // Interrupt any current job
        const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
        if (runtime.job) {
            if (unitConfig) {
                this.interruptJobForCleanup(entity, unitConfig, runtime);
            }
            runtime.job = null;
        }

        // Clear any position handler state (e.g. geologist's prospecting origin) so the
        // worker re-anchors to its new destination rather than the old area.
        if (unitConfig) {
            const posHandler = this.handlerRegistry.getPositionHandler(unitConfig.plantSearch ?? unitConfig.search);
            posHandler?.onSettlerRemoved?.(entityId);
        }

        // Player is moving this worker away — release building assignment.
        // releaseBuilding calls exitBuilding/cancelApproach for tracked settlers.
        this.releaseBuilding(runtime);

        // Ensure visibility for settlers not tracked by locationManager (e.g. carriers).
        if (!this.locationManager.isCommitted(entity.id)) {
            entity.hidden = false;
        }
        runtime.moveTask = { type: 'move', targetX, targetY };
        runtime.state = SettlerState.WORKING;

        // Start walk animation (controller MUST exist after successful moveUnit)
        const controller = this.gameState.movement.getController(entityId)!;
        this.animController.startWalkAnimation(entity, controller.direction);

        log.debug(`Unit ${entityId} assigned move task to (${targetX}, ${targetY})`);
        return true;
    }

    /**
     * Cancel any active move task for a unit.
     */
    cancelMoveTask(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (runtime?.moveTask) {
            runtime.moveTask = null;
            // Don't change state - let tick() handle transition to idle
        }
    }

    /**
     * Assign an externally-constructed job to a unit.
     * Used by LogisticsDispatcher for carrier transport jobs and potentially
     * for future external job assignments (military orders, etc.).
     *
     * Interrupts any current job and optionally starts movement.
     *
     * @param entityId Entity ID of the unit
     * @param job The job state to assign
     * @param moveTo Optional initial movement target
     * @returns true if the job was assigned (movement started if requested)
     */
    assignJob(entityId: number, job: JobState, moveTo?: { x: number; y: number }): boolean {
        const entity = this.gameState.getEntityOrThrow(entityId, 'unit for job assignment');
        const runtime = this.getRuntime(entityId);

        // Interrupt any current job
        if (runtime.job) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config) {
                this.interruptJobForCleanup(entity, config, runtime);
            }
            runtime.job = null;
        }

        // Start movement if target position provided
        if (moveTo) {
            const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo.x, moveTo.y);
            if (!moveSuccess) {
                return false;
            }
        }

        // Ensure visibility for settlers not tracked by locationManager (e.g. carriers).
        if (!this.locationManager.isCommitted(entity.id)) {
            entity.hidden = false;
        }
        runtime.state = SettlerState.WORKING;
        runtime.job = job;
        runtime.moveTask = null;

        // Start walk animation if moving
        if (moveTo) {
            const controller = this.gameState.movement.getController(entityId)!;
            this.animController.startWalkAnimation(entity, controller.direction);
        }

        log.debug(`Unit ${entityId} assigned job ${job.jobId}`);
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Tick processing
    // ─────────────────────────────────────────────────────────────

    /**
     * Called by GameLoop when an entity is removed.
     * Handles both settler removal (interrupt jobs, release building) and
     * building removal (release all workers assigned to it).
     */
    onEntityRemoved(entityId: number): void {
        // If a building was destroyed, release all workers assigned to it
        if (this.buildingOccupants.has(entityId)) {
            this.onBuildingRemoved(entityId);
        }

        // Settler removal — interrupt and clean up runtime
        const runtime = this.runtimes.get(entityId);
        if (!runtime) return;

        const entity = this.gameState.getEntity(entityId);
        if (entity) {
            this.cleanupSettlerHandlers(entity, entityId, runtime);
        } else if (runtime.job?.targetId && runtime.job.workStarted) {
            // Entity already gone — call onWorkInterrupt directly
            const entityHandler = this.handlerRegistry.findEntityHandlerForJob(runtime.job.jobId, this.settlerConfigs);
            if (entityHandler) {
                try {
                    entityHandler.onWorkInterrupt?.(runtime.job.targetId, entityId);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    log.error(`onWorkInterrupt failed for entity ${entityId}`, err);
                }
            }
        }

        this.releaseBuilding(runtime);
        this.runtimes.delete(entityId);
    }

    private cleanupSettlerHandlers(entity: Entity, entityId: number, runtime: UnitRuntime): void {
        const config = this.settlerConfigs.get(entity.subType as UnitType);
        if (!config) return;
        if (runtime.job) this.interruptJobForCleanup(entity, config, runtime);
        const posHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);
        posHandler?.onSettlerRemoved?.(entityId);
    }

    /** Release and interrupt all workers assigned to a destroyed building so they return to idle. */
    private onBuildingRemoved(buildingId: number): void {
        this.buildingOccupants.delete(buildingId);
        for (const [settlerId, runtime] of sortedEntries(this.runtimes)) {
            if (runtime.homeAssignment?.buildingId !== buildingId) continue;

            runtime.homeAssignment = null;

            // Interrupt active job so the worker stops immediately
            if (runtime.job) {
                const entity = this.gameState.getEntity(settlerId);
                if (entity) {
                    const config = this.settlerConfigs.get(entity.subType as UnitType);
                    if (config) {
                        this.interruptJobForCleanup(entity, config, runtime);
                    }
                }
                runtime.job = null;
            }

            // Cancel any in-progress movement (move tasks or raw movement toward building)
            if (runtime.moveTask) {
                runtime.moveTask = null;
            }
            this.gameState.movement.getController(settlerId)?.clearPath();
        }
    }

    /** TickSystem interface */
    tick(dt: number): void {
        let idleCount = 0;
        let workingCount = 0;
        let otherCount = 0;
        let idleTime = 0;
        let workingTime = 0;
        let otherTime = 0;

        const unitIds = this.gameState.entityIndex.idsOfType(EntityType.Unit);
        for (const id of unitIds) {
            const entity = this.gameState.getEntity(id);
            if (!entity) continue;
            // Skip ephemeral visual-only units (death angels)
            if (isAngelUnitType(entity.subType as UnitType)) continue;

            try {
                const runtime = this.getRuntime(entity.id);
                const t0 = performance.now();
                this.stateMachine.updateUnit(entity, runtime, dt);
                const elapsed = performance.now() - t0;

                switch (runtime.state) {
                case SettlerState.IDLE:
                    idleCount++;
                    idleTime += elapsed;
                    break;
                case SettlerState.WORKING:
                    workingCount++;
                    workingTime += elapsed;
                    break;
                case SettlerState.INTERRUPTED:
                    otherCount++;
                    otherTime += elapsed;
                    break;
                }
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Unhandled error updating unit ${entity.id}`, err);
            }
        }

        this.cleanOrphanedRuntimes();

        this.lastSubTimings = {
            [`idle(${idleCount})`]: Math.round(idleTime * 100) / 100,
            [`working(${workingCount})`]: Math.round(workingTime * 100) / 100,
            [`other(${otherCount})`]: Math.round(otherTime * 100) / 100,
        };
    }

    /** Expose sub-timings for the debug panel. */
    getSubTimings(): Record<string, number> {
        return this.lastSubTimings;
    }

    /** Safety net: clean up runtimes for entities removed without onEntityRemoved signal. */
    private cleanOrphanedRuntimes(): void {
        if (++this.ticksSinceOrphanCheck >= ORPHAN_CHECK_INTERVAL) {
            this.ticksSinceOrphanCheck = 0;
            for (const id of this.runtimes.keys()) {
                if (!this.gameState.getEntity(id)) {
                    this.onEntityRemoved(id);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────

    private getRuntime(entityId: number): UnitRuntime {
        let runtime = this.runtimes.get(entityId);
        if (!runtime) {
            runtime = {
                state: SettlerState.IDLE,
                job: null,
                moveTask: null,
                lastDirection: 0,
                idleState: this.animController.createIdleState(),
                homeAssignment: null,
                idleSearchCooldown: 0,
            };
            this.runtimes.set(entityId, runtime);
        }
        return runtime;
    }

    /**
     * Clean up a current job for entity removal or task reassignment.
     * Completes the job if all nodes were already executed; interrupts otherwise.
     */
    private interruptJobForCleanup(entity: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        const job = runtime.job!;
        if (job.nodeIndex >= job.nodes.length) {
            this.workerExecutor.completeJob(entity, runtime);
        } else {
            this.workerExecutor.interruptJob(entity, config, runtime);
        }
    }
}
