/**
 * GameLoop — fixed-timestep frame loop with per-system error isolation.
 *
 * Owns ONLY tick/render scheduling. All domain managers and systems are
 * created by {@link GameServices} and registered here via `registerSystem()`.
 */

import { GameState } from './game-state';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { debugStats } from './debug-stats';
import type { GameSettings } from './game-settings';
import type { GameViewState } from './game-view-state';
import type { TickSystem } from './tick-system';
import type { FrameRenderTiming } from './renderer/renderer';
import { EntityVisualService } from './animation/entity-visual-service';
import { toastError, toastClearThrottle } from './toast-notifications';

const TICK_RATE = 30;
const TICK_DURATION = 1 / TICK_RATE;

/**
 * Base speed multiplier applied on top of the user's gameSpeed setting.
 * The original Settlers 4 runs ~1.5× real-time at "normal" speed;
 * without this factor, speed 1× feels noticeably sluggish.
 */
const BASE_SPEED = 1.5;

/** Target FPS when page is in background (to save CPU/battery) */
const BACKGROUND_FPS = 10;
const BACKGROUND_FRAME_DURATION = 1000 / BACKGROUND_FPS;

/** Consecutive failures before a tick system is disabled */
const SYSTEM_CIRCUIT_BREAKER_THRESHOLD = 100;

/** Per-system error tracking */
interface SystemErrorState {
    name: string;
    group: string;
    consecutiveFailures: number;
    disabled: boolean;
    logger: ThrottledLogger;
}

/** A named boolean toggle that can be displayed in the features panel */
export interface FeatureToggle {
    name: string;
    group?: string;
    /** Names of other toggles/systems this one requires to be enabled */
    requires?: string[];
    get: () => boolean;
    set: (enabled: boolean) => void;
}

/** State of a system or feature toggle, as exposed to the UI */
export interface SystemState {
    name: string;
    group: string;
    enabled: boolean;
    /** Names of other toggles/systems this one requires to be enabled */
    requires: string[];
}

export class GameLoop {
    private static log = new LogHandler('GameLoop');

    /** Track active loops to detect HMR leaks */
    private static activeLoops = 0;

    private accumulator = 0;
    private lastTime = 0;
    private running = false;
    private animRequest = 0;

    /** Throttled loggers for each frame sub-phase (independent cooldowns) */
    private readonly logicPhaseLogger = new ThrottledLogger(GameLoop.log, 1000);
    private readonly animationLogger = new ThrottledLogger(GameLoop.log, 1000);
    private readonly updateLogger = new ThrottledLogger(GameLoop.log, 1000);
    private readonly renderLogger = new ThrottledLogger(GameLoop.log, 1000);

    /** Per-system error tracking for circuit breaker & throttled logging */
    private systemErrors = new Map<TickSystem, SystemErrorState>();

    /** Per-system tick timings from the last tick (system name → total ms) */
    private lastTickSystemTimings: Record<string, number> = {};

    /** Whether the page is currently visible */
    private pageVisible = !document.hidden;
    /** Time of last rendered frame (for background throttling) */
    private lastRenderTime = 0;
    /** Bound visibility handler for cleanup */
    private visibilityHandler: (() => void) | null = null;
    /** Bound frame handler to avoid creating closures every frame */
    private boundFrame: (time: number) => void;

    private readonly gameState: GameState;
    private readonly visualService: EntityVisualService;
    private readonly settings: GameSettings;
    private readonly viewState: GameViewState;

    /** Render callback — ONLY rendering, returns render timing if available */
    private onRender: ((alpha: number, deltaSec: number) => FrameRenderTiming | null) | null = null;

    /** Per-frame update callback — non-rendering work (sound, input, debug stats) */
    private onUpdate: ((deltaSec: number) => void) | null = null;

    /** When true, game logic (ticks) is paused but rendering continues */
    private _ticksPaused = true;

    /** Registered tick systems */
    private systems: TickSystem[] = [];

    /** Standalone feature toggles (not tick systems, just on/off flags) */
    private featureToggles: FeatureToggle[] = [];

    constructor(
        gameState: GameState,
        visualService: EntityVisualService,
        settings: GameSettings,
        viewState: GameViewState
    ) {
        this.gameState = gameState;
        this.visualService = visualService;
        this.settings = settings;
        this.viewState = viewState;

        // Bind frame handler once to avoid creating closures every frame
        this.boundFrame = this.frame.bind(this);

        // Set up page visibility tracking for background throttling
        this.visibilityHandler = () => {
            this.pageVisible = !document.hidden;
            if (this.pageVisible) {
                // Reset timing when becoming visible to avoid large delta jumps
                this.lastTime = performance.now();
                this.lastRenderTime = this.lastTime;
            }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    /** Register a tick system to be updated each tick */
    public registerSystem(system: TickSystem, group?: string): void {
        this.systems.push(system);
        const name = system.constructor.name || 'Unknown';
        this.systemErrors.set(system, {
            name,
            group: group ?? 'Other',
            consecutiveFailures: 0,
            disabled: false,
            logger: new ThrottledLogger(GameLoop.log, 1000),
        });
    }

    /** Register a standalone feature toggle (shown in features panel alongside tick systems) */
    public registerFeatureToggle(toggle: FeatureToggle): void {
        this.featureToggles.push(toggle);
    }

    /** Enable game ticks (call after sprites are loaded) */
    public enableTicks(): void {
        if (!this._ticksPaused) return;
        this._ticksPaused = false;
        GameLoop.log.debug('Game ticks enabled');
    }

    /** Check if game ticks are paused */
    public get ticksPaused(): boolean {
        return this._ticksPaused;
    }

    /**
     * Set the render callback — called every visible frame with interpolation alpha.
     * This callback should ONLY perform rendering work (sync visual state + draw).
     * Returns render timing data if available.
     */
    public setRenderCallback(callback: (alpha: number, deltaSec: number) => FrameRenderTiming | null): void {
        this.onRender = callback;
    }

    /**
     * Set the per-frame update callback — called every visible frame for non-rendering work.
     * Use this for input processing, sound updates, debug stats, etc.
     * Runs before the render callback so updated state is available for rendering.
     */
    public setUpdateCallback(callback: (deltaSec: number) => void): void {
        this.onUpdate = callback;
    }

    public start(): void {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.animRequest = requestAnimationFrame(this.boundFrame);

        GameLoop.activeLoops++;
        if (GameLoop.activeLoops > 1) {
            GameLoop.log.error(`Multiple game loops active (${GameLoop.activeLoops})! This indicates a cleanup leak.`);
        }
    }

    public stop(): void {
        if (this.running) {
            GameLoop.activeLoops = Math.max(0, GameLoop.activeLoops - 1);
        }
        this.running = false;
        if (this.animRequest) {
            cancelAnimationFrame(this.animRequest);
            this.animRequest = 0;
        }
    }

    /** Clean up event listeners and module state when destroying the game loop */
    public destroy(): void {
        this.stop();

        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
        // Clear toast throttle so a new game session starts fresh
        toastClearThrottle();
    }

    public get isRunning(): boolean {
        return this.running;
    }

    /** Get the name, group, and enabled state of every registered tick system and feature toggle */
    public getSystemStates(): SystemState[] {
        const systems = [...this.systemErrors.values()].map(s => ({
            name: s.name,
            group: s.group,
            enabled: !s.disabled,
            requires: [] as string[],
        }));
        const toggles = this.featureToggles.map(t => ({
            name: t.name,
            group: t.group ?? 'Other',
            enabled: t.get(),
            requires: t.requires ?? [],
        }));
        return [...systems, ...toggles];
    }

    /** Enable or disable a tick system or feature toggle by name */
    public setSystemEnabled(name: string, enabled: boolean): void {
        for (const state of this.systemErrors.values()) {
            if (state.name === name) {
                state.disabled = !enabled;
                if (enabled) state.consecutiveFailures = 0;
                return;
            }
        }
        for (const toggle of this.featureToggles) {
            if (toggle.name === name) {
                toggle.set(enabled);
                return;
            }
        }
    }

    /** Notify all registered tick systems that an entity was removed */
    public notifyEntityRemoved(entityId: number): void {
        for (const system of this.systems) {
            system.onEntityRemoved?.(entityId);
        }
    }

    /**
     * Handle a per-system tick error. Logs with per-system throttling, tracks
     * consecutive failures, and disables the system via circuit breaker.
     */
    private handleSystemError(system: TickSystem, error: unknown): void {
        const state = this.systemErrors.get(system);
        if (!state)
            throw new Error(`GameLoop: no error state for system (handleSystemError) — system may not be registered`);
        state.consecutiveFailures++;
        const err = error instanceof Error ? error : new Error(String(error));

        // Circuit breaker: disable after too many consecutive failures
        if (!state.disabled && state.consecutiveFailures >= SYSTEM_CIRCUIT_BREAKER_THRESHOLD) {
            state.disabled = true;
            GameLoop.log.error(
                `System "${state.name}" disabled after ${SYSTEM_CIRCUIT_BREAKER_THRESHOLD} consecutive failures`
            );
            toastError('GameLoop', `${state.name} has been disabled due to repeated errors`);
            return;
        }

        const logged = state.logger.error(`System "${state.name}" tick failed`, err);

        // Toast on first failure only
        if (logged && state.consecutiveFailures === 1) {
            toastError(state.name, err.message);
        }
    }

    /** Record detailed timing breakdown for debug stats */
    private recordFrameTiming(
        frameStart: number,
        ticksTime: number,
        animationsTime: number,
        updateTime: number,
        callbackTime: number,
        renderTiming: FrameRenderTiming | null
    ): void {
        const framePeriod = debugStats.recordFrame();
        const workTime = performance.now() - frameStart;
        const renderTime = renderTiming?.render ?? 0;

        const defaults: FrameRenderTiming = {
            render: 0,
            landscape: 0,
            entities: 0,
            cullSort: 0,
            visibleCount: 0,
            drawCalls: 0,
            spriteCount: 0,
            indicators: 0,
            textured: 0,
            color: 0,
            selection: 0,
        };
        const rt = renderTiming ?? defaults;

        debugStats.recordRenderTiming({
            frame: framePeriod,
            ticks: ticksTime,
            animations: animationsTime,
            update: updateTime,
            callback: Math.max(0, callbackTime - renderTime),
            idle: Math.max(0, framePeriod - workTime),
            tickSystems: this.lastTickSystemTimings,
            ...rt,
        });
    }

    private frame(now: number): void {
        if (!this.running) return;

        const frameStart = performance.now();
        const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms
        this.lastTime = now;
        this.accumulator += deltaSec;

        const shouldTick = !this._ticksPaused && !this.settings.paused;
        const shouldRender = this.pageVisible || now - this.lastRenderTime >= BACKGROUND_FRAME_DURATION;

        // Sync tick-paused state to reactive view state every frame (cheap write)
        this.viewState.state.ticksPaused = !shouldTick;

        // ── LOGIC ── fixed-timestep simulation (isolated from per-frame work)
        const ticksTime = this.runLogicPhase(shouldTick);

        // ── PER-FRAME ── only when visible / not background-throttled
        // Three isolated sub-steps: animation → update → render.
        if (shouldRender) {
            const animationsTime = this.runAnimations(shouldTick, deltaSec);
            const updateTime = this.runUpdate(deltaSec);
            const { time: callbackTime, timing: renderTiming } = this.runRender();

            this.lastRenderTime = now;
            this.recordFrameTiming(frameStart, ticksTime, animationsTime, updateTime, callbackTime, renderTiming);
        }

        this.animRequest = requestAnimationFrame(this.boundFrame);
    }

    /** Run fixed-timestep logic ticks. Returns elapsed time in ms. */
    private runLogicPhase(shouldTick: boolean): number {
        const start = performance.now();
        try {
            const scaledDt = TICK_DURATION * BASE_SPEED * this.settings.gameSpeed;
            if (shouldTick) {
                while (this.accumulator >= TICK_DURATION) {
                    this.tick(scaledDt);
                    this.accumulator -= TICK_DURATION;
                }
            } else {
                this.accumulator = 0; // drain to prevent catch-up burst
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.logicPhaseLogger.error('Error in logic phase', err);
        }
        return performance.now() - start;
    }

    /** Update animations (visual-only, scaled by game speed). Returns elapsed time in ms. */
    private runAnimations(shouldTick: boolean, deltaSec: number): number {
        const start = performance.now();
        try {
            if (shouldTick) {
                const scaledDeltaMs = deltaSec * 1000 * BASE_SPEED * this.settings.gameSpeed;
                this.visualService.update(scaledDeltaMs);
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.animationLogger.error('Error updating animations', err);
        }
        return performance.now() - start;
    }

    /** Run per-frame update callback (input, sound, debug stats — not rendering). Returns elapsed time in ms. */
    private runUpdate(deltaSec: number): number {
        const start = performance.now();
        try {
            if (this.onUpdate) {
                this.onUpdate(deltaSec);
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.updateLogger.error('Error in update callback', err);
        }
        return performance.now() - start;
    }

    /** Run GPU render callback. Returns elapsed time + render timing data. */
    private runRender(): { time: number; timing: FrameRenderTiming | null } {
        const start = performance.now();
        let timing: FrameRenderTiming | null = null;
        try {
            if (this.onRender) {
                timing = this.onRender(this.accumulator / TICK_DURATION, 0);
            }
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.renderLogger.error('Error in render callback', err);
        }
        return { time: performance.now() - start, timing };
    }

    private tick(dt: number): void {
        debugStats.recordTick();

        const timings: Record<string, number> = {};

        // Run each registered tick system with individual error isolation.
        // A failure in one system does not prevent others from running.
        for (const system of this.systems) {
            const errorState = this.systemErrors.get(system);
            if (!errorState)
                throw new Error(`GameLoop: no error state for system in tick loop — system may not be registered`);

            if (errorState.disabled) continue;

            const start = performance.now();
            try {
                system.tick(dt);
                if (errorState.consecutiveFailures > 0) {
                    errorState.consecutiveFailures = 0;
                }
            } catch (e) {
                this.handleSystemError(system, e);
            }
            const elapsed = performance.now() - start;
            timings[errorState.name] = (timings[errorState.name] ?? 0) + elapsed;
        }

        this.lastTickSystemTimings = timings;

        // Update game view state so Vue components see entity counts/selection
        // even without a render callback (headless/CI environments)
        this.viewState.updateFromGameState(this.gameState);
    }
}
