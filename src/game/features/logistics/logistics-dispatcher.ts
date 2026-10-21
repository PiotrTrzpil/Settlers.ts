/**
 * LogisticsDispatcher - Orchestrates demand fulfillment and carrier assignments.
 *
 * This is the integration layer between the logistics system and the carrier system.
 * Each tick, it:
 * 1. Walks the DemandLedger's standing orders in dispatch order
 * 2. Derives each order's deficit (target vs inventory + incoming jobs)
 * 3. Matches orders with a deficit to supplies (via RequestMatcher)
 * 4. Assigns the best carrier (idle or busy follow-up) via CarrierAssigner
 *
 * TransportJobStore is the single source of truth for material in motion;
 * records remove themselves on terminal transitions (TransportJobService).
 * The dispatcher's role is limited to: coordinating the sub-systems and
 * cancelling jobs when external events require it (building destroyed, etc.).
 * Carrier job outcomes (completion → queued follow-up, failure / death → records
 * discarded) are owned by the Transport JobKind handler (transport-job-kind.ts).
 */

import type { TickSystem } from '../../core/tick-system';
import type { CoreDeps } from '../feature';
import { type EventBus, EventSubscriptionManager } from '../../event-bus';
import { CLEANUP_PRIORITY } from '../../systems/entity-cleanup-registry';
import type { EntityCleanupRegistry } from '../../systems/entity-cleanup-registry';
import type { IdleCarrierPool } from '../carriers';
import type { DemandLedger, DemandTarget } from './demand-ledger';
import { computeDeficit } from './demand-deficit';
import { TransportPhase, type TransportJobRecord } from './transport-job-record';
import * as TransportJobService from './transport-job-service';
import type { TransportJobDeps } from './transport-job-service';
import type { TransportJobStore } from './transport-job-store';
import type { BuildingInventoryManager, StorageFilterManager } from '../inventory';
import { RequestMatcher } from './request-matcher';
import type { LogisticsMatchFilter, CarrierFilter } from './logistics-filter';
import { CarrierAssigner } from './carrier-assigner';
import { StallDetector } from './stall-detector';
import { MatchDiagnostics } from './match-diagnostics';
import { ThrottledEmitter } from './throttled-emitter';
import type { TransportJobAssigner } from './transport-job-kind';
import { JobKind } from '../../systems/choreo';
import type { UnitCommitmentQuery } from '../../systems/unit-commitment';
import { createLogger } from '@/utilities/logger';

const log = createLogger('LogisticsDispatcher');

/** Maximum number of job assignments per tick (to avoid frame drops) */
const MAX_ASSIGNMENTS_PER_TICK = 5;

/** Cooldown in seconds for throttled logistics events per material type. */
const EVENT_COOLDOWN_SEC = 5;

/** Configuration for LogisticsDispatcher dependencies */
export interface LogisticsDispatcherConfig extends CoreDeps {
    idleCarrierPool: IdleCarrierPool;
    /** Starts a record's Transport job (the Transport JobKind handler). */
    transportJobs: TransportJobAssigner;
    /** Who owns each unit — restore keeps only records whose carrier runs their job. */
    unitCommitments: UnitCommitmentQuery;
    transportJobDeps: TransportJobDeps;
    demandLedger: DemandLedger;
    jobStore: TransportJobStore;
    inventoryManager: BuildingInventoryManager;
    storageFilterManager?: StorageFilterManager;
    matchFilter?: LogisticsMatchFilter;
    carrierFilter?: CarrierFilter;
}

/**
 * Orchestrates demand fulfillment, supply matching, and carrier assignments.
 *
 * Composes RequestMatcher, CarrierAssigner, StallDetector, and MatchDiagnostics
 * to coordinate the full logistics dispatch loop each tick.
 */
export class LogisticsDispatcher implements TickSystem {
    /** Single source of truth for all active transport jobs. Public for feature wiring. */
    readonly jobStore: TransportJobStore;

    private readonly demandLedger: DemandLedger;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly unitCommitments: UnitCommitmentQuery;
    private readonly requestMatcher: RequestMatcher;
    private readonly carrierAssigner: CarrierAssigner;
    private readonly idleCarrierPool: IdleCarrierPool;
    private readonly stallDetector: StallDetector;
    private readonly matchDiagnostics: MatchDiagnostics;
    private readonly eventBus: EventBus;

    /** Dependencies for TransportJobService lifecycle operations. */
    private readonly transportJobDeps: TransportJobDeps;

    private readonly noMatchEmitter: ThrottledEmitter<'logistics:noMatch'>;
    private readonly noCarrierEmitter: ThrottledEmitter<'logistics:noCarrier'>;

    /** Event subscription manager for cleanup */
    private readonly subscriptions = new EventSubscriptionManager();

    constructor(config: LogisticsDispatcherConfig) {
        this.eventBus = config.eventBus;
        this.demandLedger = config.demandLedger;
        this.jobStore = config.jobStore;
        this.idleCarrierPool = config.idleCarrierPool;
        this.inventoryManager = config.inventoryManager;
        this.unitCommitments = config.unitCommitments;
        this.transportJobDeps = config.transportJobDeps;

        this.requestMatcher = new RequestMatcher({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
            jobStore: config.jobStore,
            storageFilterManager: config.storageFilterManager,
            matchFilter: config.matchFilter,
        });

        this.carrierAssigner = new CarrierAssigner({
            gameState: config.gameState,
            eventBus: config.eventBus,
            idleCarrierPool: config.idleCarrierPool,
            transportJobs: config.transportJobs,
            transportJobDeps: this.transportJobDeps,
            carrierFilter: config.carrierFilter,
        });

        this.stallDetector = new StallDetector({
            jobStore: config.jobStore,
            gameState: config.gameState,
        });

        this.matchDiagnostics = new MatchDiagnostics({
            gameState: config.gameState,
            inventoryManager: config.inventoryManager,
        });

        this.noMatchEmitter = new ThrottledEmitter(config.eventBus, 'logistics:noMatch', EVENT_COOLDOWN_SEC);
        this.noCarrierEmitter = new ThrottledEmitter(config.eventBus, 'logistics:noCarrier', EVENT_COOLDOWN_SEC);
    }

    /** Set the match filter for supply matching (territory, diplomacy, etc.). */
    setMatchFilter(filter: LogisticsMatchFilter | null): void {
        this.requestMatcher.matchFilter = filter;
    }

    /** Set the carrier eligibility filter (territory, etc.). */
    setCarrierFilter(filter: CarrierFilter | null): void {
        this.carrierAssigner.carrierFilter = filter;
    }

    /**
     * Register for carrier and entity events.
     *
     * Uses CLEANUP_PRIORITY.LOGISTICS to ensure building destruction handling fires
     * before inventory removal (inventory data must exist while cancelling jobs).
     */
    registerEvents(eventBus: EventBus, cleanupRegistry: EntityCleanupRegistry): void {
        // When a construction site completes, cancel all in-flight jobs targeting it.
        // The inventory is swapped from construction → production, so carriers
        // can no longer deposit construction materials there.
        this.subscriptions.subscribe(eventBus, 'building:completed', ({ buildingId }) =>
            this.handleConstructionCompleted(buildingId)
        );

        // Clean up logistics state when buildings are destroyed.
        // LOGISTICS priority ensures this runs before inventory removal (LATE priority).
        cleanupRegistry.onEntityRemoved(this.handleBuildingDestroyed.bind(this), CLEANUP_PRIORITY.LOGISTICS);
    }

    /** Unregister event handlers. */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Cleanup for HMR and game exit. */
    destroy(): void {
        this.unregisterEvents();
    }

    /**
     * After keyframe restore / hot reload (`onRestoreComplete`): records are persisted, and each
     * active record's carrier job is restored by the job runtime under its Transport commitment
     * (rebuilt from the record by the Transport handler in `onRestoreResume`). Here only:
     * - Queued follow-ups are cancelled — the deficit re-opens and the dispatcher re-plans;
     * - orphans (active records whose carrier is gone or has no Transport commitment for them)
     *   are discarded, releasing their stock claims.
     * Never touches the carriers' jobs: they are not resumed yet.
     */
    restoreJobs(): void {
        // oxlint-disable-next-line unicorn/no-useless-spread -- discard removes records; iterate a copy
        for (const record of [...this.jobStore.jobs.values()]) {
            if (record.phase === TransportPhase.Queued) {
                TransportJobService.discard(record, 'restore', this.transportJobDeps);
            } else if (!this.runsRecord(record)) {
                log.warn(`Job #${record.id}: carrier ${record.carrierId} does not run it after restore — discarding`);
                TransportJobService.discard(record, 'restore_orphan', this.transportJobDeps);
            }
        }
    }

    /** The record's carrier holds the Transport commitment for exactly this record. */
    private runsRecord(record: TransportJobRecord): boolean {
        const commitment = this.unitCommitments.get(record.carrierId);
        return commitment !== undefined && commitment.owner === JobKind.Transport && commitment.ref === record.id;
    }

    /**
     * Main tick — assign standing orders with a deficit to available carriers
     * and check for stalls.
     */
    tick(dt: number): void {
        this.noMatchEmitter.advance(dt);
        this.noCarrierEmitter.advance(dt);
        this.demandLedger.advanceTime(dt);
        this.matchDiagnostics.tick(dt);
        // One spatial rebuild for all carrier lookups this tick (assign + ranking).
        this.idleCarrierPool.beginFrame();
        this.assignPendingDemands();
        this.matchDiagnostics.markConsumed();
        this.stallDetector.tick(dt);
    }

    /**
     * Serve standing orders in dispatch order — at most one new job per order
     * per tick (keeps rotation fair), limited per tick to prevent frame drops.
     */
    private assignPendingDemands(): void {
        let assignmentCount = 0;

        for (const entry of this.demandLedger.getSortedEntries()) {
            if (assignmentCount >= MAX_ASSIGNMENTS_PER_TICK) {
                break; // Continue next tick
            }
            if (computeDeficit(entry, this.inventoryManager, this.jobStore) <= 0) {
                continue;
            }

            const request = { buildingId: entry.buildingId, materialType: entry.materialType, amount: 1 };
            const candidates = this.requestMatcher.matchRequestCandidates(request, 5);
            if (candidates.length === 0) {
                if (this.matchDiagnostics.isDue()) {
                    this.matchDiagnostics.logFailure(request);
                }
                this.emitNoMatchThrottled(entry);
                continue; // No supply available for this order
            }

            const result = this.carrierAssigner.tryAssignBest(request, candidates);
            if (result.status === 'no_carrier') {
                this.emitNoCarrierThrottled(entry, candidates[0]!.sourceBuilding);
                continue;
            }
            if (result.status === 'assigned') {
                this.demandLedger.markServed(entry);
                assignmentCount++;
            }
            // failed: reservation/movement — retry next tick; no markServed
        }
    }

    /** Emit `logistics:noMatch` at most once per cooldown per material type. */
    private emitNoMatchThrottled(entry: DemandTarget): void {
        const key = `${entry.materialType}`;
        const s = this.requestMatcher.lastRejectionStats;
        this.noMatchEmitter.tryEmit(key, {
            buildingId: entry.buildingId,
            materialType: entry.materialType,
            rejection: s
                ? {
                      supplies: s.suppliesFound,
                      sourceIds: s.sourceIds,
                      self: s.self,
                      storageBlocked: s.storageBlocked,
                      reserved: s.fullyReserved,
                      filter: s.filterRejected,
                  }
                : undefined,
        });
    }

    /** Emit `logistics:noCarrier` at most once per cooldown per material type. */
    private emitNoCarrierThrottled(entry: DemandTarget, sourceBuilding: number): void {
        const key = `${entry.materialType}`;
        this.noCarrierEmitter.tryEmit(key, {
            buildingId: entry.buildingId,
            materialType: entry.materialType,
            sourceBuilding,
        });
    }

    /**
     * Cancel all transport jobs targeting a building that just finished construction.
     *
     * When a construction site completes, its inventory is swapped from construction
     * (input slots for BOARD/STONE) to production (output slots). Any in-flight
     * carriers targeting the old construction inventory must be cancelled to prevent
     * deposit failures. Standing orders are NOT touched here — MaterialRequestSystem
     * owns them and replaces the construction orders with operational ones on the
     * same event (handler order between the two must not matter).
     */
    private handleConstructionCompleted(buildingId: number): void {
        let jobsCancelled = 0;
        // oxlint-disable-next-line unicorn/no-useless-spread -- cancel mutates the index; iterate a copy
        for (const jobId of [...this.jobStore.byBuilding.get(buildingId)]) {
            const job = this.jobStore.get(jobId);
            if (!job) {
                throw new Error(`No job ${jobId} in LogisticsDispatcher.handleConstructionCompleted`);
            }
            if (job.destBuilding === buildingId) {
                TransportJobService.cancel(job, 'construction_completed', this.transportJobDeps);
                jobsCancelled++;
            }
        }

        if (jobsCancelled > 0) {
            this.eventBus.emit('logistics:buildingCleanedUp', {
                buildingId,
                targetsCleared: 0,
                jobsCancelled,
            });
        }
    }

    /**
     * Cleanup when a building is destroyed.
     *
     * Cancels all active TransportJobs involving the building (except carriers
     * already en route with material from it — they may still deliver) and
     * clears the building's standing orders.
     */
    handleBuildingDestroyed(buildingId: number): BuildingCleanupResult {
        const result: BuildingCleanupResult = {
            buildingId,
            targetsCleared: 0,
            jobsCancelled: 0,
        };

        // oxlint-disable-next-line unicorn/no-useless-spread -- cancel mutates the index; iterate a copy
        for (const jobId of [...this.jobStore.byBuilding.get(buildingId)]) {
            const job = this.jobStore.get(jobId);
            if (!job) {
                throw new Error(`No job ${jobId} in LogisticsDispatcher.handleBuildingDestroyed`);
            }
            // Already picked up from source — let carrier deliver
            if (job.sourceBuilding === buildingId && job.phase === TransportPhase.PickedUp) {
                continue;
            }
            TransportJobService.cancel(job, 'building_destroyed', this.transportJobDeps);
            result.jobsCancelled++;
        }

        result.targetsCleared = this.demandLedger.clearBuilding(buildingId);

        this.eventBus.emit('logistics:buildingCleanedUp', result);

        if (result.targetsCleared + result.jobsCancelled > 0) {
            log.debug(
                `Building ${buildingId} cleanup: ` +
                    `${result.targetsCleared} targets cleared, ${result.jobsCancelled} jobs cancelled`
            );
        }

        return result;
    }
}

/**
 * Result of building destruction cleanup.
 */
export interface BuildingCleanupResult {
    buildingId: number;
    targetsCleared: number;
    jobsCancelled: number;
}
