/**
 * recruit_specialist command handler — enqueue recruitment, or dequeue/dismiss for negative counts.
 */

import type { CommandResult, RecruitSpecialistCommand } from '../../commands/command-types';
import { commandFailed, COMMAND_OK } from '../../commands/command-types';
import { SPECIALIST_TOOL_MAP } from './specialist-tool-map';
import type { RecruitSystem } from './recruit-system';
import type { UnitTransformer } from './unit-transformer';

export interface RecruitSpecialistDeps {
    recruitSystem: RecruitSystem;
    unitTransformer: UnitTransformer;
}

export function executeRecruitSpecialist(deps: RecruitSpecialistDeps, cmd: RecruitSpecialistCommand): CommandResult {
    const toolMaterial = SPECIALIST_TOOL_MAP[cmd.unitType];
    if (toolMaterial === undefined) {
        return commandFailed(`Unknown specialist type: ${cmd.unitType}`);
    }

    if (cmd.count > 0) {
        const near = cmd.nearX !== undefined && cmd.nearY !== undefined ? { x: cmd.nearX, y: cmd.nearY } : null;
        deps.recruitSystem.enqueue(cmd.unitType, cmd.count, toolMaterial, cmd.player, cmd.race, near);
    } else if (cmd.count < 0) {
        let remaining = -cmd.count;
        // Drain queue first
        const queued = deps.recruitSystem.getQueuedCount(cmd.unitType);
        const fromQueue = Math.min(remaining, queued);
        if (fromQueue > 0) {
            deps.recruitSystem.dequeue(cmd.unitType, fromQueue);
            remaining -= fromQueue;
        }
        // Dismiss live specialists for the remainder
        for (let i = 0; i < remaining; i++) {
            if (!deps.unitTransformer.dismissSpecialist(cmd.unitType, toolMaterial, cmd.player)) {
                break;
            }
        }
    }

    return COMMAND_OK;
}
