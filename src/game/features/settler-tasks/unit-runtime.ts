/**
 * Unit runtime record and its store.
 *
 * `UnitRuntimeStore` is the only place a `UnitRuntime` is created: every unit gets
 * one lazily on first use (tick, job assignment, worker assignment, restore), with a
 * staggered first idle search. JobRunner, WorkerAssignments, WorkerAutonomy and the
 * lifecycle coordinator all read and write the same records through this store.
 */

import { IndexedMap, type Index } from '@/game/utils/indexed-map';
import { SettlerState, type JobState, type HomeAssignment } from './types';
import type { IdleAnimationController, IdleAnimationState } from './idle-animation-controller';
import { initialSearchStagger, type IdleSearchCooldowns } from './idle-search-cooldowns';

/** Simple move task state (for user-initiated movement) */
export interface MoveTaskState {
    type: 'move';
    targetX: number;
    targetY: number;
}

/** Full runtime state for each unit. */
export interface UnitRuntime {
    state: SettlerState;
    /** Current choreography job — null when idle. */
    job: JobState | null;
    /** Simple move task (for user commands) */
    moveTask: MoveTaskState | null;
    /** Last known direction (for change detection) */
    lastDirection: number;
    /** Idle animation state */
    idleState: IdleAnimationState;
    /** Workplace building assignment — null when unassigned or building destroyed. */
    homeAssignment: HomeAssignment | null;
    /** Whether this unit is ready for an idle work search (driven by IdleSearchCooldowns). */
    idleSearchReady: boolean;
}

export class UnitRuntimeStore {
    private readonly runtimes = new IndexedMap<number, UnitRuntime>();

    constructor(
        private readonly animController: IdleAnimationController,
        private readonly idleCooldowns: IdleSearchCooldowns
    ) {}

    get size(): number {
        return this.runtimes.size;
    }

    get(entityId: number): UnitRuntime | undefined {
        return this.runtimes.get(entityId);
    }

    has(entityId: number): boolean {
        return this.runtimes.has(entityId);
    }

    /** Get the unit's runtime, creating it (idle, staggered first search) on first use. */
    getOrCreate(entityId: number): UnitRuntime {
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
            this.idleCooldowns.start(entityId, runtime, initialSearchStagger(entityId));
        }
        return runtime;
    }

    delete(entityId: number): void {
        this.runtimes.delete(entityId);
    }

    /** Re-evaluate secondary indexes after a unit's homeAssignment changed. */
    reindex(entityId: number): void {
        this.runtimes.reindex(entityId);
    }

    addIndex<IK>(keyFn: (entityId: number, runtime: UnitRuntime) => IK | null): Index<IK, number> {
        return this.runtimes.addIndex(keyFn);
    }

    keys(): IterableIterator<number> {
        return this.runtimes.keys();
    }

    /** Runtimes in insertion order. */
    [Symbol.iterator](): IterableIterator<[number, UnitRuntime]> {
        return this.runtimes[Symbol.iterator]();
    }
}
