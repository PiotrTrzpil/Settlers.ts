/**
 * Work handler registry for settler tasks.
 *
 * Manages registration and lookup of entity/position work handlers
 * that domain systems register to plug into the settler task system.
 * A search type can have one entity handler and one position handler.
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
    private readonly entityHandlers = new Map<SearchType, EntityWorkHandler>();
    private readonly positionHandlers = new Map<SearchType, PositionWorkHandler>();

    /**
     * Register a work handler for a search type.
     * Domain systems call this to plug into the task system.
     * A search type can have one entity handler and one position handler.
     */
    register(searchType: SearchType, handler: WorkHandler): void {
        if (handler.type === WorkHandlerType.ENTITY) {
            if (this.entityHandlers.has(searchType)) {
                throw new Error(`Entity work handler already registered for ${searchType}.`);
            }
            this.entityHandlers.set(searchType, handler);
        } else {
            if (this.positionHandlers.has(searchType)) {
                throw new Error(`Position work handler already registered for ${searchType}.`);
            }
            this.positionHandlers.set(searchType, handler);
        }
    }

    getEntityHandler(searchType: SearchType): EntityWorkHandler | undefined {
        return this.entityHandlers.get(searchType);
    }

    getPositionHandler(searchType: SearchType): PositionWorkHandler | undefined {
        return this.positionHandlers.get(searchType);
    }

    hasAnyHandler(searchType: SearchType): boolean {
        return this.entityHandlers.has(searchType) || this.positionHandlers.has(searchType);
    }

    /**
     * Reverse-lookup: find the entity work handler for a given XML job ID (e.g. 'JOB_WOODCUTTER_WORK').
     * Used during cleanup to call onWorkInterrupt when a settler entity is removed.
     */
    findEntityHandlerForJob(jobId: string, settlerConfigs: SettlerConfigMap): EntityWorkHandler | undefined {
        for (const [, config] of settlerConfigs) {
            if (config.jobs.includes(jobId)) {
                return this.entityHandlers.get(config.search);
            }
        }
        return undefined;
    }
}
