// ─── Node Status ──────────────────────────────────────────────────────────────

export enum NodeStatus {
    SUCCESS,
    FAILURE,
    RUNNING,
}

// ─── Abstract Base ────────────────────────────────────────────────────────────

export abstract class Node<T> {
    abstract tick(entity: T, deltaMs: number): NodeStatus;
}

// ─── Composite Nodes ──────────────────────────────────────────────────────────

/** Runs children in order. Fails on first FAILURE, returns RUNNING if any child
 *  returns RUNNING. Succeeds only when all children succeed. */
export class Sequence<T> extends Node<T> {
    constructor(public readonly children: Node<T>[]) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        for (const child of this.children) {
            const status = child.tick(entity, deltaMs);
            if (status !== NodeStatus.SUCCESS) return status;
        }
        return NodeStatus.SUCCESS;
    }
}

/** Tries children in order. Succeeds on first SUCCESS, returns RUNNING if any
 *  child returns RUNNING. Fails only when all children fail. */
export class Selector<T> extends Node<T> {
    constructor(public readonly children: Node<T>[]) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        for (const child of this.children) {
            const status = child.tick(entity, deltaMs);
            if (status !== NodeStatus.FAILURE) return status;
        }
        return NodeStatus.FAILURE;
    }
}

/** Runs all children every tick. Success/failure policy is configurable:
 *  - requireAll (default): succeeds when ALL succeed, fails on first failure
 *  - requireOne: succeeds on first success, fails when ALL fail
 *  Returns RUNNING if any child returns RUNNING (unless a policy threshold
 *  is already met). */
export class Parallel<T> extends Node<T> {
    constructor(
        public readonly children: Node<T>[],
        public readonly requireAll: boolean = true,
    ) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        let successCount = 0;
        let failureCount = 0;
        let hasRunning = false;

        for (const child of this.children) {
            const status = child.tick(entity, deltaMs);
            switch (status) {
            case NodeStatus.SUCCESS:
                successCount++;
                break;
            case NodeStatus.FAILURE:
                failureCount++;
                break;
            case NodeStatus.RUNNING:
                hasRunning = true;
                break;
            }
        }

        if (this.requireAll) {
            if (failureCount > 0) return NodeStatus.FAILURE;
            if (hasRunning) return NodeStatus.RUNNING;
            return NodeStatus.SUCCESS;
        } else {
            if (successCount > 0) return NodeStatus.SUCCESS;
            if (hasRunning) return NodeStatus.RUNNING;
            return NodeStatus.FAILURE;
        }
    }
}

// ─── Leaf Nodes ───────────────────────────────────────────────────────────────

/** Boolean predicate → SUCCESS or FAILURE. */
export class Condition<T> extends Node<T> {
    constructor(public readonly predicate: (entity: T) => boolean) {
        super();
    }

    tick(entity: T, _deltaMs: number): NodeStatus {
        return this.predicate(entity) ? NodeStatus.SUCCESS : NodeStatus.FAILURE;
    }
}

/** Executes a callback and always returns SUCCESS. */
export class Action<T> extends Node<T> {
    constructor(public readonly execute: (entity: T) => void) {
        super();
    }

    tick(entity: T, _deltaMs: number): NodeStatus {
        this.execute(entity);
        return NodeStatus.SUCCESS;
    }
}

/** Executes a callback that returns an arbitrary NodeStatus. */
export class StatusAction<T> extends Node<T> {
    constructor(public readonly execute: (entity: T) => NodeStatus) {
        super();
    }

    tick(entity: T, _deltaMs: number): NodeStatus {
        return this.execute(entity);
    }
}

// ─── Decorator Nodes ──────────────────────────────────────────────────────────

/** Only runs child if condition is true. Returns FAILURE when condition is
 *  false (child is skipped). */
export class Guard<T> extends Node<T> {
    constructor(
        public readonly conditionFn: (entity: T) => boolean,
        public readonly child: Node<T>,
    ) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        if (!this.conditionFn(entity)) return NodeStatus.FAILURE;
        return this.child.tick(entity, deltaMs);
    }
}

/** Repeats child while condition holds. Returns RUNNING while repeating.
 *  Returns FAILURE if the child fails during any iteration. Returns SUCCESS
 *  once the condition becomes false (loop finished). */
export class Repeat<T> extends Node<T> {
    constructor(
        public readonly conditionFn: (entity: T) => boolean,
        public readonly child: Node<T>,
    ) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        if (!this.conditionFn(entity)) return NodeStatus.SUCCESS;
        const status = this.child.tick(entity, deltaMs);
        if (status === NodeStatus.FAILURE) return NodeStatus.FAILURE;
        return NodeStatus.RUNNING;
    }
}

/** Repeats child exactly N times. Returns RUNNING while counting, SUCCESS
 *  after N completions, FAILURE if child fails. Resets count after
 *  completion or failure. */
export class RepeatCount<T> extends Node<T> {
    private count = 0;

    constructor(
        public readonly times: number,
        public readonly child: Node<T>,
    ) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        if (this.count >= this.times) {
            this.count = 0;
            return NodeStatus.SUCCESS;
        }
        const status = this.child.tick(entity, deltaMs);
        if (status === NodeStatus.FAILURE) {
            this.count = 0;
            return NodeStatus.FAILURE;
        }
        if (status === NodeStatus.SUCCESS) {
            this.count++;
            if (this.count >= this.times) {
                this.count = 0;
                return NodeStatus.SUCCESS;
            }
        }
        return NodeStatus.RUNNING;
    }
}

/** Returns RUNNING for a duration (in milliseconds), then SUCCESS.
 *  Duration is obtained from a function so it can vary per entity.
 *  deltaMs is passed through the tick() call chain from the Tick wrapper. */
export class Sleep<T> extends Node<T> {
    private remaining = -1;

    constructor(public readonly durationFn: (entity: T) => number) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        if (this.remaining < 0) {
            this.remaining = this.durationFn(entity);
        }

        this.remaining -= deltaMs;

        if (this.remaining <= 0) {
            this.remaining = -1;
            return NodeStatus.SUCCESS;
        }
        return NodeStatus.RUNNING;
    }
}

/** Runs child, then calls reset function when child returns SUCCESS or
 *  FAILURE (not RUNNING). Propagates the child's final status. */
export class ResetAfter<T> extends Node<T> {
    constructor(
        public readonly resetFn: (entity: T) => void,
        public readonly child: Node<T>,
    ) {
        super();
    }

    tick(entity: T, deltaMs: number): NodeStatus {
        const status = this.child.tick(entity, deltaMs);
        if (status !== NodeStatus.RUNNING) {
            this.resetFn(entity);
        }
        return status;
    }
}

// ─── Builder Functions (functional API) ───────────────────────────────────────

export function sequence<T>(...children: Node<T>[]): Sequence<T> {
    return new Sequence(children);
}

export function selector<T>(...children: Node<T>[]): Selector<T> {
    return new Selector(children);
}

export function parallel<T>(children: Node<T>[], requireAll = true): Parallel<T> {
    return new Parallel(children, requireAll);
}

export function condition<T>(predicate: (entity: T) => boolean): Condition<T> {
    return new Condition(predicate);
}

export function action<T>(callback: (entity: T) => void): Action<T> {
    return new Action(callback);
}

export function statusAction<T>(callback: (entity: T) => NodeStatus): StatusAction<T> {
    return new StatusAction(callback);
}

export function guard<T>(
    conditionFn: (entity: T) => boolean,
    child: Node<T>,
): Guard<T> {
    return new Guard(conditionFn, child);
}

export function repeat<T>(
    conditionFn: (entity: T) => boolean,
    child: Node<T>,
): Repeat<T> {
    return new Repeat(conditionFn, child);
}

export function repeatCount<T>(times: number, child: Node<T>): RepeatCount<T> {
    return new RepeatCount(times, child);
}

export function sleep<T>(durationFn: (entity: T) => number): Sleep<T> {
    return new Sleep(durationFn);
}

export function resetAfter<T>(
    resetFn: (entity: T) => void,
    child: Node<T>,
): ResetAfter<T> {
    return new ResetAfter(resetFn, child);
}
