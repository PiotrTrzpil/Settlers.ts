/**
 * Script Loader - Loads Lua scripts from map files
 *
 * Settlers 4 maps can contain embedded Lua scripts that define
 * victory conditions, spawn events, and other game logic.
 */

import { LogHandler } from '@/utilities/log-handler';

const log = new LogHandler('ScriptLoader');

/**
 * Script source information
 */
export interface ScriptSource {
    /** Script code content */
    code: string;
    /** Source identifier (filename or 'embedded') */
    source: string;
}

/**
 * Load script from a map file's script chunk.
 *
 * @param scriptData Raw script data from map file
 * @returns Decoded script source or null if invalid
 */
export function loadScriptFromMapData(scriptData: ArrayBuffer | Uint8Array): ScriptSource | null {
    try {
        // Script chunk format: typically raw UTF-8 or Windows-1252 encoded text
        const data = scriptData instanceof ArrayBuffer
            ? new Uint8Array(scriptData)
            : scriptData;

        // Try UTF-8 first
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let code = decoder.decode(data);

        // Clean up: remove null terminators and normalize line endings
        code = code.replace(/\0+$/, '').replace(/\r\n/g, '\n').trim();

        if (!code) {
            log.warn('Empty script data');
            return null;
        }

        return {
            code,
            source: 'embedded',
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`Failed to load script from map data: ${msg}`);
        return null;
    }
}

/**
 * Load script from a string (for testing or external scripts).
 *
 * @param code Script code
 * @param source Optional source identifier
 */
export function loadScriptFromString(code: string, source = 'inline'): ScriptSource {
    return {
        code: code.trim(),
        source,
    };
}

/**
 * Validate that a script has basic required structure.
 *
 * @param code Script code to validate
 * @returns True if script appears valid
 */
export function validateScript(code: string): boolean {
    // Basic checks
    if (!code || typeof code !== 'string') {
        return false;
    }

    const trimmed = code.trim();
    if (trimmed.length === 0) {
        return false;
    }

    // Check for obvious Lua syntax patterns
    // Functions, events, control flow, or simple statements (assignments, calls)
    const hasFunction = /function\s+\w+/.test(code);
    const hasEventReg = /Events\.\w+\s*\(/.test(code);
    const hasLuaConstruct = /if\s+|while\s+|for\s+|return\s+/.test(code);
    const hasAssignment = /\w+\s*=/.test(code); // variable = value
    const hasFunctionCall = /\w+\s*\(/.test(code); // function calls

    return hasFunction || hasEventReg || hasLuaConstruct || hasAssignment || hasFunctionCall;
}

/**
 * Extract metadata comments from script header.
 * Some scripts include metadata like author, version, description.
 *
 * @param code Script code
 * @returns Metadata key-value pairs
 */
export function extractScriptMetadata(code: string): Record<string, string> {
    const metadata: Record<string, string> = {};

    // Look for header comments with metadata format: -- @key: value
    const headerMatch = code.match(/^((?:\s*--[^\n]*\n)+)/);
    if (!headerMatch) {
        return metadata;
    }

    const headerLines = headerMatch[1].split('\n');
    for (const line of headerLines) {
        const metaMatch = line.match(/^\s*--\s*@(\w+):\s*(.+)$/);
        if (metaMatch) {
            metadata[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
        }
    }

    return metadata;
}
