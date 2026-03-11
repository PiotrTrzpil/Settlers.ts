import { describe, it, expect, vi } from 'vitest';
import { TickScheduler, NO_HANDLE } from '../../../src/game/systems/tick-scheduler';

// Helper: advance the scheduler by N ticks
function advance(scheduler: TickScheduler, ticks: number): void {
    for (let i = 0; i < ticks; i++) {
        scheduler.tick(0);
    }
}

describe('TickScheduler', () => {
    describe('schedule and fire', () => {
        it('fires callback on the correct tick, not before', () => {
            const scheduler = new TickScheduler();
            const spy = vi.fn();

            scheduler.schedule(5, spy);

            advance(scheduler, 4);
            expect(spy).not.toHaveBeenCalled();

            scheduler.tick(0); // tick 5
            expect(spy).toHaveBeenCalledOnce();
        });

        it('does not fire callback again after it has fired', () => {
            const scheduler = new TickScheduler();
            const spy = vi.fn();

            scheduler.schedule(2, spy);

            advance(scheduler, 5);
            expect(spy).toHaveBeenCalledOnce();
        });

        it('fires multiple callbacks with different delays at their respective ticks', () => {
            const scheduler = new TickScheduler();
            const order: number[] = [];

            scheduler.schedule(2, () => order.push(2));
            scheduler.schedule(5, () => order.push(5));
            scheduler.schedule(1, () => order.push(1));

            advance(scheduler, 5);
            expect(order).toEqual([1, 2, 5]);
        });
    });

    describe('same-tick ordering', () => {
        it('fires 3 callbacks for the same tick in insertion order', () => {
            const scheduler = new TickScheduler();
            const order: string[] = [];

            scheduler.schedule(3, () => order.push('first'));
            scheduler.schedule(3, () => order.push('second'));
            scheduler.schedule(3, () => order.push('third'));

            advance(scheduler, 3);
            expect(order).toEqual(['first', 'second', 'third']);
        });
    });

    describe('cancellation', () => {
        it('prevents callback from firing when cancelled before its tick', () => {
            const scheduler = new TickScheduler();
            const spy = vi.fn();

            const handle = scheduler.schedule(3, spy);
            scheduler.cancel(handle);

            advance(scheduler, 5);
            expect(spy).not.toHaveBeenCalled();
        });

        it('does not affect other callbacks on the same tick', () => {
            const scheduler = new TickScheduler();
            const spyA = vi.fn();
            const spyB = vi.fn();
            const spyC = vi.fn();

            scheduler.schedule(3, spyA);
            const handleB = scheduler.schedule(3, spyB);
            scheduler.schedule(3, spyC);

            scheduler.cancel(handleB);

            advance(scheduler, 3);
            expect(spyA).toHaveBeenCalledOnce();
            expect(spyB).not.toHaveBeenCalled();
            expect(spyC).toHaveBeenCalledOnce();
        });
    });

    describe('callback error isolation', () => {
        it('continues firing remaining callbacks when one throws', () => {
            const scheduler = new TickScheduler();
            const spyBefore = vi.fn();
            const spyAfter = vi.fn();
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            scheduler.schedule(2, spyBefore);
            scheduler.schedule(2, () => {
                throw new Error('boom');
            });
            scheduler.schedule(2, spyAfter);

            advance(scheduler, 2);

            expect(spyBefore).toHaveBeenCalledOnce();
            expect(spyAfter).toHaveBeenCalledOnce();
            expect(consoleErrorSpy).toHaveBeenCalledOnce();

            consoleErrorSpy.mockRestore();
        });
    });

    describe('delay=0 rejection', () => {
        it('throws when delay is 0', () => {
            const scheduler = new TickScheduler();
            expect(() => scheduler.schedule(0, () => {})).toThrow('delayTicks must be >= 1');
        });

        it('throws when delay is negative', () => {
            const scheduler = new TickScheduler();
            expect(() => scheduler.schedule(-1, () => {})).toThrow('delayTicks must be >= 1');
        });
    });

    describe('handle reuse safety', () => {
        it('cancelled handle does not affect a new schedule', () => {
            const scheduler = new TickScheduler();
            const spyOld = vi.fn();
            const spyNew = vi.fn();

            const oldHandle = scheduler.schedule(3, spyOld);
            scheduler.cancel(oldHandle);

            // New schedule gets a different handle
            const newHandle = scheduler.schedule(3, spyNew);
            expect(newHandle).not.toBe(oldHandle);

            advance(scheduler, 3);

            expect(spyOld).not.toHaveBeenCalled();
            expect(spyNew).toHaveBeenCalledOnce();
        });
    });

    describe('isPending', () => {
        it('returns true for a pending callback', () => {
            const scheduler = new TickScheduler();
            const handle = scheduler.schedule(5, () => {});

            expect(scheduler.isPending(handle)).toBe(true);
        });

        it('returns false after the callback has fired', () => {
            const scheduler = new TickScheduler();
            const handle = scheduler.schedule(2, () => {});

            advance(scheduler, 2);
            expect(scheduler.isPending(handle)).toBe(false);
        });

        it('returns false after cancellation', () => {
            const scheduler = new TickScheduler();
            const handle = scheduler.schedule(5, () => {});

            scheduler.cancel(handle);
            expect(scheduler.isPending(handle)).toBe(false);
        });

        it('returns false for NO_HANDLE', () => {
            const scheduler = new TickScheduler();
            expect(scheduler.isPending(NO_HANDLE)).toBe(false);
        });
    });

    describe('NO_HANDLE cancel is a no-op', () => {
        it('does not throw when cancelling NO_HANDLE', () => {
            const scheduler = new TickScheduler();
            expect(() => scheduler.cancel(NO_HANDLE)).not.toThrow();
        });

        it('does not affect pending callbacks when cancelling NO_HANDLE', () => {
            const scheduler = new TickScheduler();
            const spy = vi.fn();

            scheduler.schedule(2, spy);
            scheduler.cancel(NO_HANDLE);

            advance(scheduler, 2);
            expect(spy).toHaveBeenCalledOnce();
        });
    });

    describe('currentTick', () => {
        it('starts at 0 and increments with each tick', () => {
            const scheduler = new TickScheduler();
            expect(scheduler.currentTick).toBe(0);

            advance(scheduler, 3);
            expect(scheduler.currentTick).toBe(3);
        });
    });

    describe('destroy', () => {
        it('clears all state and resets tick counter', () => {
            const scheduler = new TickScheduler();
            const spy = vi.fn();

            scheduler.schedule(2, spy);
            advance(scheduler, 1);
            expect(scheduler.currentTick).toBe(1);

            scheduler.destroy();

            expect(scheduler.currentTick).toBe(0);

            // The previously scheduled callback should not fire
            advance(scheduler, 5);
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('recurring pattern', () => {
        it('supports recurring callbacks by re-scheduling from within the callback', () => {
            const scheduler = new TickScheduler();
            const ticks: number[] = [];

            function reschedule(): void {
                ticks.push(scheduler.currentTick);
                scheduler.schedule(3, reschedule);
            }

            scheduler.schedule(3, reschedule);

            advance(scheduler, 12);
            // Should fire at ticks 3, 6, 9, 12
            expect(ticks).toEqual([3, 6, 9, 12]);
        });
    });
});
