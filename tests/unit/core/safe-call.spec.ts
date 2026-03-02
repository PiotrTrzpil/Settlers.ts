import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeCall } from '@/game/features/settler-tasks/safe-call';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { LogHandler } from '@/utilities/log-handler';

function makeLogger(): ThrottledLogger {
    const log = new LogHandler('test');
    vi.spyOn(log, 'error').mockImplementation(() => {});
    // ThrottledLogger with 0ms throttle so every call goes through
    return new ThrottledLogger(log, 0);
}

describe('safeCall', () => {
    let logger: ThrottledLogger;
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logger = makeLogger();
        // Spy on the public error method
        logSpy = vi.spyOn(logger, 'error');
    });

    it('returns the function result on success', () => {
        const result = safeCall(() => 42, logger, 'label');
        expect(result).toBe(42);
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('returns undefined and logs when fn throws an Error', () => {
        const result = safeCall(
            () => {
                throw new Error('boom');
            },
            logger,
            'the label'
        );
        expect(result).toBeUndefined();
        expect(logSpy).toHaveBeenCalledWith('the label', expect.any(Error));
        expect(logSpy.mock.calls[0][1].message).toBe('boom');
    });

    it('wraps non-Error throws in an Error before logging', () => {
        safeCall(
            () => {
                throw 'raw string';
            },
            logger,
            'lbl'
        );
        const logged = logSpy.mock.calls[0][1] as Error;
        expect(logged).toBeInstanceOf(Error);
        expect(logged.message).toBe('raw string');
    });

    it('returns undefined (void) on successful void call — same value as error sentinel', () => {
        // Callers that need to distinguish must wrap void calls: () => { fn(); return true; }
        const result = safeCall(
            () => {
                /* void */
            },
            logger,
            'label'
        );
        expect(result).toBeUndefined();
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('boolean-guard pattern: wrapping void call to distinguish success from error', () => {
        let called = false;
        const ok = safeCall(
            () => {
                called = true;
                return true;
            },
            logger,
            'label'
        );
        expect(ok).toBe(true);
        expect(called).toBe(true);
        expect(logSpy).not.toHaveBeenCalled();

        const fail = safeCall(
            () => {
                throw new Error('x');
                return true;
            },
            logger,
            'label'
        );
        expect(fail).toBeUndefined(); // falsy → caller treats as error
    });

    it('passes null return values through unchanged', () => {
        const result = safeCall(() => null, logger, 'label');
        expect(result).toBeNull();
        expect(logSpy).not.toHaveBeenCalled();
    });
});
