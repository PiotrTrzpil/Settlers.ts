/**
 * Pioneer Feature — FeatureDefinition wiring for pioneer territory claiming.
 *
 * Pioneers are specialist units that claim unclaimed map tiles for their player.
 * They are activated by a move command, then autonomously search for and claim
 * nearby unclaimed tiles using the TERRAIN search type.
 *
 * This feature registers:
 * - A PositionWorkHandler for TERRAIN search type
 * - A code-defined choreography job (SEARCH → GO_TO_POS → WORK) for pioneers
 *
 * Public API (via exports): none (self-contained).
 */

import type { FeatureDefinition, FeatureContext } from '../feature';
import type { SettlerTaskExports } from '../settler-tasks';
import type { TerritoryExports } from '../territory';
import { SearchType } from '../settler-tasks';
import { ChoreoTaskType, type ChoreoJob } from '../../systems/choreo';
import { createPioneerHandler } from './work-handlers';

/** Job ID for the code-defined pioneer choreography. */
const PIONEER_JOB_ID = 'PIONEER_CLAIM_TILE';

/** Duration of the pioneer work animation in frames (converted to seconds by the executor). */
const WORK_DURATION_FRAMES = 30;

/** Build the code-defined choreography job: SEARCH → GO_TO_POS → WORK. */
function buildPioneerJob(): ChoreoJob {
    return {
        id: PIONEER_JOB_ID,
        nodes: [
            {
                task: ChoreoTaskType.SEARCH,
                jobPart: '',
                x: 0,
                y: 0,
                duration: 0,
                dir: -1,
                forward: true,
                visible: true,
                useWork: false,
                entity: '',
                trigger: '',
            },
            {
                task: ChoreoTaskType.GO_TO_POS,
                jobPart: '',
                x: 0,
                y: 0,
                duration: 0,
                dir: -1,
                forward: true,
                visible: true,
                useWork: false,
                entity: '',
                trigger: '',
            },
            {
                task: ChoreoTaskType.WORK,
                jobPart: 'P_SHOVEL',
                x: 0,
                y: 0,
                duration: WORK_DURATION_FRAMES,
                dir: -1,
                forward: true,
                visible: true,
                useWork: false,
                entity: '',
                trigger: '',
            },
        ],
    };
}

export const PioneerFeature: FeatureDefinition = {
    id: 'pioneer',
    dependencies: ['settler-tasks', 'territory'],

    create(ctx: FeatureContext) {
        const { settlerTaskSystem } = ctx.getFeature<SettlerTaskExports>('settler-tasks');
        const { territoryManager } = ctx.getFeature<TerritoryExports>('territory');

        // Register the code-defined choreography job so selectJob can resolve it
        settlerTaskSystem.getChoreographyStore().registerCodeDefinedJob(buildPioneerJob());

        // Register position work handler for TERRAIN search type
        settlerTaskSystem.registerWorkHandler(
            SearchType.TERRAIN,
            createPioneerHandler(ctx.gameState, ctx.terrain, territoryManager)
        );

        return { persistence: 'none' };
    },
};
