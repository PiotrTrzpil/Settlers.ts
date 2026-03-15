/**
 * Settler Task System — manages all unit behaviors via tasks.
 * Coordinates WorkHandlerRegistry, UnitStateMachine, WorkerTaskExecutor,
 * IdleAnimationController, and BuildingWorkerTracker.
 */

import type { GameState } from '../../game-state';
import type { TickSystem } from '../../core/tick-system';
import { EntityType, UnitType, BuildingType, tileKey, type Entity } from '../../entity';
import type { EventBus } from '../../event-bus';
import { isAngelUnitType } from '../../core/unit-types';
import { createLogger } from '@/utilities/logger';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import {
    SearchType,
    SettlerState,
    type JobState,
    type WorkHandler,
    type SettlerConfig,
    type TaskDispatcher,
    type WorkerStateQuery,
} from './types';
import { buildAllSettlerConfigs } from '../../data/settler-data-access';
import { getBuildingDoorPos } from '../../data/game-data-access';
import type { BuildingInventoryManager } from '../inventory';
import { createWorkplaceHandler, createCarrierHandler } from './work-handlers';
import { WorkHandlerRegistry } from './work-handler-registry';
import { IdleAnimationController } from './idle-animation-controller';
import { WorkerTaskExecutor } from './worker-task-executor';
import { UnitStateMachine, TickCategory, type UnitRuntime } from './unit-state-machine';
import { JobChoreographyStore } from './job-choreography-store';
import { BuildingPositionResolverImpl } from './building-position-resolver';
import { JobPartResolverImpl } from './job-part-resolver';
import { TriggerSystemImpl } from '../building-overlays/trigger-system';
import { getGameDataLoader } from '@/resources/game-data';
import type { OreVeinData } from '../ore-veins/ore-vein-data';
import type { ISettlerBuildingLocationManager } from '../settler-location/types';
import { BuildingWorkerTracker } from './building-worker-tracker';
import { IndexedMap } from '@/game/utils/indexed-map';
import type { TickScheduler } from '../../systems/tick-scheduler';
import { type SettlerTaskSystemConfig, type SettlerDebugEntry } from './settler-task-config';
import { SettlerLifecycleCoordinator } from './settler-lifecycle';
import { dumpSettlerDebug, dumpWorkerAssignments, type SettlerDebugSource } from './internal/settler-debug';
export type { SettlerTaskSystemConfig } from './settler-task-config';

const log = createLogger('SettlerTaskSystem');
const IDLE_SEARCH_COOLDOWN = 10;
type SettlerConfigs = Map<UnitType, SettlerConfig>;

export class SettlerTaskSystem implements TickSystem, TaskDispatcher, WorkerStateQuery, SettlerDebugSource {
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
    readonly runtimes = new IndexedMap<number, UnitRuntime>();
    readonly workerTracker: BuildingWorkerTracker;
    private readonly tickScheduler: TickScheduler;
    private oreVeinData: OreVeinData | undefined;
    private lastSubTimings: Record<string, number> = {};
    private readonly locationManager: ISettlerBuildingLocationManager;
    private readonly lifecycleCoordinator: SettlerLifecycleCoordinator;

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
            inventoryManager: this.inventoryManager,
            getPileRegistry: config.getPileRegistry,
            workAreaStore: config.workAreaStore,
            constructionSiteManager: config.constructionSiteManager,
        });

        this.handlerRegistry = new WorkHandlerRegistry();

        this.animController = new IdleAnimationController(config.visualService, this.gameState.rng);

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
            constructionSiteManager: config.constructionSiteManager,
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

        this.lifecycleCoordinator = new SettlerLifecycleCoordinator({
            gameState: this.gameState,
            eventBus: this.eventBus,
            tickScheduler: this.tickScheduler,
            workerTracker: this.workerTracker,
            stateMachine: this.stateMachine,
            runtimes: this.runtimes,
            locationManager: this.locationManager,
            inventoryManager: this.inventoryManager,
            handlerRegistry: this.handlerRegistry,
            interruptJob: (entity, cfg, runtime) => this.interruptJobForCleanup(entity, cfg, runtime),
            createRuntime: () => ({
                state: SettlerState.IDLE,
                job: null,
                moveTask: null,
                lastDirection: 0,
                idleState: this.animController.createIdleState(),
                homeAssignment: null,
                idleSearchReady: false,
            }),
        });

        this.lifecycleCoordinator.registerEvents();

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

        log.debug(
            `Loaded ${this.settlerConfigs.size} settler configs, ${this.choreographyStore.cacheSize} cached jobs`
        );
    }

    /** Delegate entity removal to the lifecycle coordinator (used by cleanup registry). */
    onEntityRemoved(entityId: number): void {
        this.lifecycleCoordinator.onEntityRemoved(entityId);
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
        if (!entity || entity.type !== EntityType.Unit) {
            return false;
        }
        return this.settlerConfigs.has(entity.subType as UnitType);
    }

    isWorking(entityId: number): boolean {
        const runtime = this.runtimes.get(entityId);
        if (!runtime) {
            return false;
        }
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

    getDebugInfo(): SettlerDebugEntry[] {
        return dumpSettlerDebug(this);
    }

    dumpWorkerAssignments(): string {
        return dumpWorkerAssignments(this);
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
        if (buildingId === null) {
            return null;
        }
        return this.gameState.getEntity(buildingId) ?? null;
    }

    setOreVeinData(data: OreVeinData): void {
        this.oreVeinData = data;
    }

    relocateUnitsFromFootprints(): void {
        this.workerTracker.relocateFromFootprints();
    }

    findIdleSpecialist(unitType: UnitType, player: number, nearX: number, nearY: number): number | null {
        return this.workerTracker.findIdleSpecialist(unitType, player, nearX, nearY);
    }

    assignWorkerToBuilding(settlerId: number, buildingId: number): void {
        this.workerTracker.assignWorker(settlerId, buildingId);
    }

    getOccupantCount(buildingId: number): number {
        return this.workerTracker.occupants.get(buildingId) ?? 0;
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

        // When target is inside a building footprint, reroute to the building's door tile.
        let moveX = targetX;
        let moveY = targetY;
        if (this.gameState.buildingOccupancy.has(tileKey(targetX, targetY))) {
            const building = this.gameState.getGroundEntityAt(targetX, targetY);
            if (building && building.type === EntityType.Building) {
                const door = getBuildingDoorPos(
                    building.x,
                    building.y,
                    building.race,
                    building.subType as BuildingType
                );
                moveX = door.x;
                moveY = door.y;
            }
        }

        const moveSuccess = this.gameState.movement.moveUnit(entityId, moveX, moveY);
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
            posHandler?.onSettlerRemoved?.(entityId, targetX, targetY);
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

    tick(dt: number): void {
        const cats: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
        const it = this.workerExecutor.idleTimings;
        for (const k of Object.keys(it)) {
            it[k] = 0;
        }
        this.workerExecutor.idleSearchCount = 0;

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
        for (const [k, v] of Object.entries(it)) {
            sub[`  ${k}`] = v;
        }
        this.lastSubTimings = sub;
    }

    getSubTimings(): Record<string, number> {
        return this.lastSubTimings;
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
            this.lifecycleCoordinator.scheduleIdleCooldown(entityId, stagger);
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
