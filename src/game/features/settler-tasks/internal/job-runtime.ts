/**
 * Wiring of the job runtime peers — owner registry, outcomes, move tasks, JobRunner, JobService,
 * unit removal and restore resume — over the stores SettlerTaskSystem already built.
 * Also registers the Core-owned owners: the `Work` kind and the 'player-move' commitment owner.
 */

import type { ThrottledLogger } from '@/utilities/throttled-logger';
import type { GameState } from '../../../game-state';
import type { EventBus } from '../../../event-bus';
import type { UnitType } from '../../../entity';
import type { ChoreoSystem } from '../../../systems/choreo';
import type { UnitCommitmentQuery, UnitCommitmentWriter } from '../../../systems/unit-commitment';
import type { TriggerSystem } from '../../building-overlays';
import type { MaterialTransfer } from '../../material-transfer';
import type { ISettlerBuildingLocationManager } from '../../settler-location';
import type { SettlerConfig } from '../types';
import type { UnitRuntimeStore } from '../unit-runtime';
import type { WorkerAssignments } from '../worker-assignments';
import type { WorkHandlerRegistry } from '../work-handler-registry';
import type { IdleAnimationController } from '../idle-animation-controller';
import type { IdleSearchCooldowns } from '../idle-search-cooldowns';
import type { JobChoreographyStore } from '../job-choreography-store';
import { JobRunner } from '../job-runner';
import { JobPartResolverImpl } from '../job-part-resolver';
import { JobServiceImpl } from '../job-service';
import { createWorkJobKind } from '../work-job-kind';
import { JobOwnerRegistry } from './job-owners';
import { JobOutcomes } from './job-outcomes';
import { MoveTaskRunner } from './move-tasks';
import { UnitRemovalHandler } from './unit-removal';
import type { JobResumeDeps, PendingJobResumes } from './job-resume';
import type { JobTeardownDeps } from './job-teardown';

export interface JobRuntimeConfig {
    gameState: GameState;
    eventBus: EventBus;
    choreoSystem: ChoreoSystem;
    triggerSystem: TriggerSystem;
    materialTransfer: MaterialTransfer;
    locationManager: ISettlerBuildingLocationManager;
    runtimes: UnitRuntimeStore;
    assignments: WorkerAssignments;
    settlerConfigs: ReadonlyMap<UnitType, SettlerConfig>;
    handlerRegistry: WorkHandlerRegistry;
    choreographyStore: JobChoreographyStore;
    animController: IdleAnimationController;
    idleCooldowns: IdleSearchCooldowns;
    handlerErrorLogger: ThrottledLogger;
    commitments: UnitCommitmentQuery;
    commitmentWriter: UnitCommitmentWriter;
    pendingResumes: PendingJobResumes;
}

export interface JobRuntime {
    owners: JobOwnerRegistry;
    outcomes: JobOutcomes;
    moveTasks: MoveTaskRunner;
    jobRunner: JobRunner;
    jobs: JobServiceImpl;
    unitRemoval: UnitRemovalHandler;
    resumeDeps: JobResumeDeps;
}

export function createJobRuntime(cfg: JobRuntimeConfig): JobRuntime {
    const owners = new JobOwnerRegistry();
    const teardown: JobTeardownDeps = {
        choreoSystem: cfg.choreoSystem,
        triggerSystem: cfg.triggerSystem,
        handlerRegistry: cfg.handlerRegistry,
        settlerConfigs: cfg.settlerConfigs,
        handlerErrorLogger: cfg.handlerErrorLogger,
    };
    const commitmentDeps = { commitments: cfg.commitments, commitmentWriter: cfg.commitmentWriter };
    const outcomes = new JobOutcomes({
        gameState: cfg.gameState,
        eventBus: cfg.eventBus,
        runtimes: cfg.runtimes,
        owners,
        teardown,
        animController: cfg.animController,
        locationManager: cfg.locationManager,
        materialTransfer: cfg.materialTransfer,
        ...commitmentDeps,
    });
    const moveTasks = new MoveTaskRunner({
        gameState: cfg.gameState,
        runtimes: cfg.runtimes,
        assignments: cfg.assignments,
        settlerConfigs: cfg.settlerConfigs,
        handlerRegistry: cfg.handlerRegistry,
        animController: cfg.animController,
        outcomes,
        ...commitmentDeps,
    });
    const jobRunner = new JobRunner({
        gameState: cfg.gameState,
        eventBus: cfg.eventBus,
        choreoSystem: cfg.choreoSystem,
        runtimes: cfg.runtimes,
        handlerRegistry: cfg.handlerRegistry,
        animController: cfg.animController,
        jobPartResolver: new JobPartResolverImpl(),
        locationManager: cfg.locationManager,
        outcomes,
        moveTasks,
        commitmentWriter: cfg.commitmentWriter,
        teardown,
        handlerErrorLogger: cfg.handlerErrorLogger,
    });
    const jobs = new JobServiceImpl({
        gameState: cfg.gameState,
        runtimes: cfg.runtimes,
        owners,
        jobRunner,
        outcomes,
        pendingResumes: cfg.pendingResumes,
        ...commitmentDeps,
    });
    const unitRemoval = new UnitRemovalHandler({
        eventBus: cfg.eventBus,
        runtimes: cfg.runtimes,
        owners,
        assignments: cfg.assignments,
        idleCooldowns: cfg.idleCooldowns,
        teardown,
        ...commitmentDeps,
    });
    const resumeDeps: JobResumeDeps = {
        eventBus: cfg.eventBus,
        choreoSystem: cfg.choreoSystem,
        runtimes: cfg.runtimes,
        owners,
        ...commitmentDeps,
    };

    registerCoreOwners(owners, cfg);
    return { owners, outcomes, moveTasks, jobRunner, jobs, unitRemoval, resumeDeps };
}

/** settler-tasks owns the `Work` kind (XML jobs) and player-move commitments. */
function registerCoreOwners(owners: JobOwnerRegistry, cfg: JobRuntimeConfig): void {
    owners.registerKind(createWorkJobKind(cfg.gameState, cfg.choreographyStore));
    owners.registerHoldOwner({
        owner: 'player-move',
        persist: true,
        onUnitRemoved: () => {},
        onPreempted: () => {},
    });
}
