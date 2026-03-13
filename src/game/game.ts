import { FileManager } from '@/utilities/file-manager';
import { IMapLoader } from '@/resources/map/imap-loader';
import { GameCore } from './game-core';
import { GameLoop } from './game-loop';
import { SoundManager } from './audio';
import { loadSavedRace } from './core/race';
import { toastError } from './ui/toast-notifications';
import { GameViewState } from './ui/game-view-state';
import { setDirectionRunLength } from './systems/pathfinding';
import { watch } from 'vue';
import type { FrameRenderTiming } from './renderer/renderer';
import { debugStats } from './debug/debug-stats';
import { getBridge } from './debug/debug-bridge';
import type { SystemState } from './game-loop';
import { loadInitialState, restoreFromSnapshot, restoreInitialTerrain } from './state/game-state-persistence';
import { createCli } from '@/game/cli';
import { connectCliWs } from '@/game/cli/ws-client';
import { TimelineCapture } from '@/game/debug/timeline-capture';

// Scripting is loaded dynamically to avoid bundling Lua when disabled
type ScriptLoadResult = { success: boolean; scriptPath: string | null; error?: string };

/**
 * Interface for the dynamically-loaded ScriptService.
 * Matches the public API of ScriptService without importing it.
 */
interface IScriptService {
    loadScriptForMap(mapFilename: string): Promise<ScriptLoadResult>;
    destroy(): void;
}

/** Browser-facing game class — extends GameCore with UI, audio, and render loop. */
export class Game extends GameCore {
    public fileManager: FileManager;

    /** Reactive bridge between GameState and Vue components */
    public readonly viewState: GameViewState;

    /** Frame loop — private; use delegation methods on Game instead */
    private readonly _gameLoop: GameLoop;

    // Script service is optional - only loaded when Lua is enabled
    private scriptService: IScriptService | null = null;

    /** Callback to sync Territory feature toggle with visual layer visibility */
    private _onTerritoryToggle: ((enabled: boolean) => void) | null = null;

    /** Stop handle for the pathStraightness watcher — must be called in destroy() */
    private readonly _stopPathWatcher: () => void;

    /** Timeline capture instance (dev-only, null in production). */
    private _timelineCapture: TimelineCapture | null = null;

    /** Current interaction mode */
    public mode: string = 'select';

    /** Building type to place (when mode === 'place_building') */
    public placeBuildingType = 0;

    /** When true, renderers use procedural textures instead of loading game assets */
    public useProceduralTextures = false;

    public constructor(fileManager: FileManager, mapLoader: IMapLoader) {
        const start = performance.now();
        const mlt = debugStats.state.mapLoadTimings;

        super(mapLoader);

        mlt.terrain = Math.round(performance.now() - start);

        this.fileManager = fileManager;
        this.eventBus.onHandlerError = (event, err) => toastError('EventBus', `${event}: ${err.message}`);
        this.viewState = new GameViewState();

        // Sync pathfinding direction run length from settings (initial + reactive).
        // Store stop handle so the watcher is cleaned up in destroy(), preventing leaks.
        this._stopPathWatcher = watch(
            () => this.settings.state.pathStraightness,
            v => setDirectionRunLength(v)
        );

        const initStart = performance.now();

        // Create frame loop and register tick systems
        this._gameLoop = new GameLoop(this.state, this.services.visualService, this.settings.state, this.viewState);
        for (const { system, group } of this.services.getTickSystems()) {
            this._gameLoop.registerSystem(system, group);
        }

        // Register feature toggles
        this._gameLoop.registerFeatureToggle({
            name: 'Territory',
            group: 'World',
            get: () => this.territoryEnabled,
            set: v => {
                this.setTerritoryEnabled(v);
                this._onTerritoryToggle?.(v);
            },
        });

        // Restore feature toggles from localStorage (features panel may not mount immediately)
        this.restoreFeatureToggles();

        // Wire entity removal notifications to tick systems
        this.eventBus.on('entity:removed', ({ entityId }) => {
            this._gameLoop.notifyEntityRemoved(entityId);
        });
        mlt.gameInit = Math.round(performance.now() - initStart);

        // Initialize Audio (async init called from constructor — sonarjs/no-async-constructor)
        // eslint-disable-next-line sonarjs/no-async-constructor -- fire-and-forget audio init, failure is non-fatal
        this.soundManager
            .init(this.fileManager)
            .then(() => {
                const playerRace = this.playerRaces.get(this.currentPlayer);
                this.soundManager.playRandomMusic(playerRace ?? loadSavedRace());
            })
            .catch((err: unknown) => {
                console.warn('Game: SoundManager initialization failed:', err);
            });

        // Debug helper (typed via env.d.ts)
        window.debugSound = () => {
            console.log('--- Sound Debug ---');
            console.log('Current Music ID:', this.soundManager.currentMusicId);
            console.log('Audio Context State:', Howler.ctx.state);
        };

        // Wire CLI engine and expose on debug bridge
        const cli = createCli(this);
        getBridge().cli = cli;
        connectCliWs(cli);

        // Wire timeline capture (dev-only) — captures EventBus.emit() calls
        // and flushes batches to any WS subscriber via the debug bridge.
        if (import.meta.env.DEV) {
            const capture = new TimelineCapture();
            capture.start(this.eventBus, () => debugStats.state.tickCount);
            this._timelineCapture = capture;
            getBridge().timelineCapture = capture;
        }

        mlt.gameConstructor = Math.round(performance.now() - start);
        mlt.mapSize = `${this.terrain.width}x${this.terrain.height}`;
        mlt.entityCount = this.state.entities.length;
        console.log(
            `[${performance.now().toFixed(0)}ms] Game\tMap loaded: ${this.terrain.width}x${this.terrain.height} in ${mlt.gameConstructor}ms`
        );
    }

    public get soundManager(): SoundManager {
        return SoundManager.getInstance();
    }

    /**
     * Remove every entity from the map, leaving only bare terrain.
     * All entities (units, buildings, trees, stones, piles, decorations) are removed
     * via the command pipeline so cleanup handlers run properly.
     *
     * @param resetTerrain If true, also restores terrain ground types and heights
     *                     to the initial map state (reverting leveling, roads, etc.).
     */
    public clearAllEntities(options: { resetTerrain?: boolean } = {}): void {
        const ids = this.state.entities.map(e => e.id);
        for (const id of ids) {
            this.execute({ type: 'remove_entity', entityId: id });
        }
        if (options.resetTerrain) {
            restoreInitialTerrain(this);
        }
    }

    /**
     * Reset game to initial map state via the persistence pipeline.
     * Removes all entities, recreates from snapshot, restores all feature state.
     * Initial state is always saved at map load time (saveInitialState).
     */
    public restoreToInitialState(): void {
        const snapshot = loadInitialState();
        if (!snapshot) {
            throw new Error(
                'Game.restoreToInitialState: no initial state — saveInitialState must be called at map load'
            );
        }
        restoreFromSnapshot(this, snapshot);
    }

    /**
     * Load and execute a Lua script for the map.
     * Scripting is only loaded when enabled in settings.
     */
    public async loadScript(mapFilename: string): Promise<ScriptLoadResult> {
        // Check if Lua scripting is enabled
        try {
            if (localStorage.getItem('settlers_luaEnabled') !== 'true') {
                return { success: false, scriptPath: null, error: 'Lua scripting disabled' };
            }
        } catch {
            return { success: false, scriptPath: null, error: 'Lua scripting disabled' };
        }

        // Dynamically import scripting module to avoid bundling when disabled
        try {
            const { ScriptService } = await import('./scripting');

            if (!this.scriptService) {
                const service = new ScriptService({
                    gameState: this.state,
                    constructionSiteManager: this.services.constructionSiteManager,
                    mapWidth: this.terrain.width,
                    mapHeight: this.terrain.height,
                    landscape: this.mapLoader.landscape,
                    playerRaces: this.playerRaces,
                    executeCommand: this.execute.bind(this),
                });
                await service.initialize();
                this._gameLoop.registerSystem(service, 'Scripting');
                this.scriptService = service;
            }

            return this.scriptService.loadScriptForMap(mapFilename);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { success: false, scriptPath: null, error: msg };
        }
    }

    // ===== Frame loop delegation =====

    /** Start the game loop */
    public start(): void {
        this._gameLoop.start();
    }

    /** Stop the game loop */
    public stop(): void {
        this._gameLoop.stop();
    }

    /** Whether the game loop is currently running */
    public get isRunning(): boolean {
        return this._gameLoop.isRunning;
    }

    /** Enable game ticks (call after sprites are loaded) */
    public enableTicks(): void {
        this._gameLoop.enableTicks();
    }

    /** Set the per-frame render callback */
    public setRenderCallback(callback: (alpha: number, deltaSec: number) => FrameRenderTiming | null): void {
        this._gameLoop.setRenderCallback(callback);
    }

    /** Set the per-frame update callback (input, sound, debug stats) */
    public setUpdateCallback(callback: (deltaSec: number) => void): void {
        this._gameLoop.setUpdateCallback(callback);
    }

    /** Get the name, group, and enabled state of every registered system and feature toggle */
    public getSystemStates(): SystemState[] {
        return this._gameLoop.getSystemStates();
    }

    /** Enable or disable a tick system by name */
    public setSystemEnabled(name: string, enabled: boolean): void {
        this._gameLoop.setSystemEnabled(name, enabled);
    }

    /**
     * Register a callback to sync the Territory feature toggle with visual layer visibility.
     * Called from the Vue layer so the game can update showTerritory when the toggle changes.
     */
    public onTerritoryToggle(callback: (enabled: boolean) => void): void {
        this._onTerritoryToggle = callback;
        // Fire immediately with current state so visual matches on connect
        callback(this.territoryEnabled);
    }

    private static readonly FEATURE_STORAGE_KEY = 'settlers-feature-toggles';

    /** Restore feature toggle states from localStorage at game init */
    private restoreFeatureToggles(): void {
        try {
            const raw = localStorage.getItem(Game.FEATURE_STORAGE_KEY);
            if (!raw) {
                return;
            }
            const saved = JSON.parse(raw) as Record<string, boolean>;
            for (const [name, enabled] of Object.entries(saved)) {
                this._gameLoop.setSystemEnabled(name, enabled);
            }
        } catch {
            // localStorage may be unavailable
        }
    }

    /** Destroy the game and clean up all resources */
    public override destroy(): void {
        this._timelineCapture?.stop();
        this._stopPathWatcher();
        this.soundManager.unload();
        this.scriptService?.destroy();
        this._gameLoop.destroy();
        super.destroy();
    }
}
