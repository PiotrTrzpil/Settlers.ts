/**
 * Work handler registry for settler tasks.
 *
 * Manages registration and lookup of work handlers that domain systems
 * register to plug into the settler task system. A search type maps to
 * exactly one handler (entity, position, or null).
 */

import type { SettlerConfig } from './types';
import {
    SearchType,
    WorkHandlerType,
    type EntityWorkHandler,
    type PositionWorkHandler,
    type WorkHandler,
} from './types';
import type { UnitType } from '../../entity';

/** Map of UnitType to settler configuration (for reverse-lookup by job ID). */
export type SettlerConfigMap = ReadonlyMap<UnitType, SettlerConfig>;

export class WorkHandlerRegistry {
    private readonly handlers = new Map<SearchType, WorkHandler>();

    /**
     * Register a work handler for a search type.
     * Domain systems call this to plug into the task system.
     * Each search type may have exactly one handler (entity, position, or null).
     */
    register(searchType: SearchType, handler: WorkHandler): void {
        if (this.handlers.has(searchType)) {
            throw new Error(`Work handler already registered for ${searchType}`);
        }
        this.handlers.set(searchType, handler);
    }

    getEntityHandler(searchType: SearchType): EntityWorkHandler | undefined {
        const h = this.handlers.get(searchType);
        return h?.type === WorkHandlerType.ENTITY ? h : undefined;
    }

    getPositionHandler(searchType: SearchType): PositionWorkHandler | undefined {
        const h = this.handlers.get(searchType);
        return h?.type === WorkHandlerType.POSITION ? h : undefined;
    }

    hasAnyHandler(searchType: SearchType): boolean {
        return this.handlers.has(searchType);
    }

    /**
     * Reverse-lookup: find the entity work handler for a given XML job ID (e.g. 'JOB_WOODCUTTER_WORK').
     * Used during cleanup to call onWorkInterrupt when a settler entity is removed.
     */
    findEntityHandlerForJob(jobId: string, settlerConfigs: SettlerConfigMap): EntityWorkHandler | undefined {
        for (const [, config] of settlerConfigs) {
            if (config.jobs.includes(jobId)) {
                return this.getEntityHandler(config.search);
            }
        }
        return undefined;
    }
}
