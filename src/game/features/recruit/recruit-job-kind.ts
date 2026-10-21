/**
 * Recruit JobKind — player-queued and direct transforms (a job that is just the recruit segment).
 *
 * ref = 0 (the queue is keyed by unit type, not by an entity). The source reservation belongs to
 * the TRANSFORM_* node (its hooks release / re-reserve it), so the handler callbacks have no
 * domain state to clean up: the queue entry was consumed at dispatch, as before.
 */

import { JobKind, type JobKindHandler, type JobSpec } from '../../systems/choreo';
import { createLogger } from '@/utilities/logger';
import type { RecruitSegment, RecruitSegments } from './recruit-segments';

const log = createLogger('RecruitJobKind');

export type RecruitJobParams = { readonly segment: RecruitSegment };

/** Job id (display / events) of a recruit job — kept from the legacy AUTO_RECRUIT / BUILDING_RECRUIT jobs. */
function recruitJobId(segment: RecruitSegment): string {
    return segment.source === 'building' ? 'BUILDING_RECRUIT' : 'AUTO_RECRUIT';
}

/** The JobSpec of a stand-alone recruit job (reserved: player moves are rejected until it ends). */
export function recruitJobSpec(segment: RecruitSegment): JobSpec<RecruitJobParams> {
    return { kind: JobKind.Recruit, ref: 0, params: { segment }, reserved: true };
}

export function createRecruitJobKind(segments: RecruitSegments): JobKindHandler<RecruitJobParams> {
    return {
        kind: JobKind.Recruit,
        persist: true,
        build: (_unitId, { segment }) => segments.prefix(segment, { jobId: recruitJobId(segment), nodes: [] }),
        onCompleted: () => {},
        onFailed: (unitId, _ref, { segment }, info) => {
            log.debug(`Recruit of carrier ${unitId} → ${segment.targetUnitType} ended early (${info.reason})`);
        },
        onUnitRemoved: unitId => {
            log.debug(`Recruiting carrier ${unitId} removed`);
        },
    };
}
