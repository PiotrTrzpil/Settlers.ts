/**
 * Script Service - Manages loading and executing map scripts
 *
 * Handles:
 * - Deriving script path from map filename
 * - Fetching script files from the server
 * - Initializing and managing the LuaScriptSystem lifecycle
 */

import { LogHandler } from '@/utilities/log-handler';
import { LuaScriptSystem, type LuaScriptSystemConfig } from './lua-script-system';
import type { ScriptEventType } from './event-dispatcher';
import type { TickSystem } from '../core/tick-system';
import { MapStartResources } from '@/resources/map/map-start-resources';
import type { MapPlayerInfo } from '@/resources/map/map-entity-data';

const log = new LogHandler('ScriptService');

/** Script loading result */
export interface ScriptLoadResult {
    success: boolean;
    scriptPath: string | null;
    error?: string;
}

/**
 * Derive the script path from a map filename.
 *
 * Map files follow naming conventions that match their scripts:
 * - roman01.map -> Script/roman01.txt
 * - Tutorial01.map -> Script/Tutorial01.txt
 * - MCD2_maya1.edm -> Script/MCD2_maya1.txt
 *
 * @param mapFilename The map filename (with or without path)
 * @returns The script path relative to Siedler4 folder, or null if cannot derive
 */
export function deriveScriptPath(mapFilename: string): string | null {
    if (!mapFilename) {
        return null;
    }

    // Extract just the filename without path
    const filename = mapFilename.split('/').pop()?.split('\\').pop();
    if (!filename) {
        return null;
    }

    // Remove extension (.map, .edm, .exe for savegames)
    const baseName = filename.replace(/\.(map|edm|exe)$/i, '');
    if (!baseName || baseName === filename) {
        // No recognized extension found
        return null;
    }

    return `Script/${baseName}.txt`;
}

/** Map start resources enum to the Lua function name in StartResources.txt */
const START_RESOURCES_FUNC: Record<number, string> = {
    [MapStartResources.low]: 'CreateStartResourcesFew',
    [MapStartResources.medium]: 'CreateStartResourcesMedium',
    [MapStartResources.high]: 'CreateStartResourcesMany',
};

/**
 * Script Service
 *
 * Wraps LuaScriptSystem and provides high-level script loading capabilities.
 * Implements TickSystem so it can be registered with the GameLoop.
 */
export class ScriptService implements TickSystem {
    private scriptSystem: LuaScriptSystem | null = null;
    private config: Omit<LuaScriptSystemConfig, 'gameState'> & { gameState: LuaScriptSystemConfig['gameState'] };
    private scriptPath: string | null = null;

    constructor(config: LuaScriptSystemConfig) {
        this.config = config;
    }

    /**
     * Initialize the Lua runtime. Call before loading scripts.
     */
    // eslint-disable-next-line @typescript-eslint/require-await -- kept async for API compatibility
    public async initialize(): Promise<void> {
        if (this.scriptSystem) {
            log.warn('ScriptService already initialized');
            return;
        }

        this.scriptSystem = new LuaScriptSystem(this.config);
        this.scriptSystem.initialize();
        log.info('ScriptService initialized');
    }

    /**
     * Load a script from a URL path.
     *
     * @param scriptPath Path to the script file (relative to public folder)
     * @param basePath Base path prefix (default: '/Siedler4/')
     * @returns Load result with success status
     */
    public async loadScriptFromPath(scriptPath: string, basePath = '/Siedler4/'): Promise<ScriptLoadResult> {
        if (!this.scriptSystem) {
            return { success: false, scriptPath: null, error: 'ScriptService not initialized' };
        }

        const fullPath = `${basePath}${scriptPath}`;
        this.scriptPath = fullPath;

        try {
            log.info(`Fetching script: ${fullPath}`);
            const response = await fetch(fullPath);

            if (!response.ok) {
                if (response.status === 404) {
                    log.info(`No script found at ${fullPath}`);
                    return { success: false, scriptPath: fullPath, error: 'Script not found' };
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const scriptCode = await response.text();

            if (!scriptCode.trim()) {
                log.warn(`Empty script at ${fullPath}`);
                return { success: false, scriptPath: fullPath, error: 'Empty script' };
            }

            const loaded = this.scriptSystem.loadScriptCode(scriptCode, scriptPath);

            if (loaded) {
                log.info(`Script loaded successfully: ${scriptPath}`);

                // Call new_game() if it exists (most scripts define this entry point)
                if (this.scriptSystem.hasFunction('new_game')) {
                    log.info('Calling new_game()');
                    await this.scriptSystem.callFunction('new_game');
                }

                return { success: true, scriptPath: fullPath };
            } else {
                return { success: false, scriptPath: fullPath, error: 'Script validation failed' };
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log.error(`Failed to load script from ${fullPath}: ${msg}`);
            return { success: false, scriptPath: fullPath, error: msg };
        }
    }

    /**
     * Load a script for a map file.
     *
     * Automatically derives the script path from the map filename.
     *
     * @param mapFilename The map filename
     * @returns Load result
     */
    public async loadScriptForMap(mapFilename: string): Promise<ScriptLoadResult> {
        const scriptPath = deriveScriptPath(mapFilename);

        if (!scriptPath) {
            log.info(`Cannot derive script path from: ${mapFilename}`);
            return { success: false, scriptPath: null, error: 'Cannot derive script path' };
        }

        return this.loadScriptFromPath(scriptPath);
    }

    /**
     * Load and execute Internal/StartResources.txt, then call the appropriate
     * CreateStartResources* function for each player based on the map's
     * start resources setting.
     *
     * Must be called after initialize() but before loading the map script,
     * so the start resource functions are available in the Lua environment.
     */
    public async loadStartResources(
        startResources: MapStartResources,
        players: MapPlayerInfo[]
    ): Promise<ScriptLoadResult> {
        if (!this.scriptSystem) {
            return { success: false, scriptPath: null, error: 'ScriptService not initialized' };
        }

        if (startResources === MapStartResources.unknown || players.length === 0) {
            log.info('Skipping start resources: no resource level or no players');
            return { success: false, scriptPath: null, error: 'No start resources configured' };
        }

        // Load the StartResources.txt script (defines the functions, doesn't execute them)
        const scriptPath = 'Script/Internal/StartResources.txt';
        const result = await this.loadScriptFromPath(scriptPath);
        if (!result.success) {
            return result;
        }

        // Map start resources enum to the Lua function name
        const funcName = START_RESOURCES_FUNC[startResources];
        if (!funcName || !this.scriptSystem.hasFunction(funcName)) {
            log.warn(`Start resources function not found: ${funcName}`);
            return { success: false, scriptPath, error: `Function ${funcName} not found` };
        }

        // Call the function for each player with a valid start position
        for (const player of players) {
            if (player.startX == null || player.startY == null) {
                continue;
            }
            // AI level: 0 for human (player index matching local), 1+ for AI players
            // For now pass 0 — AI integration will set this properly later
            const aiLevel = 0;
            log.info(`${funcName}(${player.startX}, ${player.startY}, ${player.playerIndex}, ${aiLevel})`);
            this.scriptSystem.callFunction(funcName, player.startX, player.startY, player.playerIndex, aiLevel);
        }

        log.info(`Start resources applied: ${funcName} for ${players.length} player(s)`);
        return { success: true, scriptPath };
    }

    /**
     * Re-apply start resources by calling the appropriate CreateStartResources*
     * function that was previously loaded. Does not re-fetch the script file.
     */
    public applyStartResources(startResources: MapStartResources, players: MapPlayerInfo[]): void {
        if (!this.scriptSystem) {
            return;
        }

        if (startResources === MapStartResources.unknown || players.length === 0) {
            return;
        }

        const funcName = START_RESOURCES_FUNC[startResources];
        if (!funcName || !this.scriptSystem.hasFunction(funcName)) {
            log.warn(`Start resources function not available: ${funcName}`);
            return;
        }

        for (const player of players) {
            if (player.startX == null || player.startY == null) {
                continue;
            }
            const aiLevel = 0;
            log.info(`${funcName}(${player.startX}, ${player.startY}, ${player.playerIndex}, ${aiLevel})`);
            this.scriptSystem.callFunction(funcName, player.startX, player.startY, player.playerIndex, aiLevel);
        }

        log.info(`Start resources re-applied: ${funcName} for ${players.length} player(s)`);
    }

    /**
     * TickSystem implementation - called each game tick.
     */
    public tick(dt: number): void {
        this.scriptSystem?.tick(dt);
    }

    /**
     * Dispatch a custom event to script handlers.
     */
    public dispatchEvent(event: ScriptEventType, ...args: unknown[]): void {
        this.scriptSystem?.dispatchEvent(event, ...args);
    }

    /**
     * Check if the service is initialized.
     */
    public get isInitialized(): boolean {
        // eslint-disable-next-line no-restricted-syntax -- nullable-by-design: scriptSystem is null before initialize(); false is correct before system exists
        return this.scriptSystem?.ready ?? false;
    }

    /**
     * Check if a script has been loaded.
     */
    public get hasScript(): boolean {
        // eslint-disable-next-line no-restricted-syntax -- nullable-by-design: scriptSystem is null before initialize(); false is correct before system exists
        return this.scriptSystem?.hasScript ?? false;
    }

    /**
     * Get the currently loaded script path.
     */
    public get loadedScriptPath(): string | null {
        return this.hasScript ? this.scriptPath : null;
    }

    /**
     * Get the underlying LuaScriptSystem for advanced usage.
     */
    public get lua(): LuaScriptSystem | null {
        return this.scriptSystem;
    }

    /**
     * Clean up resources.
     */
    public destroy(): void {
        if (this.scriptSystem) {
            this.scriptSystem.destroy();
            this.scriptSystem = null;
        }
        this.scriptPath = null;
        log.info('ScriptService destroyed');
    }
}
