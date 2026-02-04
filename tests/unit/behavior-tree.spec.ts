import { describe, it, expect, vi } from 'vitest';
import {
    NodeStatus,
    Sequence,
    Selector,
    Condition,
    Action,
    Action2,
    Guard,
    Repeat,
    RepeatCount,
    Sleep,
    ResetAfter,
    Parallel,
    sequence,
    selector,
    condition,
    action,
    action2,
    guard,
    repeat,
    sleep,
    resetAfter,
} from '@/game/ai/behavior-tree';
import { Tick } from '@/game/ai/tick';

// Simple test entity — no game-specific code
interface TestEntity {
    value: number;
    flag: boolean;
    log: string[];
}

function makeEntity(overrides: Partial<TestEntity> = {}): TestEntity {
    return { value: 0, flag: false, log: [], ...overrides };
}

// ─── Sequence ─────────────────────────────────────────────────────────────────

describe('Sequence', () => {
    it('succeeds when all children succeed', () => {
        const entity = makeEntity();
        const tree = sequence<TestEntity>(
            action(e => { e.log.push('a'); }),
            action(e => { e.log.push('b'); }),
            action(e => { e.log.push('c'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['a', 'b', 'c']);
    });

    it('fails on first failure and stops executing remaining children', () => {
        const entity = makeEntity();
        const tree = sequence<TestEntity>(
            action(e => { e.log.push('a'); }),
            condition(() => false),
            action(e => { e.log.push('c'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.FAILURE);
        expect(entity.log).toEqual(['a']); // 'c' never runs
    });

    it('returns RUNNING when a child returns RUNNING', () => {
        const entity = makeEntity();
        const tree = sequence<TestEntity>(
            action(e => { e.log.push('a'); }),
            action2(() => NodeStatus.RUNNING),
            action(e => { e.log.push('c'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(entity.log).toEqual(['a']); // 'c' never runs
    });

    it('succeeds with zero children', () => {
        const tree = new Sequence<TestEntity>([]);
        expect(tree.tick(makeEntity())).toBe(NodeStatus.SUCCESS);
    });
});

// ─── Selector ─────────────────────────────────────────────────────────────────

describe('Selector', () => {
    it('succeeds on first success', () => {
        const entity = makeEntity();
        const tree = selector<TestEntity>(
            condition(() => false),
            action(e => { e.log.push('b'); }),
            action(e => { e.log.push('c'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['b']); // 'c' never runs
    });

    it('fails only when all children fail', () => {
        const entity = makeEntity();
        const tree = selector<TestEntity>(
            condition(() => false),
            condition(() => false),
            condition(() => false),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.FAILURE);
    });

    it('returns RUNNING when a child returns RUNNING', () => {
        const entity = makeEntity();
        const tree = selector<TestEntity>(
            condition(() => false),
            action2(() => NodeStatus.RUNNING),
            action(e => { e.log.push('c'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(entity.log).toEqual([]); // 'c' never runs
    });

    it('fails with zero children', () => {
        const tree = new Selector<TestEntity>([]);
        expect(tree.tick(makeEntity())).toBe(NodeStatus.FAILURE);
    });
});

// ─── Condition ────────────────────────────────────────────────────────────────

describe('Condition', () => {
    it('returns SUCCESS when predicate is true', () => {
        const tree = condition<TestEntity>(e => e.flag);
        expect(tree.tick(makeEntity({ flag: true }))).toBe(NodeStatus.SUCCESS);
    });

    it('returns FAILURE when predicate is false', () => {
        const tree = condition<TestEntity>(e => e.flag);
        expect(tree.tick(makeEntity({ flag: false }))).toBe(NodeStatus.FAILURE);
    });
});

// ─── Action ───────────────────────────────────────────────────────────────────

describe('Action', () => {
    it('executes callback and returns SUCCESS', () => {
        const entity = makeEntity();
        const tree = action<TestEntity>(e => { e.value = 42; });

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.value).toBe(42);
    });
});

// ─── Action2 ──────────────────────────────────────────────────────────────────

describe('Action2', () => {
    it('propagates SUCCESS status', () => {
        const tree = action2<TestEntity>(() => NodeStatus.SUCCESS);
        expect(tree.tick(makeEntity())).toBe(NodeStatus.SUCCESS);
    });

    it('propagates FAILURE status', () => {
        const tree = action2<TestEntity>(() => NodeStatus.FAILURE);
        expect(tree.tick(makeEntity())).toBe(NodeStatus.FAILURE);
    });

    it('propagates RUNNING status correctly', () => {
        let callCount = 0;
        const tree = action2<TestEntity>(() => {
            callCount++;
            return callCount < 3 ? NodeStatus.RUNNING : NodeStatus.SUCCESS;
        });

        const entity = makeEntity();
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
    });
});

// ─── Guard ────────────────────────────────────────────────────────────────────

describe('Guard', () => {
    it('runs child when condition is true', () => {
        const entity = makeEntity({ flag: true });
        const tree = guard<TestEntity>(
            e => e.flag,
            action(e => { e.value = 99; }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.value).toBe(99);
    });

    it('skips child when condition is false', () => {
        const entity = makeEntity({ flag: false });
        const tree = guard<TestEntity>(
            e => e.flag,
            action(e => { e.value = 99; }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.FAILURE);
        expect(entity.value).toBe(0); // child never ran
    });

    it('propagates child RUNNING status', () => {
        const tree = guard<TestEntity>(
            () => true,
            action2(() => NodeStatus.RUNNING),
        );

        expect(tree.tick(makeEntity())).toBe(NodeStatus.RUNNING);
    });
});

// ─── Repeat ───────────────────────────────────────────────────────────────────

describe('Repeat', () => {
    it('runs child multiple times while condition holds', () => {
        const entity = makeEntity({ value: 3 });
        const tree = repeat<TestEntity>(
            e => e.value > 0,
            action(e => { e.value--; e.log.push('tick'); }),
        );

        // Each tick: check condition, run child, return RUNNING
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING); // value: 3→2
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING); // value: 2→1
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING); // value: 1→0
        // Condition now false on next check
        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS); // value: 0
        expect(entity.log).toHaveLength(3);
    });

    it('returns SUCCESS immediately when condition is false', () => {
        const entity = makeEntity({ value: 0 });
        const tree = repeat<TestEntity>(
            e => e.value > 0,
            action(e => { e.log.push('tick'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toHaveLength(0);
    });

    it('returns FAILURE if child fails', () => {
        const tree = repeat<TestEntity>(
            () => true,
            condition(() => false),
        );

        expect(tree.tick(makeEntity())).toBe(NodeStatus.FAILURE);
    });
});

// ─── RepeatCount ──────────────────────────────────────────────────────────────

describe('RepeatCount', () => {
    it('repeats child N times', () => {
        const entity = makeEntity();
        const tree = new RepeatCount<TestEntity>(3, action(e => { e.value++; }));

        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);  // 1st
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);  // 2nd
        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);  // 3rd
        expect(entity.value).toBe(3);
    });

    it('resets count after completion', () => {
        const entity = makeEntity();
        const tree = new RepeatCount<TestEntity>(2, action(e => { e.value++; }));

        // First cycle
        tree.tick(entity); // RUNNING
        tree.tick(entity); // SUCCESS

        // Second cycle (restarted)
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.value).toBe(4);
    });

    it('fails and resets if child fails', () => {
        const entity = makeEntity();
        let shouldFail = false;
        const tree = new RepeatCount<TestEntity>(
            3,
            action2(() => {
                if (shouldFail) return NodeStatus.FAILURE;
                entity.value++;
                return NodeStatus.SUCCESS;
            }),
        );

        tree.tick(entity); // 1st: RUNNING
        shouldFail = true;
        expect(tree.tick(entity)).toBe(NodeStatus.FAILURE);

        // Count reset — can do full cycle again
        shouldFail = false;
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
    });
});

// ─── Sleep ────────────────────────────────────────────────────────────────────

describe('Sleep', () => {
    it('returns RUNNING then SUCCESS after duration', () => {
        const entity = makeEntity();
        const tree = sleep<TestEntity>(() => 100);
        const tick = new Tick(entity, tree);

        expect(tick.tick(50)).toBe(NodeStatus.RUNNING);   // 50ms elapsed
        expect(tick.tick(40)).toBe(NodeStatus.RUNNING);   // 90ms elapsed
        expect(tick.tick(20)).toBe(NodeStatus.SUCCESS);   // 110ms elapsed
    });

    it('succeeds immediately when duration is zero', () => {
        const entity = makeEntity();
        const tree = sleep<TestEntity>(() => 0);
        const tick = new Tick(entity, tree);

        expect(tick.tick(0)).toBe(NodeStatus.SUCCESS);
    });

    it('resets after completion for reuse', () => {
        const entity = makeEntity();
        const tree = sleep<TestEntity>(() => 50);
        const tick = new Tick(entity, tree);

        expect(tick.tick(60)).toBe(NodeStatus.SUCCESS);
        // Can be reused
        expect(tick.tick(30)).toBe(NodeStatus.RUNNING);
        expect(tick.tick(30)).toBe(NodeStatus.SUCCESS);
    });

    it('uses entity-dependent duration', () => {
        const entity = makeEntity({ value: 200 });
        const tree = sleep<TestEntity>(e => e.value);
        const tick = new Tick(entity, tree);

        expect(tick.tick(100)).toBe(NodeStatus.RUNNING);
        expect(tick.tick(100)).toBe(NodeStatus.SUCCESS);
    });
});

// ─── ResetAfter ───────────────────────────────────────────────────────────────

describe('ResetAfter', () => {
    it('calls reset on SUCCESS', () => {
        const entity = makeEntity();
        const tree = resetAfter<TestEntity>(
            e => { e.log.push('reset'); },
            action(e => { e.log.push('work'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['work', 'reset']);
    });

    it('calls reset even on FAILURE', () => {
        const entity = makeEntity();
        const tree = resetAfter<TestEntity>(
            e => { e.log.push('reset'); },
            condition(() => false),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.FAILURE);
        expect(entity.log).toEqual(['reset']);
    });

    it('does NOT call reset while RUNNING', () => {
        const entity = makeEntity();
        const tree = resetAfter<TestEntity>(
            e => { e.log.push('reset'); },
            action2(() => NodeStatus.RUNNING),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.RUNNING);
        expect(entity.log).toEqual([]);
    });
});

// ─── Parallel ─────────────────────────────────────────────────────────────────

describe('Parallel', () => {
    it('succeeds when all children succeed (requireAll)', () => {
        const entity = makeEntity();
        const tree = new Parallel<TestEntity>([
            action(e => { e.log.push('a'); }),
            action(e => { e.log.push('b'); }),
        ], true);

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['a', 'b']);
    });

    it('fails on first failure when requireAll', () => {
        const tree = new Parallel<TestEntity>([
            action(() => {}),
            condition(() => false),
            action(() => {}),
        ], true);

        expect(tree.tick(makeEntity())).toBe(NodeStatus.FAILURE);
    });

    it('returns RUNNING if any child is RUNNING and none failed (requireAll)', () => {
        const tree = new Parallel<TestEntity>([
            action(() => {}),
            action2(() => NodeStatus.RUNNING),
        ], true);

        expect(tree.tick(makeEntity())).toBe(NodeStatus.RUNNING);
    });

    it('succeeds on first success when requireOne', () => {
        const tree = new Parallel<TestEntity>([
            condition(() => false),
            action(() => {}),
        ], false);

        expect(tree.tick(makeEntity())).toBe(NodeStatus.SUCCESS);
    });

    it('fails when all fail (requireOne)', () => {
        const tree = new Parallel<TestEntity>([
            condition(() => false),
            condition(() => false),
        ], false);

        expect(tree.tick(makeEntity())).toBe(NodeStatus.FAILURE);
    });
});

// ─── Nested Trees ─────────────────────────────────────────────────────────────

describe('Nested trees', () => {
    it('sequence inside selector falls through on failure', () => {
        const entity = makeEntity();
        const tree = selector<TestEntity>(
            // First branch: fails because condition is false
            sequence(
                condition(() => false),
                action(e => { e.log.push('branch1'); }),
            ),
            // Second branch: succeeds
            sequence(
                condition(() => true),
                action(e => { e.log.push('branch2'); }),
            ),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['branch2']);
    });

    it('selector inside sequence provides fallback behavior', () => {
        const entity = makeEntity({ flag: false });
        const tree = sequence<TestEntity>(
            action(e => { e.log.push('setup'); }),
            selector(
                guard(e => e.flag, action(e => { e.log.push('guarded'); })),
                action(e => { e.log.push('fallback'); }),
            ),
            action(e => { e.log.push('done'); }),
        );

        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['setup', 'fallback', 'done']);
    });

    it('complex bearer-like behavior tree', () => {
        const entity = makeEntity({ value: 0, flag: true, log: [] });

        // Simulates a simplified bearer behavior
        const tree = selector<TestEntity>(
            // Priority 1: Transport job (flag must be true)
            sequence(
                condition(e => e.flag),
                action(e => { e.log.push('pickup'); }),
                action(e => { e.log.push('deliver'); }),
                action(e => { e.flag = false; e.log.push('jobless'); }),
            ),
            // Priority 2: Idle
            action(e => { e.log.push('idle'); }),
        );

        // First tick: has job
        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['pickup', 'deliver', 'jobless']);

        // Second tick: job completed, goes idle
        entity.log = [];
        expect(tree.tick(entity)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['idle']);
    });
});

// ─── Tick Context ─────────────────────────────────────────────────────────────

describe('Tick', () => {
    it('wraps entity and root node', () => {
        const entity = makeEntity();
        const tree = action<TestEntity>(e => { e.value = 1; });
        const tick = new Tick(entity, tree);

        expect(tick.tick(0)).toBe(NodeStatus.SUCCESS);
        expect(entity.value).toBe(1);
    });

    it('sets elapsed time for Sleep nodes', () => {
        const entity = makeEntity();
        const tree = sequence<TestEntity>(
            sleep(() => 100),
            action(e => { e.log.push('done'); }),
        );
        const tick = new Tick(entity, tree);

        expect(tick.tick(50)).toBe(NodeStatus.RUNNING);
        expect(entity.log).toEqual([]);

        expect(tick.tick(60)).toBe(NodeStatus.SUCCESS);
        expect(entity.log).toEqual(['done']);
    });
});
