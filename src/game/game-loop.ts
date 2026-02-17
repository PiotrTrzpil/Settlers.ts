import { GameState } from './game-state';
import { MovementSystem } from './systems/movement/index';
import { SettlerTaskSystem, SearchType } from './systems/settler-tasks';
import {
    createWoodcuttingHandler,
    createStonecuttingHandler,
    createForesterHandler,
} from './systems/settler-tasks/work-handlers';
import { MaterialRequestSystem } from './systems/production-system';
import { LogHandler } from '@/utilities/log-handler';
import { ThrottledLogger } from '@/utilities/throttled-logger';
import { debugStats } from './debug-stats';
import { gameSettings } from './game-settings';
import { MapSize } from '@/utilities/map-size';
import type { TickSystem } from './tick-system';
import { BuildingConstructionSystem, BuildingStateManager } from './features/building-construction';
import { CarrierManager } from './features/carriers';
import { InventoryVisualizer, BuildingInventoryManager } from './features/inventory';
import { LogisticsDispatcher, RequestManager } from './features/logistics';
import { ServiceAreaManager } from './features/service-areas';
import { FeatureRegistry } from './features/feature-registry';
import { TreeFeature, TreeSystem, type TreeFeatureExports } from './features/trees';
import { BuildingLifecycle } from './features/building-lifecycle';
import { EventBus, EventSubscriptionManager } from './event-bus';
import type { FrameRenderTiming } from './renderer/renderer';
import { UnitType } from './entity';
import { AnimationService } from './animation/index';
import { toastError, toastClearThrottle } from './toast-notifications';

const TICK_RATE = 30;
const TICK_DURATION = 1 / TICK_RATE;

/** Target FPS when page is in background (to save CPU/battery) */
const BACKGROUND_FPS = 10;
const BACKGROUND_FRAME_DURATION = 1000 / BACKGROUND_FPS;

/** Consecutive failures before a tick system is disabled */
const SYSTEM_CIRCUIT_BREAKER_THRESHOLD = 100;

/** Per-system error tracking */
interface SystemErrorState {
    name: string;
    consecutiveFailures: number;
    disabled: boolean;
    logger: ThrottledLogger;
}

/**
 * Fixed-timestep game loop using requestAnimationFrame.
 * Runs the simulation at a fixed tick rate and calls render every frame.
 * Errors in tick/render are caught so one bad frame doesn't kill the loop.
 *
 * Automatically throttles to lower FPS when the page is not visible
 * to reduce CPU/GPU usage and save battery.
 */
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

    /** Event subscription manager for GameLoop's own event handlers */
    private readonly subscriptions = new EventSubscriptionManager();

    /** Whether the page is currently visible */
    private pageVisible = !document.hidden;
    /** Time of last rendered frame (for background throttling) */
    private lastRenderTime = 0;
    /** Bound visibility handler for cleanup */
    private visibilityHandler: (() => void) | null = null;
    /** Bound frame handler to avoid creating closures every frame */
    private boundFrame: (time: number) => void;

    private gameState: GameState;
    private groundType: Uint8Array | undefined;
    private groundHeight: Uint8Array | undefined;
    private mapWidth: number | undefined;
    private mapHeight: number | undefined;
    private mapSize: MapSize | undefined;
    /** Render callback — ONLY rendering, returns render timing if available */
    private onRender: ((alpha: number, deltaSec: number) => FrameRenderTiming | null) | null = null;

    /** Per-frame update callback — non-rendering work (sound, input, debug stats) */
    private onUpdate: ((deltaSec: number) => void) | null = null;

    /** When true, game logic (ticks) is paused but rendering continues */
    private _ticksPaused = true;

    /** Registered tick systems */
    private systems: TickSystem[] = [];

    /** Movement system — owned by GameLoop, shared with GameState */
    public readonly movement: MovementSystem;

    /** Event bus for inter-system communication */
    public readonly eventBus: EventBus;

    /** Building construction system (registered as TickSystem) */
    public readonly constructionSystem: BuildingConstructionSystem;

    /** Logistics dispatcher - connects resource requests to carriers */
    public readonly logisticsDispatcher!: LogisticsDispatcher;

    /** Animation service - manages entity animations */
    public readonly animationService: AnimationService;

    /** Tree lifecycle system - growth and cutting states */
    public readonly treeSystem: TreeSystem;

    /** Settler task system - manages all settler behaviors */
    public readonly settlerTaskSystem: SettlerTaskSystem;

    /** Inventory visualizer - syncs building outputs to visual stacked resources */
    public readonly inventoryVisualizer: InventoryVisualizer;

    /** Material request system - creates transport requests for buildings needing materials */
    public readonly materialRequestSystem: MaterialRequestSystem;

    // ===== Managers (owned by GameLoop, used by systems) =====
    /** Carrier manager - tracks carrier state and assignments */
    public readonly carrierManager: CarrierManager;

    /** Building inventory manager - tracks building input/output slots */
    public readonly inventoryManager: BuildingInventoryManager;

    /** Service area manager - tracks logistics service areas */
    public readonly serviceAreaManager: ServiceAreaManager;

    /** Request manager - tracks material delivery requests */
    public readonly requestManager: RequestManager;

    /** Building state manager - tracks construction state for all buildings */
    public readonly buildingStateManager: BuildingStateManager;

    /** Feature registry - manages self-registering feature modules */
    private readonly featureRegistry: FeatureRegistry;

    /** Building lifecycle coordinator - owns building creation/removal dispatch */
    public readonly buildingLifecycle: BuildingLifecycle;

    constructor(gameState: GameState, eventBus: EventBus) {
        this.gameState = gameState;
        this.eventBus = eventBus;

        // Bind frame handler once to avoid creating closures every frame
        this.boundFrame = this.frame.bind(this);

        // Create animation service first - other systems depend on it
        this.animationService = new AnimationService();

        // Instantiate managers (owned by GameLoop, used by systems)
        // Managers now require dependencies via constructor
        this.carrierManager = new CarrierManager({
            entityProvider: gameState,
            eventBus,
        });
        this.inventoryManager = new BuildingInventoryManager();
        this.serviceAreaManager = new ServiceAreaManager();
        this.requestManager = new RequestManager();
        this.buildingStateManager = new BuildingStateManager({
            entityProvider: gameState,
            eventBus,
        });

        // Create and register movement system (owned by GameLoop, used by GameState)
        this.movement = new MovementSystem({
            eventBus,
            rng: gameState.rng,
            updatePosition: (id, x, y) => {
                gameState.updateEntityPosition(id, x, y);
                return true;
            },
            getEntity: id => gameState.getEntity(id),
        });
        this.movement.setTileOccupancy(gameState.tileOccupancy);
        gameState.setMovementSystem(this.movement);

        // 1. Movement — updates unit positions (must run first)
        this.registerSystem(this.movement);

        // 2. Building construction — terrain modification, phase transitions
        this.constructionSystem = new BuildingConstructionSystem({
            gameState,
            buildingStateManager: this.buildingStateManager,
        });
        this.constructionSystem.registerEvents(eventBus);
        this.registerSystem(this.constructionSystem);

        // 3. Carrier manager — fatigue recovery each tick + auto-registration
        this.carrierManager.setServiceAreaManager(this.serviceAreaManager);
        this.registerSystem(this.carrierManager);

        // Listen for unit spawned to auto-register carriers
        this.subscriptions.subscribe(eventBus, 'unit:spawned', payload => {
            if (payload.unitType === UnitType.Carrier) {
                this.carrierManager.autoRegisterCarrier(payload.entityId, payload.x, payload.y, payload.player);
            }
        });

        // 4. Feature Registry — load self-registering features
        this.featureRegistry = new FeatureRegistry({
            gameState,
            eventBus,
            animationService: this.animationService,
        });

        // Load TreeFeature (handles tree lifecycle and mapObject:created subscription)
        this.featureRegistry.load(TreeFeature);
        this.treeSystem = this.featureRegistry.getFeatureExports<TreeFeatureExports>('trees').treeSystem;

        // Register all feature systems
        for (const system of this.featureRegistry.getSystems()) {
            this.registerSystem(system);
        }

        // 5. Settler task system — manages all unit behaviors and animations
        this.settlerTaskSystem = new SettlerTaskSystem({
            gameState,
            animationService: this.animationService,
            inventoryManager: this.inventoryManager,
            carrierManager: this.carrierManager,
            eventBus,
            getInventoryVisualizer: () => this.inventoryVisualizer,
        });
        this.registerSystem(this.settlerTaskSystem);

        // 6. Logistics dispatcher — assigns carriers to pending requests
        this.logisticsDispatcher = new LogisticsDispatcher({
            gameState,
            carrierManager: this.carrierManager,
            settlerTaskSystem: this.settlerTaskSystem,
            requestManager: this.requestManager,
            serviceAreaManager: this.serviceAreaManager,
            inventoryManager: this.inventoryManager,
        });
        this.logisticsDispatcher.registerEvents(eventBus);
        this.registerSystem(this.logisticsDispatcher);

        // 7. Domain systems — register work handlers with task system
        this.settlerTaskSystem.registerWorkHandler(
            SearchType.TREE,
            createWoodcuttingHandler(gameState, this.treeSystem)
        );
        this.settlerTaskSystem.registerWorkHandler(SearchType.STONE, createStonecuttingHandler(gameState));
        this.settlerTaskSystem.registerWorkHandler(SearchType.TREE_SEED_POS, createForesterHandler(this.treeSystem));

        // 8. Material request system — creates transport requests for buildings needing input materials
        this.materialRequestSystem = new MaterialRequestSystem({
            gameState,
            buildingStateManager: this.buildingStateManager,
            inventoryManager: this.inventoryManager,
            requestManager: this.requestManager,
        });
        this.registerSystem(this.materialRequestSystem);

        // 9. Inventory visualizer — syncs building output to visual stacked resources
        this.inventoryVisualizer = new InventoryVisualizer(gameState, this.inventoryManager);

        // 10. Building lifecycle coordinator — owns creation/removal sequence
        this.buildingLifecycle = new BuildingLifecycle({
            gameState,
            eventBus,
            serviceAreaManager: this.serviceAreaManager,
            inventoryManager: this.inventoryManager,
            buildingStateManager: this.buildingStateManager,
            carrierManager: this.carrierManager,
            logisticsDispatcher: this.logisticsDispatcher,
            inventoryVisualizer: this.inventoryVisualizer,
        });

        // Notify tick systems on entity removal (BuildingLifecycle handles manager cleanup)
        this.buildingLifecycle.onRemoved(entityId => {
            for (const system of this.systems) {
                system.onEntityRemoved?.(entityId);
            }
        });

        // 11. Bridge inventory changes to EventBus for other consumers (debug panel, UI)
        this.inventoryManager.onChange((buildingId, materialType, slotType, previousAmount, newAmount) => {
            this.eventBus.emit('inventory:changed', {
                buildingId,
                materialType,
                slotType,
                previousAmount,
                newAmount,
            });
        });

        // 11. Bridge request creation to EventBus for other consumers (debug panel, UI)
        this.requestManager.on('requestAdded', ({ request }) => {
            this.eventBus.emit('request:created', {
                requestId: request.id,
                buildingId: request.buildingId,
                materialType: request.materialType,
                amount: request.amount,
                priority: request.priority,
            });
        });

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
    public registerSystem(system: TickSystem): void {
        this.systems.push(system);
        const name = system.constructor.name || 'Unknown';
        this.systemErrors.set(system, {
            name,
            consecutiveFailures: 0,
            disabled: false,
            logger: new ThrottledLogger(GameLoop.log, 1000),
        });
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

    /** Provide terrain data so movement obstacle resolution can function */
    public setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.groundType = groundType;
        this.groundHeight = groundHeight;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.mapSize = new MapSize(mapWidth, mapHeight);

        // Initialize terrain data in the movement system
        this.movement.setTerrainData(groundType, groundHeight, mapWidth, mapHeight);

        // Provide terrain context to construction system (only needs to be set once)
        this.constructionSystem.setTerrainContext({
            groundType: this.groundType,
            groundHeight: this.groundHeight,
            mapSize: this.mapSize,
            onTerrainModified: () => this.eventBus.emit('terrain:modified', {}),
        });
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

        // Unsubscribe all registered systems from events
        for (const system of this.systems) {
            if (system.destroy) {
                system.destroy();
            }
        }

        // Destroy feature registry (cleans up feature event handlers)
        this.featureRegistry.destroy();

        // Destroy building lifecycle coordinator (unsubscribes building:created, entity:removed)
        this.buildingLifecycle.destroy();

        // Unsubscribe GameLoop's own event handlers
        this.subscriptions.unsubscribeAll();

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

    /**
     * Handle a per-system tick error. Logs with per-system throttling, tracks
     * consecutive failures, and disables the system via circuit breaker.
     */
    private handleSystemError(system: TickSystem, error: unknown): void {
        const state = this.systemErrors.get(system)!;
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

        const shouldTick = !this._ticksPaused && !gameSettings.state.paused;
        const shouldRender = this.pageVisible || now - this.lastRenderTime >= BACKGROUND_FRAME_DURATION;

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
            const scaledDt = TICK_DURATION * gameSettings.state.gameSpeed;
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
                const scaledDeltaMs = deltaSec * 1000 * gameSettings.state.gameSpeed;
                this.animationService.update(scaledDeltaMs);
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
            const errorState = this.systemErrors.get(system)!;

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

        // Update debug stats from game state so entity counts are available
        // even without a render callback (headless/CI environments)
        debugStats.updateFromGameState(this.gameState);
    }
}
