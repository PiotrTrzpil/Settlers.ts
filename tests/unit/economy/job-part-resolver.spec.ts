/**
 * Unit tests for JobPartResolverImpl.
 *
 * Focuses on domain rules that an AI could get wrong:
 * - Carry-upgrade logic (walking with cargo uses carry animation)
 * - Military fight level mapping (L1→fight.0, L2→fight.1, L3→fight.2)
 * - Suffix-based generic resolution fallback chain
 * - Unknown jobPart fallback behavior
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

    describe('standard resolution patterns', () => {
        it('*_WALK suffixes resolve to walk, *_PICKUP to pickup, *_WORK-like to work', () => {
            // Walk
            expect(resolver.resolve('WC_WALK', makeSettler()).sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
            expect(resolver.resolve('ST_WALK', makeSettler({ subType: UnitType.Stonecutter })).sequenceKey).toBe(
                ANIMATION_SEQUENCES.WALK
            );
            expect(resolver.resolve('BA_WALK', makeSettler()).sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);

            // Work
            expect(resolver.resolve('WC_CUT_TREE', makeSettler()).sequenceKey).toBe(workSequenceKey(0));
            expect(resolver.resolve('ST_HACK', makeSettler({ subType: UnitType.Stonecutter })).sequenceKey).toBe(
                workSequenceKey(0)
            );
            expect(resolver.resolve('BA_WORK_DOUGH', makeSettler()).sequenceKey).toBe(workSequenceKey(0));

            // Pickup (material-specific)
            expect(resolver.resolve('WC_PICKUP_LOG', makeSettler()).sequenceKey).toBe(pickupSequenceKey('log'));
            expect(resolver.resolve('BA_PICKUP_WATER', makeSettler()).sequenceKey).toBe(pickupSequenceKey('water'));
            expect(resolver.resolve('FG_PICKUP_GRAIN', makeSettler({ subType: UnitType.Farmer })).sequenceKey).toBe(
                pickupSequenceKey('grain')
            );

            // Pickup (generic, no material suffix)
            expect(resolver.resolve('ST_PICKUP', makeSettler({ subType: UnitType.Stonecutter })).sequenceKey).toBe(
                pickupSequenceKey(0)
            );
        });

        it('idle job parts resolve to stopped default animation', () => {
            const carrier = makeSettler({ subType: UnitType.Carrier });
            for (const part of ['C_IDLE1', 'C_IDLE2', 'C_IDLE3', 'C_STRIKE2']) {
                const result = resolver.resolve(part, carrier);
                expect(result.sequenceKey, `${part}`).toBe(ANIMATION_SEQUENCES.DEFAULT);
                expect(result.stopped, `${part}`).toBe(true);
            }
        });

        it('C_STRIKE1 resolves to short work (no loop)', () => {
            const result = resolver.resolve('C_STRIKE1', makeSettler({ subType: UnitType.Carrier }));
            expect(result.sequenceKey).toBe(workSequenceKey(0));
            expect(result.loop).toBe(false);
            expect(result.stopped).toBe(false);
        });
    });

    describe('carry-upgrade logic', () => {
        it('plain WALK upgrades to carry sequence when entity is carrying', () => {
            const settler = makeCarryingSettler(EMaterialType.BOARD, UnitType.Carrier);
            const result = resolver.resolve('C_WALK', settler);
            expect(result.sequenceKey).toBe(carrySequenceKey(EMaterialType.BOARD));
        });

        it('WALK_* suffix resolves to carry variant from suffix', () => {
            const result = resolver.resolve('WC_WALK_LOG', makeSettler());
            expect(result.sequenceKey).toBe(carrySequenceKey('log'));
            expect(result.loop).toBe(true);
        });

        it('WALK_* suffix with carrying entity uses material-typed carry sequence', () => {
            const settler = makeCarryingSettler(EMaterialType.LOG);
            const result = resolver.resolve('WC_WALK_LOG', settler);
            expect(result.sequenceKey).toBe(carrySequenceKey(EMaterialType.LOG));
        });

        it('WALK_BOARD suffix upgrades to carry_BOARD when carrying BOARD', () => {
            const settler = makeCarryingSettler(EMaterialType.BOARD, UnitType.SawmillWorker);
            const result = resolver.resolve('SW_WALK_BOARD', settler);
            expect(result.sequenceKey).toBe(carrySequenceKey(EMaterialType.BOARD));
            expect(result.loop).toBe(true);
        });
    });

    describe('military fight level mapping', () => {
        it('maps fight animations to correct level-indexed fight sequences', () => {
            const cases: Array<[string, UnitType, number, number]> = [
                ['SML01_FIGHT', UnitType.Swordsman, 1, 0],
                ['SML02_FIGHT', UnitType.Swordsman2, 2, 1],
                ['SML03_FIGHT', UnitType.Swordsman3, 3, 2],
                ['BML01_FIGHT', UnitType.Bowman, 1, 0],
                ['BML01_SHOOT', UnitType.Bowman, 1, 0],
                ['AWL01_FIGHT', UnitType.AxeWarrior, 1, 0],
                ['MEL01_HEAL', UnitType.Medic, 1, 0],
            ];

            for (const [jobPart, unitType, level, expectedFightIndex] of cases) {
                const settler = makeSettler({ subType: unitType, level });
                const result = resolver.resolve(jobPart, settler);
                expect(result.sequenceKey, `${jobPart}`).toBe(fightSequenceKey(expectedFightIndex));
                expect(result.loop, `${jobPart}`).toBe(true);
            }
        });
    });

    describe('suffix-based generic resolution', () => {
        it('unknown prefix with _WALK suffix resolves to walk', () => {
            const result = resolver.resolve('G_WALK', makeSettler({ subType: UnitType.Geologist }));
            expect(result.sequenceKey).toBe(ANIMATION_SEQUENCES.WALK);
            expect(result.loop).toBe(true);
        });

        it('unknown prefix with _WALK_* suffix resolves to carry variant', () => {
            const result = resolver.resolve('SM_WALK_FOO', makeSettler());
            expect(result.sequenceKey).toBe(carrySequenceKey('foo'));
        });
    });

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
});
