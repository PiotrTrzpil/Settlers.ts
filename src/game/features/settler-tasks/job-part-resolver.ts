/**
 * JobPartResolver — maps jobPart strings from jobInfo.xml to animation sequence keys.
 *
 * Since sequence keys ARE the XML jobPart names, this is now a direct pass-through.
 * The only logic is determining loop/stopped behaviour from the action suffix.
 */

import { stripXmlPrefix } from '../../renderer/sprite-metadata';
import { EMaterialType } from '../../economy';
import { xmlKey } from '../../animation/animation';
import type { Entity } from '../../entity';
import type { JobPartResolution, JobPartResolver } from './choreo-types';

/**
 * Determine if a jobPart action suffix is a one-shot (non-looping) animation.
 * Pickup/drop animations play once; everything else loops or idles.
 */
function isOneShot(action: string): boolean {
    return action.startsWith('PICKUP') || action.startsWith('DOWN') || action.startsWith('DROP');
}

/** Determine if a jobPart action suffix is an idle/standing pose. */
function isIdle(action: string): boolean {
    return action === 'IDLE' || action.startsWith('IDLE') || action === 'STRIKE2';
}

/**
 * Resolves jobPart strings from jobInfo.xml to concrete animation sequence keys.
 *
 * Since SETTLER_JOB_INDICES field names ARE the XML jobPart names, and animations
 * are registered under those same names, this is a direct pass-through.
 * The only logic is determining loop/stopped behaviour.
 */
export class JobPartResolverImpl implements JobPartResolver {
    resolve(jobPart: string, settler: Entity): JobPartResolution {
        // For C_WALK: if the carrier is holding something, use the material-specific carry walk.
        // The XML always emits C_WALK for both empty and loaded segments — the engine resolves it dynamically.
        if (jobPart === 'C_WALK' && settler.carrying) {
            const materialName = EMaterialType[settler.carrying.material];
            if (!materialName) {
                throw new Error(`Unknown EMaterialType: ${settler.carrying.material}`);
            }
            jobPart = xmlKey('C', `WALK_${materialName}`);
        }

        const action = stripXmlPrefix(jobPart);

        if (isIdle(action)) {
            return { sequenceKey: jobPart, loop: false, stopped: true };
        }

        if (isOneShot(action)) {
            return { sequenceKey: jobPart, loop: false, stopped: false };
        }

        // Everything else (WALK, WALK_*, FIGHT, SHOOT, WORK, CUT_TREE, etc.) loops
        return { sequenceKey: jobPart, loop: true, stopped: false };
    }
}
