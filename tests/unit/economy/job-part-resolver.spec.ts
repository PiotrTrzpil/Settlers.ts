/**
 * Unit tests for JobPartResolverImpl.
 *
 * Since sequence keys are now the XML jobPart names directly,
 * the resolver is a simple pass-through that only determines
 * loop/stopped behaviour from the action suffix.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JobPartResolverImpl } from '@/game/features/settler-tasks/job-part-resolver';
import { EntityType, UnitType } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { Entity } from '@/game/entity';

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('JobPartResolverImpl', () => {
    let resolver: JobPartResolverImpl;

    beforeEach(() => {
        resolver = new JobPartResolverImpl();
    });

    describe('sequence key is the jobPart name directly', () => {
        it('returns the jobPart as the sequenceKey for all job types', () => {
            const settler = makeSettler();
            expect(resolver.resolve('WC_WALK', settler).sequenceKey).toBe('WC_WALK');
            expect(resolver.resolve('WC_CUT_TREE', settler).sequenceKey).toBe('WC_CUT_TREE');
            expect(resolver.resolve('WC_PICKUP_LOG', settler).sequenceKey).toBe('WC_PICKUP_LOG');
            expect(resolver.resolve('WC_WALK_LOG', settler).sequenceKey).toBe('WC_WALK_LOG');
            expect(resolver.resolve('BA_WORK_DOUGH', settler).sequenceKey).toBe('BA_WORK_DOUGH');
            expect(resolver.resolve('SML01_FIGHT', settler).sequenceKey).toBe('SML01_FIGHT');
        });
    });

    describe('loop behaviour', () => {
        it('walk, carry, work, and fight animations loop', () => {
            const settler = makeSettler();
            expect(resolver.resolve('WC_WALK', settler).loop).toBe(true);
            expect(resolver.resolve('WC_WALK_LOG', settler).loop).toBe(true);
            expect(resolver.resolve('WC_CUT_TREE', settler).loop).toBe(true);
            expect(resolver.resolve('SML01_FIGHT', settler).loop).toBe(true);
            expect(resolver.resolve('BA_WORK_DOUGH', settler).loop).toBe(true);
        });

        it('pickup and drop animations do not loop', () => {
            const settler = makeSettler();
            expect(resolver.resolve('WC_PICKUP_LOG', settler).loop).toBe(false);
            expect(resolver.resolve('C_DOWN_NONE', settler).loop).toBe(false);
            expect(resolver.resolve('DONKEY_DROP_GOODS', settler).loop).toBe(false);
        });
    });

    describe('stopped behaviour', () => {
        it('idle job parts resolve to stopped', () => {
            const carrier = makeSettler({ subType: UnitType.Carrier });
            for (const part of ['C_IDLE1', 'C_IDLE2', 'C_IDLE3']) {
                const result = resolver.resolve(part, carrier);
                expect(result.stopped, `${part}`).toBe(true);
            }
        });

        it('C_STRIKE2 resolves to stopped (idle override)', () => {
            const result = resolver.resolve('C_STRIKE2', makeSettler({ subType: UnitType.Carrier }));
            expect(result.stopped).toBe(true);
        });

        it('C_STRIKE1 resolves to looping (not idle)', () => {
            const result = resolver.resolve('C_STRIKE1', makeSettler({ subType: UnitType.Carrier }));
            expect(result.loop).toBe(true);
            expect(result.stopped).toBe(false);
        });

        it('non-idle, non-pickup animations are not stopped', () => {
            const settler = makeSettler();
            expect(resolver.resolve('WC_WALK', settler).stopped).toBe(false);
            expect(resolver.resolve('WC_CUT_TREE', settler).stopped).toBe(false);
        });
    });
});
