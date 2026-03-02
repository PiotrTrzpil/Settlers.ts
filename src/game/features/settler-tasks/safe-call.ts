import type { ThrottledLogger } from '@/utilities/throttled-logger';

/**
 * Execute fn, log any thrown error via logger.error(label, err), and return the result.
 * Returns undefined if fn throws. Never throws itself.
 *
 * Usage — void (just log):
 *   safeCall(() => handler.onWorkComplete?.(id), ctx.handlerErrorLogger, `label`);
 *
 * Usage — return value (treat undefined as failure):
 *   const done = safeCall(() => handler.onWorkTick(id, t), ctx.handlerErrorLogger, `label`);
 *   if (done === undefined) return TaskResult.FAILED;
 *
 * Usage — boolean guard (wrap void call to signal success):
 *   const ok = safeCall(() => { handler.onWorkStart?.(id); return true; }, logger, `label`);
 *   if (!ok) return false;
 */
export function safeCall<T>(fn: () => T, logger: ThrottledLogger, label: string): T | undefined {
    try {
        return fn();
    } catch (e) {
        logger.error(label, e instanceof Error ? e : new Error(String(e)));
        return undefined;
    }
}
