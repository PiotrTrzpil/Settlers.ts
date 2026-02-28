/**
 * JobPartResolver — maps jobPart strings from jobInfo.xml to animation sequence keys.
 *
 * jobPart names follow the pattern {PREFIX}_{ACTION}, e.g.:
 *   WC_WALK, WC_CUT_TREE, WC_PICKUP_LOG, WC_WALK_LOG
 *   BA_WALK, BA_WORK_DOUGH, BA_PICKUP_WATER
 *   FG_WALK, FG_SEED_PLANTS, FG_CUT_GRAIN
 *
 * Resolution rules (applied in order):
 *   1. Exact override for exceptions (H_SHOOT, G_SEARCH, etc.)
 *   2. Suffix *_WALK → walk (carry upgrade if entity is carrying); *_WALK_X → carry.x
 *   3. Suffix *_PICKUP* or *_DROP* → short work (one-shot)
 *   4. Suffix *_IDLE* → idle (stopped)
 *   5. Suffix *_FIGHT / *_SHOOT / *_THROW_STONE / *_HEAL → fight
 *   6. Anything else → looping work
 */

import {
    ANIMATION_SEQUENCES,
    carrySequenceKey,
    fightSequenceKey,
    pickupSequenceKey,
    workSequenceKey,
} from '../../animation';
import type { Entity } from '../../entity';
import { LogHandler } from '@/utilities/log-handler';
import type { JobPartResolution, JobPartResolver } from './choreo-types';

// ─────────────────────────────────────────────────────────────
// Pre-built resolution constants
// ─────────────────────────────────────────────────────────────

const IDLE_RESOLUTION: JobPartResolution = {
    sequenceKey: ANIMATION_SEQUENCES.DEFAULT,
    loop: false,
    stopped: true,
};

const WALK_RESOLUTION: JobPartResolution = {
    sequenceKey: ANIMATION_SEQUENCES.WALK,
    loop: true,
    stopped: false,
};

const WORK_RESOLUTION: JobPartResolution = {
    sequenceKey: workSequenceKey(0),
    loop: true,
    stopped: false,
};

/** One-shot work (e.g., carrier strike, fisher rod throw). Not a pickup. */
const SHORT_WORK_RESOLUTION: JobPartResolution = {
    sequenceKey: workSequenceKey(0),
    loop: false,
    stopped: false,
};

// ─────────────────────────────────────────────────────────────
// Exact overrides — only entries that differ from suffix heuristics
//
// Most jobParts resolve correctly via suffix rules:
//   WALK_* → walk, PICKUP_* → short work, DROP_* → short work,
//   IDLE* → idle, FIGHT/SHOOT/THROW_STONE/HEAL → fight,
//   anything else with known prefix → looping work.
//
// This map is only for the exceptions.
// ─────────────────────────────────────────────────────────────

const EXACT_OVERRIDES: ReadonlyMap<string, JobPartResolution> = new Map<string, JobPartResolution>([
    // Carrier strike: enter-strike is a one-shot work, wait-strike is standing idle
    ['C_STRIKE1', SHORT_WORK_RESOLUTION],
    ['C_STRIKE2', IDLE_RESOLUTION],
    ['C_DOWN_NONE', IDLE_RESOLUTION],

    // Geologist searching = walking around the terrain
    ['G_SEARCH', WALK_RESOLUTION],

    // Fisher throwing rod is a one-shot work action, not the THROW_STONE fight variant
    ['FI_THROW_ROD', SHORT_WORK_RESOLUTION],
]);

// ─────────────────────────────────────────────────────────────
// Suffix heuristics
// ─────────────────────────────────────────────────────────────

/** Return true if action suffix represents walking (with or without cargo). */
function isWalkSuffix(action: string): boolean {
    // Matches: WALK, WALK_LOG, WALK_BREAD, WALK_EMPTYBASKET, etc.
    return action === 'WALK' || action.startsWith('WALK_');
}

/** Return true if action suffix is a pickup or drop (one-shot, non-looping). */
function isPickupOrDropSuffix(action: string): boolean {
    return action === 'PICKUP' || action.startsWith('PICKUP_') || action === 'DROP' || action.startsWith('DROP_');
}

/**
 * Extract the pickup variant key from a PICKUP/DROP action suffix.
 *
 * Maps to the JIL field name suffix registered by sprite-unit-loader:
 *   PICKUP       → '0'     (generic — matches JIL field 'pickup')
 *   PICKUP_COAL  → 'coal'  (material-specific — matches 'pickup_coal')
 *   DROP         → '0'     (generic fallback)
 *   DROP_GOODS   → '0'     (no dedicated drop animation in JIL — use generic)
 */
function pickupVariant(action: string): string {
    if (action.startsWith('PICKUP_')) return action.slice('PICKUP_'.length).toLowerCase();
    return '0';
}

/** Return true if action suffix represents idle standing. */
function isIdleSuffix(action: string): boolean {
    return action === 'IDLE' || action.startsWith('IDLE');
}

/** Return true if action suffix is a fight animation. */
function isFightSuffix(action: string): boolean {
    return action === 'FIGHT' || action === 'SHOOT' || action === 'THROW_STONE' || action === 'HEAL';
}

// ─────────────────────────────────────────────────────────────
// JobPartResolverImpl
// ─────────────────────────────────────────────────────────────

/**
 * Resolves jobPart strings from jobInfo.xml to concrete animation sequence keys
 * that EntityVisualService can play.
 *
 * Resolution order:
 *  1. Exact override (only for exceptions that break suffix rules)
 *  2. Suffix heuristics (WALK_*, PICKUP_*, DROP_*, IDLE*, FIGHT, SHOOT, …)
 *  3. Carry check when carrying (walk-with-carry variant)
 *  4. Fallback: looping work
 */
export class JobPartResolverImpl implements JobPartResolver {
    private readonly log = new LogHandler('JobPartResolver');

    /**
     * Resolve a jobPart string to a JobPartResolution.
     * Never returns null — unknown jobParts fall back to idle with a warning.
     */
    resolve(jobPart: string, settler: Entity): JobPartResolution {
        // 1. Exact override — highest priority
        const exact = EXACT_OVERRIDES.get(jobPart);
        if (exact !== undefined) {
            // For walk-with-cargo overrides, upgrade to carry animation if entity is carrying
            if (exact === WALK_RESOLUTION && settler.carrying) {
                return this.carryResolution(settler.carrying.material);
            }
            return exact;
        }

        // 2. Split on first underscore to get prefix + action
        const sep = jobPart.indexOf('_');
        if (sep === -1) {
            // No underscore — treat as walk of the bare prefix
            this.log.warn(`JobPartResolver: jobPart '${jobPart}' has no '_' separator, defaulting to idle`);
            return IDLE_RESOLUTION;
        }

        const action = jobPart.slice(sep + 1); // e.g., 'WALK', 'CUT_TREE', 'FIGHT'

        // 3. Suffix heuristics

        if (isWalkSuffix(action)) {
            if (action !== 'WALK') {
                // Walk-with-cargo suffix (e.g., WALK_COAL, WALK_LOG): use suffix as carry variant
                return this.carryResolution(action.slice('WALK_'.length).toLowerCase());
            }
            // Plain WALK: upgrade to carry if entity is carrying, otherwise normal walk
            if (settler.carrying) {
                return this.carryResolution(settler.carrying.material);
            }
            return WALK_RESOLUTION;
        }

        if (isPickupOrDropSuffix(action)) {
            return this.pickupResolution(pickupVariant(action));
        }

        if (isIdleSuffix(action)) {
            return IDLE_RESOLUTION;
        }

        if (isFightSuffix(action)) {
            return this.fightResolution(settler);
        }

        // 4. Fallback — any prefixed jobPart with an unrecognized action is assumed to be work
        return WORK_RESOLUTION;
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private carryResolution(material: number | string): JobPartResolution {
        return {
            sequenceKey: carrySequenceKey(material),
            loop: true,
            stopped: false,
        };
    }

    private pickupResolution(variant: string | number): JobPartResolution {
        return {
            sequenceKey: pickupSequenceKey(variant),
            loop: false,
            stopped: false,
        };
    }

    private fightResolution(settler: Entity): JobPartResolution {
        const level = settler.level ?? 1;
        return {
            sequenceKey: fightSequenceKey(level - 1),
            loop: true,
            stopped: false,
        };
    }
}
