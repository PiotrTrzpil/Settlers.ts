/**
 * The `Barracks` job kind (docs/designs/job-ownership.md, "Barracks migration").
 *
 * A training carrier runs one reserved Barracks job (ref = barracks id, params
 * `{ barracksId, recipeIndex, unitType }`): the recruit segment with the barracks' input
 * materials as its source (walk to the door + TRANSFORM_RECRUIT_BUILDING), then WAIT(FIGHT) at
 * the door as the new soldier. The material reservation belongs to the TRANSFORM node (its hooks
 * release / re-reserve it); the handler only keeps the manager's active-training state in sync.
 *
 * Training ends at the transform (`unit:recruited`), so a job that ends during the FIGHT wait
 * no longer has a training to interrupt. The recipe stays consumed when the job ends early.
 */

import type { GameState } from '@/game/game-state';
import type { UnitType } from '@/game/core/unit-types';
import { BuildingType } from '@/game/buildings/building-type';
import { getBuildingDoorPos } from '@/game/data/game-data-access';
import { ChoreoTaskType, JobKind, choreo, type JobKindHandler, type JobSpec } from '@/game/systems/choreo';
import type { BuildingRecruitChargeFn, RecruitSegment, RecruitSegments } from '@/game/features/recruit';
import { UNIT_XML_PREFIX } from '@/game/renderer/sprite-metadata';
import { xmlKey } from '@/game/animation/animation';
import type { BarracksTrainingManager } from './barracks-training-manager';
import { getRecipeForTargetUnitType } from './training-recipes';

/** Training duration in animation frames (at 10fps = 3 seconds). */
export const TRAINING_DURATION_FRAMES = 30;

/** Params of a Barracks job: the barracks, the recipe being trained and the unit type it trains. */
export type BarracksJobParams = {
    readonly barracksId: number;
    readonly recipeIndex: number;
    /** Target unit type at the recipe's level (e.g. Swordsman2). */
    readonly unitType: UnitType;
};

/** The JobSpec of a training job (reserved: player moves are rejected until it ends). */
export function barracksJobSpec(params: BarracksJobParams): JobSpec<BarracksJobParams> {
    return { kind: JobKind.Barracks, ref: params.barracksId, params, reserved: true };
}

/** What a barracks charges for a transform: the inputs of the recipe that trains the unit type. */
export function createBarracksRecruitCharge(gameState: GameState): BuildingRecruitChargeFn {
    return (barracksId, targetUnitType) => {
        const barracks = gameState.getEntityOrThrow(barracksId, 'barracks recruit charge');
        return { costs: getRecipeForTargetUnitType(barracks.race, targetUnitType).inputs, side: 'input' };
    };
}

export interface BarracksJobKindDeps {
    gameState: GameState;
    segments: RecruitSegments;
    manager: BarracksTrainingManager;
}

/** The Barracks kind handler — owner of training carriers' jobs. */
export function createBarracksJobKind(deps: BarracksJobKindDeps): JobKindHandler<BarracksJobParams> {
    const { gameState, segments, manager } = deps;
    return {
        kind: JobKind.Barracks,
        persist: true,
        restorable: (_unitId, _ref, params) => manager.isBarracks(params.barracksId),
        build: (_unitId, params) => {
            const barracks = gameState.getEntityOrThrow(params.barracksId, 'barracks of a training job');
            const door = getBuildingDoorPos(barracks, barracks.race, BuildingType.Barrack);
            const segment: RecruitSegment = {
                targetUnitType: params.unitType,
                source: 'building',
                sourceId: params.barracksId,
                at: { x: door.x, y: door.y },
            };
            const fightJobPart = xmlKey(UNIT_XML_PREFIX[params.unitType]!, 'FIGHT');
            const training = choreo('BARRACKS_TRAINING')
                .addNode(ChoreoTaskType.WAIT, { duration: TRAINING_DURATION_FRAMES, jobPart: fightJobPart })
                .target(params.barracksId)
                .toJobBuild();
            return segments.prefix(segment, training);
        },
        // The training already completed at the transform (unit:recruited).
        onCompleted: () => {},
        onFailed: (unitId, ref, _params, info) => manager.interruptTraining(ref, unitId, info.reason),
        onUnitRemoved: (unitId, ref) => manager.interruptTraining(ref, unitId, 'carrier_killed'),
    };
}
