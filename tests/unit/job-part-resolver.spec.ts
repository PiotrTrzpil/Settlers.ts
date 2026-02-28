/**
 * Unit tests for JobPartResolverImpl.
 *
 * Verifies that jobPart strings from jobInfo.xml are mapped to the correct
 * animation sequence keys with the correct loop/stopped flags.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JobPartResolverImpl } from '@/game/features/settler-tasks/job-part-resolver';
import {
    ANIMATION_SEQUENCES,
    carrySequenceKey,
    fightSequenceKey,
    pickupSequenceKey,
    workSequenceKey,
} from '@/game/animation';
import { EntityType, UnitType } from '@/game/entity';
import { Race } from '@/game/race';
import type { Entity } from '@/game/entity';
import type { JobPartResolution } from '@/game/features/settler-tasks/choreo-types';
import { EMaterialType } from '@/game/economy';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSettler(overrides: Partial<Entity> = {}): Entity {
    return {
        id: 1,
        type: EntityType.Unit,
        x: 10,
        y: 10,
        player: 0,
        subType: UnitType.Woodcutter,
        race: Race.Roman,
        ...overrides,
    };
}

function makeCarryingSettler(material: EMaterialType, subType: UnitType = UnitType.Woodcutter): Entity {
    return makeSettler({
        subType,
        carrying: { material, amount: 1 },
    });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('JobPartResolverImpl', () => {
    let resolver: JobPartResolverImpl;

    beforeEach(() => {
        resolver = new JobPartResolverImpl();
    });

    // ── Woodcutter ────────────────────────────────────────────────────────────

    describe('Woodcutter (WC_*)', () => {
        it('WC_WALK resolves to walk (loop)', () => {
            const result = resolver.resolve('WC_WALK', makeSettler());
            expect(result).toMatchObject<JobPartResolution>({
                sequenceKey: ANIMATION_SEQUENCES.WALK,
                loop: true,
                stopped: false,
            });
        });

        it('WC_CUT_TREE resolves to work.0 (loop)', () => {
            const result = resolver.resolve('WC_CUT_TREE', makeSettler());
            expect(result).toMatchObject<JobPartResolution>({
                sequenceKey: workSequenceKey(0),
                loop: true,
                stopped: false,
            });
        });

        it('WC_PICKUP_LOG resolves to pickup.log (material-specific)', () => {
            const result = resolver.resolve('WC_PICKUP_LOG', makeSettler());
            expect(result).toMatchObject<JobPartResolution>({
                sequenceKey: pickupSequenceKey('log'),
                loop: false,
                stopped: false,
            });
        });

        it('WC_WALK_LOG while carrying resolves to carry animation', () => {
            const settler = makeCarryingSettler(EMaterialType.LOG);
            const result = resolver.resolve('WC_WALK_LOG', settler);
            expect(result).toMatchObject<JobPartResolution>({
                sequenceKey: carrySequenceKey(EMaterialType.LOG),
                loop: true,
                stopped: false,
            });
        });

        it('WC_WALK_LOG without carrying resolves to walk', () => {
            const result = resolver.resolve('WC_WALK_LOG', makeSettler());
            expect(result).toMatchObject<JobPartResolution>({
                sequenceKey: ANIMATION_SEQUENCES.WALK,
                loop: true,
                stopped: false,
            });
        });
    });

    // ── Stonecutter ───────────────────────────────────────────────────────────

    describe('Stonecutter (ST_*)', () => {
        it('ST_WALK resolves to walk', () => {
            const result = resolver.resolve('ST_WALK', makeSettler({ subType: UnitType.Stonecutter }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
            expect(result.loop).toBe(true);
        });

        it('ST_HACK resolves to work.0 (loop)', () => {
            const result = resolver.resolve('ST_HACK', makeSettler({ subType: UnitType.Stonecutter }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('ST_PICKUP resolves to pickup.0 (generic, no material suffix)', () => {
            const result = resolver.resolve('ST_PICKUP', makeSettler({ subType: UnitType.Stonecutter }));
            expect(result.sequenceKey).toBe(pickupSequenceKey(0));
            expect(result.loop).toBe(false);
        });

        it('ST_WALK_STONE while carrying resolves to carry animation', () => {
            const settler = makeCarryingSettler(EMaterialType.STONE, UnitType.Stonecutter);
            const result = resolver.resolve('ST_WALK_STONE', settler);
            expect(result.sequenceKey).toBe(carrySequenceKey(EMaterialType.STONE));
            expect(result.loop).toBe(true);
        });
    });

    // ── Baker ─────────────────────────────────────────────────────────────────

    describe('Baker (BA_*)', () => {
        it('BA_WALK resolves to walk', () => {
            const result = resolver.resolve('BA_WALK', makeSettler());
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });

        it('BA_PICKUP_WATER resolves to pickup.water (material-specific)', () => {
            const result = resolver.resolve('BA_PICKUP_WATER', makeSettler());
            expect(result.sequenceKey).toBe(pickupSequenceKey('water'));
            expect(result.loop).toBe(false);
        });

        it('BA_WORK_DOUGH resolves to work.0 (loop)', () => {
            const result = resolver.resolve('BA_WORK_DOUGH', makeSettler());
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('BA_SHOVEL_UP resolves to work.0 (loop)', () => {
            const result = resolver.resolve('BA_SHOVEL_UP', makeSettler());
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });
    });

    // ── Farmer ────────────────────────────────────────────────────────────────

    describe('Farmer (FG_*)', () => {
        it('FG_WALK resolves to walk', () => {
            const result = resolver.resolve('FG_WALK', makeSettler({ subType: UnitType.Farmer }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });

        it('FG_WALK_SEED resolves to walk', () => {
            const result = resolver.resolve('FG_WALK_SEED', makeSettler({ subType: UnitType.Farmer }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
            expect(result.loop).toBe(true);
        });

        it('FG_SEED_PLANTS resolves to work.0 (loop)', () => {
            const result = resolver.resolve('FG_SEED_PLANTS', makeSettler({ subType: UnitType.Farmer }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('FG_CUT_GRAIN resolves to work.0 (loop)', () => {
            const result = resolver.resolve('FG_CUT_GRAIN', makeSettler({ subType: UnitType.Farmer }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('FG_PICKUP_GRAIN resolves to pickup.grain (material-specific)', () => {
            const result = resolver.resolve('FG_PICKUP_GRAIN', makeSettler({ subType: UnitType.Farmer }));
            expect(result.sequenceKey).toBe(pickupSequenceKey('grain'));
            expect(result.loop).toBe(false);
        });

        it('FG_WALK_GRAIN while carrying resolves to carry animation', () => {
            const settler = makeCarryingSettler(EMaterialType.GRAIN, UnitType.Farmer);
            const result = resolver.resolve('FG_WALK_GRAIN', settler);
            expect(result.sequenceKey).toBe(carrySequenceKey(EMaterialType.GRAIN));
            expect(result.loop).toBe(true);
        });
    });

    // ── Carrier ───────────────────────────────────────────────────────────────

    describe('Carrier (C_*)', () => {
        it('C_WALK resolves to walk (loop)', () => {
            const result = resolver.resolve('C_WALK', makeSettler({ subType: UnitType.Carrier }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
            expect(result.loop).toBe(true);
        });

        it('C_IDLE1 resolves to idle (stopped)', () => {
            const result = resolver.resolve('C_IDLE1', makeSettler({ subType: UnitType.Carrier }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.DEFAULT);
            expect(result.stopped).toBe(true);
        });

        it('C_IDLE2 resolves to idle (stopped)', () => {
            const result = resolver.resolve('C_IDLE2', makeSettler({ subType: UnitType.Carrier }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.DEFAULT);
            expect(result.stopped).toBe(true);
        });

        it('C_IDLE3 resolves to idle (stopped)', () => {
            const result = resolver.resolve('C_IDLE3', makeSettler({ subType: UnitType.Carrier }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.DEFAULT);
            expect(result.stopped).toBe(true);
        });

        it('C_STRIKE1 resolves to short work (no loop)', () => {
            const result = resolver.resolve('C_STRIKE1', makeSettler({ subType: UnitType.Carrier }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(false);
            expect(result.stopped).toBe(false);
        });

        it('C_STRIKE2 resolves to idle (stopped)', () => {
            const result = resolver.resolve('C_STRIKE2', makeSettler({ subType: UnitType.Carrier }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.DEFAULT);
            expect(result.stopped).toBe(true);
        });
    });

    // ── Military / Fight ──────────────────────────────────────────────────────

    describe('Military fight animations', () => {
        it('SML01_FIGHT resolves to fight.0 for L1 swordsman', () => {
            const settler = makeSettler({ subType: UnitType.Swordsman, level: 1 });
            const result = resolver.resolve('SML01_FIGHT', settler);
            expect(result.sequenceKey).toBe(fightSequenceKey(0));
            expect(result.loop).toBe(true);
            expect(result.stopped).toBe(false);
        });

        it('SML02_FIGHT resolves to fight.1 for L2 swordsman', () => {
            const settler = makeSettler({ subType: UnitType.Swordsman2, level: 2 });
            const result = resolver.resolve('SML02_FIGHT', settler);
            expect(result.sequenceKey).toBe(fightSequenceKey(1));
            expect(result.loop).toBe(true);
        });

        it('SML03_FIGHT resolves to fight.2 for L3 swordsman', () => {
            const settler = makeSettler({ subType: UnitType.Swordsman3, level: 3 });
            const result = resolver.resolve('SML03_FIGHT', settler);
            expect(result.sequenceKey).toBe(fightSequenceKey(2));
            expect(result.loop).toBe(true);
        });

        it('BML01_FIGHT resolves to fight.0 for L1 bowman', () => {
            const settler = makeSettler({ subType: UnitType.Bowman, level: 1 });
            const result = resolver.resolve('BML01_FIGHT', settler);
            expect(result.sequenceKey).toBe(fightSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('BML01_SHOOT resolves via SHOOT suffix → fight.0', () => {
            const settler = makeSettler({ subType: UnitType.Bowman, level: 1 });
            const result = resolver.resolve('BML01_SHOOT', settler);
            expect(result.sequenceKey).toBe(fightSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('AWL01_FIGHT resolves to fight.0 for L1 axe warrior', () => {
            const settler = makeSettler({ subType: UnitType.AxeWarrior, level: 1 });
            const result = resolver.resolve('AWL01_FIGHT', settler);
            expect(result.sequenceKey).toBe(fightSequenceKey(0));
        });

        it('MEL01_HEAL resolves via HEAL suffix → fight.0', () => {
            const settler = makeSettler({ subType: UnitType.Medic, level: 1 });
            const result = resolver.resolve('MEL01_HEAL', settler);
            expect(result.sequenceKey).toBe(fightSequenceKey(0));
        });
    });

    // ── Suffix-based generic resolution ───────────────────────────────────────

    describe('suffix-based generic resolution', () => {
        it('any *_WALK suffix resolves to walk', () => {
            // G_WALK (Geologist) not in exact overrides — resolved by suffix
            const result = resolver.resolve('G_WALK', makeSettler({ subType: UnitType.Geologist }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
            expect(result.loop).toBe(true);
        });

        it('any *_WALK_* suffix without carry resolves to walk', () => {
            const result = resolver.resolve('SM_WALK_FOO', makeSettler());
            // Unknown prefix but suffix is WALK_FOO so heuristic fires
            // Actually SM is not a known prefix — falls through to unknown warning,
            // but suffix check happens BEFORE the knownPrefix check in the code.
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });

        it('M_WALK (Miner walk) resolves to walk via suffix', () => {
            const result = resolver.resolve('M_WALK', makeSettler({ subType: UnitType.Miner }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });

        it('PR_WALK (Priest walk) resolves to walk via suffix', () => {
            const result = resolver.resolve('PR_WALK', makeSettler({ subType: UnitType.Priest }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });
    });

    // ── Unknown jobPart fallback ──────────────────────────────────────────────

    describe('unknown jobPart fallback', () => {
        it('unknown prefixed jobPart falls back to looping work', () => {
            const result = resolver.resolve('ZZUNKNOWN_FOOBAR', makeSettler());
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('jobPart with no underscore returns idle without throwing', () => {
            const result = resolver.resolve('NOUNDERSCORE', makeSettler());
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.DEFAULT);
            expect(result.stopped).toBe(true);
        });
    });

    // ── Carry-upgrade logic ───────────────────────────────────────────────────

    describe('carry-upgrade logic', () => {
        it('WALK_* suffix upgrades to carry sequence when entity is carrying', () => {
            const settler = makeCarryingSettler(EMaterialType.BOARD, UnitType.Carrier);
            // Use a generic WALK suffix that should be caught by isWalkSuffix
            const result = resolver.resolve('C_WALK', settler);
            // C_WALK is plain WALK (action === 'WALK') → no cargo upgrade (carrying irrelevant for C_WALK)
            // because action === 'WALK' is the plain variant and cargo-upgrade only triggers for action !== 'WALK'
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });

        it('WALK_BOARD suffix upgrades to carry_BOARD when carrying BOARD', () => {
            const settler = makeCarryingSettler(EMaterialType.BOARD, UnitType.SawmillWorker);
            // SW_WALK_BOARD is an exact override to WALK_RESOLUTION but settler is carrying
            // The exact override handler re-checks carrying
            const result = resolver.resolve('SW_WALK_BOARD', settler);
            expect(result.sequenceKey).toBe(carrySequenceKey(EMaterialType.BOARD));
            expect(result.loop).toBe(true);
        });
    });

    // ── Specific jobs from jobInfo.xml ────────────────────────────────────────

    describe('jobs from jobInfo.xml', () => {
        it('DONKEY_WALK resolves to walk (loop)', () => {
            const result = resolver.resolve('DONKEY_WALK', makeSettler({ subType: UnitType.Donkey }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
            expect(result.loop).toBe(true);
        });

        it('DONKEY_DROP_GOODS resolves to pickup.0 (DROP_ uses generic fallback)', () => {
            const result = resolver.resolve('DONKEY_DROP_GOODS', makeSettler({ subType: UnitType.Donkey }));
            expect(result.sequenceKey).toBe(pickupSequenceKey(0));
            expect(result.loop).toBe(false);
        });

        it('G_SEARCH (Geologist) resolves to walk', () => {
            const result = resolver.resolve('G_SEARCH', makeSettler({ subType: UnitType.Geologist }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });

        it('G_WORK (Geologist) resolves to work.0', () => {
            const result = resolver.resolve('G_WORK', makeSettler({ subType: UnitType.Geologist }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('AM_WALK resolves to walk (ammo maker)', () => {
            const result = resolver.resolve('AM_WALK', makeSettler());
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
        });

        it('AM_PICKUP_AMMO resolves to pickup.ammo (material-specific)', () => {
            const result = resolver.resolve('AM_PICKUP_AMMO', makeSettler());
            expect(result.sequenceKey).toBe(pickupSequenceKey('ammo'));
            expect(result.loop).toBe(false);
        });

        it('PR_CASTSPELL (Priest) resolves to work.0 (loop)', () => {
            const result = resolver.resolve('PR_CASTSPELL', makeSettler({ subType: UnitType.Priest }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('MF_PLANT (Mushroom Farmer) resolves to work.0 (loop)', () => {
            const result = resolver.resolve('MF_PLANT', makeSettler({ subType: UnitType.MushroomFarmer }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });

        it('V_FILL_GRAPE (Winemaker) resolves to work.0 (loop)', () => {
            const result = resolver.resolve('V_FILL_GRAPE', makeSettler({ subType: UnitType.Winemaker }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(true);
        });
    });
});
