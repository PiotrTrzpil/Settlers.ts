/**
 * Debug API - Debugging and logging functions
 * Implements global debug functions and Debug.* table
 */

import { LogHandler } from '@/utilities/log-handler';
import type { LuaRuntime } from '../lua-runtime';

const log = new LogHandler('LuaScript');

export interface DebugAPIContext {
    /** Whether debug mode is enabled */
    debugEnabled: boolean;
}

/**
 * Register the Debug API with the Lua runtime
 */
export function registerDebugAPI(runtime: LuaRuntime, context: DebugAPIContext): void {
    // Create Debug table
    runtime.createTable('Debug');

    // Debug.Enabled - Check if debug mode is on
    runtime.setTableField('Debug', 'Enabled', context.debugEnabled);

    // Debug.Log(message) - Log a debug message
    runtime.registerFunction('Debug', 'Log', (message: string) => {
        if (context.debugEnabled) {
            log.debug(`[Script] ${message}`);
        }
    });

    // Debug.Warn(message) - Log a warning
    runtime.registerFunction('Debug', 'Warn', (message: string) => {
        log.warn(`[Script] ${message}`);
    });

    // Debug.Error(message) - Log an error
    runtime.registerFunction('Debug', 'Error', (message: string) => {
        log.error(`[Script] ${message}`);
    });

    // Global print function (S4 compatibility)
    runtime.registerGlobalFunction('print', (...args: any[]) => {
        const message = args.map(arg => String(arg)).join('\t');
        log.info(`[Script] ${message}`);
    });

    // RTSPrint - S4 specific print function
    runtime.registerGlobalFunction('RTSPrint', (message: string) => {
        log.info(`[Script] ${message}`);
    });

    // RTSDebug - S4 debug function
    runtime.registerGlobalFunction('RTSDebug', (message: string) => {
        if (context.debugEnabled) {
            log.debug(`[Script] ${message}`);
        }
    });

    log.debug('Debug API registered');
}
