/**
 * LuaScriptSystem - Game system that manages Lua script execution
 *
 * This system integrates with the game loop to:
 * - Initialize Lua runtime with all APIs
 * - Load and execute map scripts
 * - Dispatch game events to Lua handlers
 * - Clean up resources on game end
 */

import { LogHandler } from '@/utilities/log-handler';
import { LuaRuntime } from './lua-runtime';
import { LuaEventDispatcher, ScriptEventType } from './event-dispatcher';
import { applyLuaCompatShim } from './lua-compat';
import {
    registerGameAPI,
    registerSettlersAPI,
    registerBuildingsAPI,
    registerMapAPI,
    registerGoodsAPI,
    registerDebugAPI,
    registerAIAPI,
    type GameAPIContext,
    type SettlersAPIContext,
    type BuildingsAPIContext,
    type MapAPIContext,
    type GoodsAPIContext,
    type DebugAPIContext,
    type AIAPIContext,
} from './api';
import { loadScriptFromString, validateScript, type ScriptSource } from './script-loader';
import type { GameState } from '@/game/game-state';
import type { IMapLandscape } from '@/resources/map/imap-landscape';

const log = new LogHandler('LuaScriptSystem');

/**
 * Configuration for the Lua script system
 */
export interface LuaScriptSystemConfig {
    /** Game state instance */
    gameState: GameState;
    /** Map dimensions */
    mapWidth: number;
    mapHeight: number;
    /** Optional landscape data */
    landscape?: IMapLandscape;
    /** Direct terrain arrays (alternative to landscape) */
    groundType?: Uint8Array;
    groundHeight?: Uint8Array;
    /** Local player index */
    localPlayer?: number;
    /** Total player count */
    playerCount?: number;
    /** Difficulty level */
    difficulty?: number;
    /** Enable debug mode */
    debugEnabled?: boolean;
}

/**
 * Lua Script System
 *
 * Manages the lifecycle of Lua scripting for a game session.
 * Implements TickSystem interface for game loop integration.
 */
export class LuaScriptSystem {
    private runtime: LuaRuntime | null = null;
    private eventDispatcher: LuaEventDispatcher | null = null;
    private config: LuaScriptSystemConfig;
    private gameTime = 0;
    private tickCount = 0;
    private isInitialized = false;
    private isFirstTick = true;
    private scriptLoaded = false;

    constructor(config: LuaScriptSystemConfig) {
        this.config = config;
    }

    /**
     * Initialize the Lua runtime and register all APIs.
     * Call this before loading any scripts.
     */
    public initialize(): void {
        if (this.isInitialized) {
            log.warn('LuaScriptSystem already initialized');
            return;
        }

        log.info('Initializing Lua script system');

        // Create runtime
        this.runtime = new LuaRuntime();

        // Apply Lua 3.2 compatibility shim
        applyLuaCompatShim(this.runtime);

        // Create event dispatcher
        this.eventDispatcher = new LuaEventDispatcher(this.runtime);
        this.eventDispatcher.registerEventsAPI();

        // Register all APIs
        this.registerAPIs();

        this.isInitialized = true;
        log.info('Lua script system initialized');
    }

    /**
     * Register all Lua API modules
     */
    private registerAPIs(): void {
        if (!this.runtime) return;

        // Game API context
        const gameContext: GameAPIContext = {
            gameState: this.config.gameState,
            gameTime: this.gameTime,
            localPlayer: this.config.localPlayer ?? 0,
            playerCount: this.config.playerCount ?? 1,
            difficulty: this.config.difficulty ?? 1,
            mapWidth: this.config.mapWidth,
            mapHeight: this.config.mapHeight,
            onPlayerWon: (player) => {
                log.info(`Player ${player} won!`);
                // TODO: Trigger victory screen
            },
            onPlayerLost: (player) => {
                log.info(`Player ${player} lost!`);
                // TODO: Trigger defeat screen
            },
        };
        registerGameAPI(this.runtime, gameContext);

        // Settlers API context
        const settlersContext: SettlersAPIContext = {
            gameState: this.config.gameState,
        };
        registerSettlersAPI(this.runtime, settlersContext);

        // Buildings API context
        const buildingsContext: BuildingsAPIContext = {
            gameState: this.config.gameState,
        };
        registerBuildingsAPI(this.runtime, buildingsContext);

        // Map API context
        const mapContext: MapAPIContext = {
            mapWidth: this.config.mapWidth,
            mapHeight: this.config.mapHeight,
            landscape: this.config.landscape,
            groundType: this.config.groundType,
            groundHeight: this.config.groundHeight,
        };
        registerMapAPI(this.runtime, mapContext);

        // Goods API context
        const goodsContext: GoodsAPIContext = {
            gameState: this.config.gameState,
        };
        registerGoodsAPI(this.runtime, goodsContext);

        // Debug API context
        const debugContext: DebugAPIContext = {
            debugEnabled: this.config.debugEnabled ?? false,
        };
        registerDebugAPI(this.runtime, debugContext);

        // AI API context
        const aiContext: AIAPIContext = {
            gameState: this.config.gameState,
        };
        registerAIAPI(this.runtime, aiContext);
    }

    /**
     * Load and execute a script.
     *
     * @param script Script source to load
     * @returns True if script loaded successfully
     */
    public loadScript(script: ScriptSource): boolean {
        if (!this.runtime || !this.isInitialized) {
            log.error('Cannot load script: system not initialized');
            return false;
        }

        if (!validateScript(script.code)) {
            log.warn(`Invalid script from ${script.source}`);
            return false;
        }

        try {
            log.info(`Loading script from ${script.source}`);
            this.runtime.execute(script.code);
            this.scriptLoaded = true;
            log.info('Script loaded successfully');
            return true;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            log.error(`Failed to load script: ${msg}`);
            return false;
        }
    }

    /**
     * Load a script from a string.
     *
     * @param code Script code
     * @param source Optional source identifier
     */
    public loadScriptCode(code: string, source = 'inline'): boolean {
        return this.loadScript(loadScriptFromString(code, source));
    }

    /**
     * Tick handler - called every game tick.
     * Dispatches tick events to Lua handlers.
     *
     * @param deltaTime Time since last tick in seconds
     */
    public tick(deltaTime: number): void {
        if (!this.isInitialized || !this.eventDispatcher) return;

        this.gameTime += deltaTime;
        this.tickCount++;

        // First tick events
        if (this.isFirstTick && this.scriptLoaded) {
            this.isFirstTick = false;
            this.eventDispatcher.dispatch('FIRST_TICK_OF_NEW_GAME');
            this.eventDispatcher.dispatch('FIRST_TICK_OF_NEW_OR_LOADED_GAME');
        }

        // Regular tick event
        this.eventDispatcher.dispatch('TICK');

        // Every 5 ticks
        if (this.tickCount % 5 === 0) {
            this.eventDispatcher.dispatch('FIVE_TICKS');
        }

        // Victory condition check (every ~30 ticks)
        if (this.tickCount % 30 === 0) {
            this.eventDispatcher.dispatch('VICTORY_CONDITION_CHECK');
        }
    }

    /**
     * Dispatch a custom event to Lua handlers.
     *
     * @param event Event type
     * @param args Arguments to pass to handlers
     */
    public dispatchEvent(event: ScriptEventType, ...args: unknown[]): void {
        if (!this.eventDispatcher) return;
        this.eventDispatcher.dispatch(event, ...args);
    }

    /**
     * Call a global Lua function by name.
     *
     * @param name Function name
     * @param args Arguments to pass
     * @returns Return value from Lua function
     */
    public callFunction(name: string, ...args: unknown[]): unknown {
        if (!this.runtime) return undefined;
        return this.runtime.callFunction(name, ...args);
    }

    /**
     * Check if a global function exists in the Lua environment.
     */
    public hasFunction(name: string): boolean {
        if (!this.runtime) return false;
        return this.runtime.hasFunction(name);
    }

    /**
     * Get a global variable from Lua.
     */
    public getGlobal(name: string): unknown {
        if (!this.runtime) return undefined;
        return this.runtime.getGlobal(name);
    }

    /**
     * Set a global variable in Lua.
     */
    public setGlobal(name: string, value: unknown): void {
        if (!this.runtime) return;
        this.runtime.setGlobal(name, value);
    }

    /**
     * Check if the system is initialized and ready.
     */
    public get ready(): boolean {
        return this.isInitialized;
    }

    /**
     * Check if a script has been loaded.
     */
    public get hasScript(): boolean {
        return this.scriptLoaded;
    }

    /**
     * Get current game time in seconds.
     */
    public get time(): number {
        return this.gameTime;
    }

    /**
     * Clean up the Lua runtime and release resources.
     */
    public destroy(): void {
        if (this.eventDispatcher) {
            this.eventDispatcher.clearAllHandlers();
            this.eventDispatcher = null;
        }

        if (this.runtime) {
            this.runtime.destroy();
            this.runtime = null;
        }

        this.isInitialized = false;
        this.scriptLoaded = false;
        this.isFirstTick = true;
        this.gameTime = 0;
        this.tickCount = 0;

        log.info('Lua script system destroyed');
    }
}
