/**
 * Settler Task System — manages all unit behaviors via tasks.
 * Coordinates WorkHandlerRegistry, UnitStateMachine, WorkerTaskExecutor,
 * IdleAnimationController, and BuildingWorkerTracker.
 */

import type { GameState } from '../../game-state';
import type { CoreDeps } from '../feature';
import type { TickSystem } from '../../core/tick-system';
import type { Persistable } from '../../persistence/types';
import { EntityType, UnitType, type Entity } from '../../entity';
import type { EventBus } from '../../event-bus';
import { isAngelUnitType } from '../../core/unit-types';
import { createLogger } from '@/utilities/logger';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { sortedEntries } from '@/utilities/collections';
import { SearchType, SettlerState, type JobState, type WorkHandler, type SettlerConfig } from './types';
import type { TransportJobOps } from './choreo-types';
import { buildAllSettlerConfigs } from '../../data/settler-data-access';
import { serializeRuntime, deserializeJob, type SerializedUnitRuntime } from './settler-task-serialization';
import type { BuildingInventoryManager, BuildingPileRegistry } from '../inventory';
import type { PileRegistry } from '../../systems/inventory/pile-registry';
import { createWorkplaceHandler, createCarrierHandler } from './work-handlers';
import type { EntityVisualService } from '../../animation/entity-visual-service';
import { WorkHandlerRegistry } from './work-handler-registry';
import { IdleAnimationController } from './idle-animation-controller';
import { WorkerTaskExecutor } from './worker-task-executor';
import { UnitStateMachine, TickCategory, type UnitRuntime } from './unit-state-machine';
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
import { BuildingWorkerTracker } from './building-worker-tracker';
import { IndexedMap } from '@/game/utils/indexed-map';
import type { TickScheduler, ScheduleHandle } from '../../systems/tick-scheduler';
import { NO_HANDLE } from '../../systems/tick-scheduler';

const log = createLogger('SettlerTaskSystem');
const ORPHAN_CHECK_INTERVAL = 60;
const IDLE_SEARCH_COOLDOWN = 10;
type SettlerConfigs = Map<UnitType, SettlerConfig>;

export interface SettlerTaskSystemConfig extends CoreDeps {
    tickScheduler: TickScheduler;
    choreoSystem: ChoreoSystem;
    visualService: EntityVisualService;
    inventoryManager: BuildingInventoryManager;
    getPileSlotRegistry: () => PileRegistry | null;
    getPileRegistry: () => BuildingPileRegistry | null;
    workAreaStore: WorkAreaStore;
    buildingOverlayManager: BuildingOverlayManager;
    getProductionControlManager?: () => ProductionControlManager;
    getBarracksTrainingManager?: () => BarracksTrainingManager;
    constructionSiteManager: ConstructionSiteManager;
    executeCommand: (cmd: Command) => CommandResult;
    materialTransfer: MaterialTransfer;
    isInCombat?: (entityId: number) => boolean;
    locationManager: ISettlerBuildingLocationManager;
}

export class SettlerTaskSystem implements TickSystem, Persistable<SerializedUnitRuntime[]> {
    private readonly gameState: GameState;
    private readonly eventBus: EventBus;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly settlerConfigs: SettlerConfigs;
    private readonly choreographyStore: JobChoreographyStore;
    private readonly handlerRegistry: WorkHandlerRegistry;
    private readonly animController: IdleAnimationController;
    private readonly buildingPositionResolver: BuildingPositionResolverImpl;
    private readonly workerExecutor: WorkerTaskExecutor;
    private readonly stateMachine: UnitStateMachine;
    private readonly runtimes = new IndexedMap<number, UnitRuntime>();
    private readonly workerTracker: BuildingWorkerTracker;
    private readonly tickScheduler: TickScheduler;
    private orphanHandle: ScheduleHandle = NO_HANDLE;
    private readonly idleCooldownHandles = new Map<number, ScheduleHandle>();
    private oreVeinData: OreVeinData | undefined;
    private lastSubTimings: Record<string, number> = {};
    private _transportJobOps: TransportJobOps | null = null;
    private readonly locationManager: ISettlerBuildingLocationManager;

    constructor(config: SettlerTaskSystemConfig) {
        this.gameState = config.gameState;
        this.eventBus = config.eventBus;
        this.inventoryManager = config.inventoryManager;
        this.locationManager = config.locationManager;
        this.tickScheduler = config.tickScheduler;

        this.settlerConfigs = buildAllSettlerConfigs();
        this.choreographyStore = new JobChoreographyStore();

        const byBuilding = this.runtimes.addIndex<number>((_id, runtime) => runtime.homeAssignment?.buildingId ?? null);

        this.workerTracker = new BuildingWorkerTracker(
            this.runtimes,
            id => this.getRuntime(id),
            this.locationManager,
            this.gameState,
            this.eventBus,
            byBuilding
        );

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
            constructionSiteManager: config.constructionSiteManager,
        });

        this.handlerRegistry = new WorkHandlerRegistry();

        this.animController = new IdleAnimationController(config.visualService, this.gameState.rng);

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
            locationManager: this.locationManager,
        });

        this.stateMachine = new UnitStateMachine({
            gameState: this.gameState,
            visualService: config.visualService,
            settlerConfigs: this.settlerConfigs,
            animController: this.animController,
            workerExecutor: this.workerExecutor,
            isInCombat: config.isInCombat ?? (() => false),
            tickScheduler: this.tickScheduler,
        });

        this.orphanHandle = this.tickScheduler.schedule(ORPHAN_CHECK_INTERVAL, () => this.orphanCheckAndReschedule());

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

        this.handlerRegistry.register(SearchType.GOOD, createCarrierHandler());

        config.eventBus.on('carrier:transportCancelled', ({ unitId: carrierId }) => {
            const runtime = this.runtimes.get(carrierId);
            if (!runtime?.job) return;

            const entity = this.gameState.getEntity(carrierId);
            if (!entity) return;

            const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
            if (!unitConfig) return;

            this.interruptJobForCleanup(entity, unitConfig, runtime);
            runtime.job = null;
        });

        config.eventBus.on('settler-location:approachInterrupted', ({ unitId: settlerId, buildingId }) => {
            if (!this.runtimes.has(settlerId)) return;
            const runtime = this.runtimes.get(settlerId)!;
            if (runtime.homeAssignment?.buildingId !== buildingId) return;

            runtime.homeAssignment = null;
            this.runtimes.reindex(settlerId);

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

            runtime.moveTask = null;
            this.gameState.movement.getController(settlerId)?.clearPath();
        });

        config.eventBus.on('building:workerSpawned', ({ buildingId, unitId: settlerId }) => {
            this.workerTracker.assignWorkerInside(settlerId, buildingId);
        });

        log.debug(
            `Loaded ${this.settlerConfigs.size} settler configs, ${this.choreographyStore.cacheSize} cached jobs`
        );
    }

    readonly persistKey = 'settlerTasks' as const;

    serialize(): SerializedUnitRuntime[] {
        const result: SerializedUnitRuntime[] = [];
        for (const [entityId, runtime] of this.runtimes) {
            result.push(serializeRuntime(entityId, runtime));
        }
        return result;
    }

    deserialize(data: SerializedUnitRuntime[]): void {
        this.runtimes.clear();
        this.workerTracker.occupants.clear();

        for (const entry of data) {
            const entity = this.gameState.getEntityOrThrow(entry.entityId, 'settler-task restore');

            const runtime = this.getRuntime(entity.id);
            runtime.state = entry.state as SettlerState;
            runtime.lastDirection = entry.lastDirection;

            if (entry.homeAssignment) {
                this.workerTracker.claim(entity.id, runtime, entry.homeAssignment.buildingId, true);
                runtime.homeAssignment!.hasVisited = entry.homeAssignment.hasVisited;
            }

            if (entry.job) {
                runtime.job = deserializeJob(entry.job);
            }
        }
    }

    setTransportJobOps(ops: TransportJobOps): void {
        this._transportJobOps = ops;
    }

    getPositionResolver(): BuildingPositionResolverImpl {
        return this.buildingPositionResolver;
    }

    getChoreographyStore(): JobChoreographyStore {
        return this.choreographyStore;
    }

    get verbose(): boolean {
        return this.workerExecutor.verbose;
    }

    set verbose(value: boolean) {
        this.workerExecutor.verbose = value;
    }

    isManaged(entityId: number): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) return false;
        return this.settlerConfigs.has(entity.subType as UnitType);
    }

    isWorking(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        if (!runtime) return false;
        return runtime.state === SettlerState.WORKING || runtime.moveTask !== null;
    }

    hasMoveTask(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        return runtime !== undefined && runtime.moveTask !== null;
    }

    getActiveJobId(entityId: number): string | null {
        return this.runtimes.get(entityId)?.job?.jobId ?? null;
    }

    getSettlerState(entityId: number): SettlerState | null {
        return this.runtimes.get(entityId)?.state ?? null;
    }

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
            result.push(buildDebugEntry(entityId, runtime));
        }
        return result;
    }

    registerWorkHandler(searchType: SearchType, handler: WorkHandler): void {
        this.handlerRegistry.register(searchType, handler);
    }

    getAssignedBuilding(settlerId: number): number | null {
        return this.workerTracker.getAssignedBuilding(settlerId);
    }

    getWorkersForBuilding(buildingId: number): ReadonlySet<number> {
        return this.workerTracker.getWorkersForBuilding(buildingId);
    }

    private getAssignedWorkplace(settlerId: number): Entity | null {
        const buildingId = this.getAssignedBuilding(settlerId);
        if (buildingId === null) return null;
        return this.gameState.getEntity(buildingId) ?? null;
    }

    setOreVeinData(data: OreVeinData): void {
        this.oreVeinData = data;
    }

    assignInitialBuildingWorkers(): void {
        this.workerTracker.assignInitial();
    }

    findIdleSpecialist(unitType: UnitType, player: number, nearX: number, nearY: number): number | null {
        return this.workerTracker.findIdleSpecialist(unitType, player, nearX, nearY);
    }

    assignWorkerToBuilding(settlerId: number, buildingId: number): void {
        this.workerTracker.assignWorker(settlerId, buildingId);
    }

    assignWorkerInsideBuilding(settlerId: number, buildingId: number): void {
        this.workerTracker.assignWorkerInside(settlerId, buildingId);
    }

    releaseWorkerAssignment(settlerId: number): void {
        this.workerTracker.releaseAssignment(settlerId);
    }

    assignMoveTask(entityId: number, targetX: number, targetY: number): boolean {
        const entity = this.gameState.getEntity(entityId);
        if (!entity || entity.type !== EntityType.Unit) {
            return false;
        }

        const moveSuccess = this.gameState.movement.moveUnit(entityId, targetX, targetY);
        if (!moveSuccess) {
            return false;
        }

        const runtime = this.getRuntime(entityId);

        const unitConfig = this.settlerConfigs.get(entity.subType as UnitType);
        if (runtime.job) {
            if (unitConfig) {
                this.interruptJobForCleanup(entity, unitConfig, runtime);
            }
            runtime.job = null;
        }

        if (unitConfig) {
            const posHandler = this.handlerRegistry.getPositionHandler(unitConfig.plantSearch ?? unitConfig.search);
            posHandler?.onSettlerRemoved?.(entityId);
        }

        this.workerTracker.release(entityId, runtime);

        if (!this.locationManager.isCommitted(entity.id)) {
            entity.hidden = false;
        }
        runtime.moveTask = { type: 'move', targetX, targetY };
        runtime.state = SettlerState.WORKING;

        const controller = this.gameState.movement.getController(entityId)!;
        this.animController.startWalkAnimation(entity, controller.direction);

        log.debug(`Unit ${entityId} assigned move task to (${targetX}, ${targetY})`);
        return true;
    }

    cancelMoveTask(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (runtime?.moveTask) {
            runtime.moveTask = null;
        }
    }

    assignJob(entityId: number, job: JobState, moveTo?: { x: number; y: number }): boolean {
        const entity = this.gameState.getEntityOrThrow(entityId, 'unit for job assignment');
        const runtime = this.getRuntime(entityId);

        if (runtime.job) {
            const config = this.settlerConfigs.get(entity.subType as UnitType);
            if (config) {
                this.interruptJobForCleanup(entity, config, runtime);
            }
            runtime.job = null;
        }

        if (moveTo) {
            const moveSuccess = this.gameState.movement.moveUnit(entityId, moveTo.x, moveTo.y);
            if (!moveSuccess) {
                return false;
            }
        }

        if (!this.locationManager.isCommitted(entity.id)) {
            entity.hidden = false;
        }
        runtime.state = SettlerState.WORKING;
        runtime.job = job;
        runtime.moveTask = null;

        if (moveTo) {
            const controller = this.gameState.movement.getController(entityId)!;
            this.animController.startWalkAnimation(entity, controller.direction);
        }

        log.debug(`Unit ${entityId} assigned job ${job.jobId}`);
        return true;
    }

    onEntityRemoved(entityId: number): void {
        if (this.workerTracker.occupants.has(entityId)) {
            this.onBuildingRemoved(entityId);
        }

        const runtime = this.runtimes.get(entityId);
        if (!runtime) return;

        const entity = this.gameState.getEntity(entityId);
        if (entity) {
            this.cleanupSettlerHandlers(entity, entityId, runtime);
        } else if (runtime.job?.targetId && runtime.job.workStarted) {
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

        const idleHandle = this.idleCooldownHandles.get(entityId);
        if (idleHandle !== undefined) {
            this.tickScheduler.cancel(idleHandle);
            this.idleCooldownHandles.delete(entityId);
        }

        this.workerTracker.release(entityId, runtime);
        this.runtimes.delete(entityId);
    }

    private cleanupSettlerHandlers(entity: Entity, entityId: number, runtime: UnitRuntime): void {
        const config = this.settlerConfigs.get(entity.subType as UnitType);
        if (!config) return;
        if (runtime.job) this.interruptJobForCleanup(entity, config, runtime);
        const posHandler = this.handlerRegistry.getPositionHandler(config.plantSearch ?? config.search);
        posHandler?.onSettlerRemoved?.(entityId);
    }

    private onBuildingRemoved(buildingId: number): void {
        this.workerTracker.clearBuilding(buildingId);
        for (const [settlerId, runtime] of sortedEntries(this.runtimes.raw as Map<number, UnitRuntime>)) {
            if (runtime.homeAssignment?.buildingId !== buildingId) continue;

            runtime.homeAssignment = null;
            this.runtimes.reindex(settlerId);

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

            runtime.moveTask = null;
            this.gameState.movement.getController(settlerId)?.clearPath();
        }
    }

    tick(dt: number): void {
        const cats: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
        const it = this.workerExecutor.idleTimings;
        for (const k of Object.keys(it)) it[k] = 0;
        this.workerExecutor.idleSearchCount = 0;

        const unitIds = this.gameState.entityIndex.idsOfType(EntityType.Unit);
        for (const id of unitIds) {
            const entity = this.gameState.getEntity(id);
            if (!entity) continue;
            if (isAngelUnitType(entity.subType as UnitType)) continue;

            const start = performance.now();
            try {
                const runtime = this.getRuntime(entity.id);
                const cat = this.stateMachine.updateUnit(entity, runtime, dt);
                cats[cat] += performance.now() - start;
            } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error(`Unhandled error updating unit ${entity.id}`, err);
                cats[TickCategory.JOB_EXEC] += performance.now() - start;
            }
        }

        const sub: Record<string, number> = {
            'idle-search': cats[TickCategory.IDLE_SEARCH],
            '  searches': this.workerExecutor.idleSearchCount,
            '  runtimes': this.runtimes.size,
            'idle-skip': cats[TickCategory.IDLE_SKIP],
            'job-exec': cats[TickCategory.JOB_EXEC],
            'move-task': cats[TickCategory.MOVE_TASK],
            'idle-anim': cats[TickCategory.IDLE_ANIM],
        };
        for (const [k, v] of Object.entries(it)) sub[`  ${k}`] = v;
        this.lastSubTimings = sub;
    }

    getSubTimings(): Record<string, number> {
        return this.lastSubTimings;
    }

    private orphanCheckAndReschedule(): void {
        for (const id of this.runtimes.keys()) {
            if (!this.gameState.getEntity(id)) {
                this.onEntityRemoved(id);
            }
        }
        this.orphanHandle = this.tickScheduler.schedule(ORPHAN_CHECK_INTERVAL, () => this.orphanCheckAndReschedule());
    }

    markReadyForSearch(entityId: number): void {
        const runtime = this.runtimes.get(entityId);
        if (runtime) {
            runtime.idleSearchReady = true;
        }
        this.idleCooldownHandles.delete(entityId);
    }

    scheduleIdleCooldown(entityId: number, delay: number): void {
        const existingHandle = this.idleCooldownHandles.get(entityId);
        if (existingHandle !== undefined) {
            this.tickScheduler.cancel(existingHandle);
        }
        const handle = this.tickScheduler.schedule(delay, () => this.markReadyForSearch(entityId));
        this.idleCooldownHandles.set(entityId, handle);
    }

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
                idleSearchReady: false,
            };
            this.runtimes.set(entityId, runtime);
            const stagger = Math.max(1, entityId % IDLE_SEARCH_COOLDOWN);
            this.scheduleIdleCooldown(entityId, stagger);
        }
        return runtime;
    }

    private interruptJobForCleanup(entity: Entity, config: SettlerConfig, runtime: UnitRuntime): void {
        if (runtime.job!.nodeIndex >= runtime.job!.nodes.length) {
            this.workerExecutor.completeJob(entity, runtime);
        } else {
            this.workerExecutor.interruptJob(entity, config, runtime);
        }
    }
}

function buildDebugEntry(entityId: number, runtime: UnitRuntime) {
    const job = runtime.job;
    return {
        entityId,
        state: runtime.state,
        jobId: job?.jobId ?? null,
        jobType: job?.type ?? null,
        taskIndex: job?.nodeIndex ?? null,
        progress: job?.progress ?? null,
        targetId: job?.targetId ?? null,
        carryingGood: job?.carryingGood ?? null,
        assignedBuilding: runtime.homeAssignment?.buildingId ?? null,
    };
}
