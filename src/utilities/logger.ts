/**
 * Structured logging via loglevel with per-module named loggers.
 *
 * Usage:
 *   import { createLogger } from '@/utilities/logger';
 *   const log = createLogger('MyModule');
 *   log.debug('verbose detail');   // suppressed by default
 *   log.info('operational info');  // suppressed by default
 *   log.warn('something off');     // shown
 *   log.error('broken');           // shown
 *
 * Control levels at runtime (browser console):
 *   import log from 'loglevel';
 *   log.getLogger('MyModule').setLevel('debug');   // enable debug for one module
 *   log.setLevel('debug');                         // enable debug globally
 *
 * Levels persist in localStorage automatically.
 */

import log from 'loglevel';
import { LogHandler } from './log-handler';

export type Logger = log.Logger;
import { LogType } from './log-manager';

const logManager = LogHandler.getLogManager();

const METHOD_TO_TYPE: Record<string, LogType> = {
    trace: LogType.Debug,
    debug: LogType.Debug,
    info: LogType.Info,
    warn: LogType.Warn,
    error: LogType.Error,
};

log.setDefaultLevel('warn');

/**
 * Create a named logger. Default level is 'warn' (debug/info suppressed).
 * Each logger's level can be changed independently at runtime.
 */
export function createLogger(name: string): log.Logger {
    const logger = log.getLogger(name);

    logger.methodFactory = (methodName, _logLevel, loggerName) => {
        return (...args: unknown[]) => {
            // Feed into LogManager buffer for the UI log panel
            const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
            logManager.record({
                type: METHOD_TO_TYPE[methodName] ?? LogType.Debug,
                source: String(loggerName),
                msg,
            });
            // Late-bind console access so CLI console capture intercepts these messages.
            // loglevel's default factory early-binds via .bind(), which bypasses any
            // later console patches (e.g. GameCli.installConsoleCapture).
            const fn = console[methodName as 'log' | 'warn' | 'error' | 'debug' | 'info'];
            fn.call(console, ...args);
        };
    };

    // Apply the custom factory (loglevel requires this after setting methodFactory)
    logger.setLevel(logger.getLevel());
    return logger;
}
