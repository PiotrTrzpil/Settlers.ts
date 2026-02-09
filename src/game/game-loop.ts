import { GameState } from './game-state';
import { updateAnimations, AnimationDataProvider } from './systems/animation';
import { IdleBehaviorSystem } from './systems/idle-behavior';
import { LumberjackSystem } from './systems/lumberjack-system';
import { LogHandler } from '@/utilities/log-handler';
import { debugStats } from './debug-stats';
import { gameSettings } from './game-settings';
import { MapSize } from '@/utilities/map-size';
import type { TickSystem } from './tick-system';
import { BuildingConstructionSystem } from './features/building-construction';
import { CarrierSystem } from './features/carriers';
import { hasInventory, isProductionBuilding } from './features/inventory';
import { EventBus } from './event-bus';
import type { FrameRenderTiming } from './renderer/renderer';
import { BuildingType } from './entity';

const TICK_RATE = 30;
const TICK_DURATION = 1 / TICK_RATE;

/** Target FPS when page is in background (to save CPU/battery) */
const BACKGROUND_FPS = 10;
const BACKGROUND_FRAME_DURATION = 1000 / BACKGROUND_FPS;

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

    /** Whether the page is currently visible */
    private pageVisible = !document.hidden;
    /** Time of last rendered frame (for background throttling) */
    private lastRenderTime = 0;
    /** Bound visibility handler for cleanup */
    private visibilityHandler: (() => void) | null = null;

    private gameState: GameState;
    private groundType: Uint8Array | undefined;
    private groundHeight: Uint8Array | undefined;
    private mapWidth: number | undefined;
    private mapHeight: number | undefined;
    private mapSize: MapSize | undefined;
    /** Render callback - returns render timing if available */
    private onRender: ((alpha: number, deltaSec: number) => FrameRenderTiming | null) | null = null;
    private animationProvider: AnimationDataProvider | null = null;

    /** Registered tick systems */
    private systems: TickSystem[] = [];

    /** Event bus for inter-system communication */
    public readonly eventBus: EventBus;

    /** Building construction system (registered as TickSystem) */
    public readonly constructionSystem: BuildingConstructionSystem;

    /** Idle behavior system for animation direction updates */
    public readonly idleBehaviorSystem: IdleBehaviorSystem;

    /** Carrier logistics system */
    public readonly carrierSystem: CarrierSystem;

    /** Lumberjack AI system */
    public readonly lumberjackSystem: LumberjackSystem;

    constructor(gameState: GameState, eventBus: EventBus) {
        this.gameState = gameState;
        this.eventBus = eventBus;

        // Register all tick systems in execution order:
        // 1. Movement — updates unit positions (must run first)
        gameState.movement.setEventBus(eventBus);
        this.registerSystem(gameState.movement);

        // 2. Idle behavior — updates animation based on movement events
        this.idleBehaviorSystem = new IdleBehaviorSystem(gameState);
        this.idleBehaviorSystem.registerEvents(eventBus);
        this.registerSystem(this.idleBehaviorSystem);

        // 3. Building construction — terrain modification, phase transitions
        this.constructionSystem = new BuildingConstructionSystem(gameState);
        this.constructionSystem.registerEvents(eventBus);
        this.registerSystem(this.constructionSystem);

        // Share the construction system's buildingStates map with GameState
        // so existing code (commands, renderer) can access it via state.buildingStates
        gameState.buildingStates = this.constructionSystem.buildingStates;

        // Delegate building state creation to the construction system
        // Also wire up inventory and service area creation
        gameState.onBuildingCreated = (entityId, buildingType, x, y) => {
            this.constructionSystem.createBuildingState(entityId, buildingType, x, y);
            this.handleBuildingCreated(entityId, buildingType as BuildingType, x, y);
        };

        // 4. Carrier system — manages carrier fatigue and behavior
        this.carrierSystem = new CarrierSystem(gameState.carrierManager);
        this.carrierSystem.registerEvents(eventBus);
        this.registerSystem(this.carrierSystem);

        // 5. Lumberjack AI — issues movement commands (runs after carrier)
        this.lumberjackSystem = new LumberjackSystem(gameState);
        this.registerSystem(this.lumberjackSystem);

        // Wire up entity removal callback for cleanup
        gameState.onEntityRemoved = (entityId: number) => {
            this.idleBehaviorSystem.cleanupIdleState(entityId);
            this.handleEntityRemoved(entityId);
        };

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
    }

    /**
     * Building types that act as logistics hubs (taverns/carrier bases).
     * These buildings get service areas when created.
     */
    private static readonly SERVICE_AREA_BUILDINGS: ReadonlySet<BuildingType> = new Set([
        BuildingType.ResidenceSmall,
        BuildingType.ResidenceMedium,
        BuildingType.ResidenceBig,
        BuildingType.StorageArea,
    ]);

    /**
     * Handle building creation - creates inventory and service area as needed.
     */
    private handleBuildingCreated(entityId: number, buildingType: BuildingType, x: number, y: number): void {
        const entity = this.gameState.getEntity(entityId);
        const playerId = entity?.player ?? 0;

        // Create service area for logistics hubs (taverns/warehouses)
        if (GameLoop.SERVICE_AREA_BUILDINGS.has(buildingType)) {
            this.gameState.serviceAreaManager.createServiceArea(entityId, playerId, x, y);
        }

        // Create inventory for buildings with input/output slots
        if (hasInventory(buildingType) || isProductionBuilding(buildingType)) {
            this.gameState.inventoryManager.createInventory(entityId, buildingType);
        }
    }

    /**
     * Handle entity removal - cleans up carrier state, inventory, and service areas.
     */
    private handleEntityRemoved(entityId: number): void {
        // Clean up carrier state if this was a carrier
        if (this.gameState.carrierManager.hasCarrier(entityId)) {
            this.gameState.carrierManager.removeCarrier(entityId);
        }

        // Clean up service area if this building had one
        this.gameState.serviceAreaManager.removeServiceArea(entityId);

        // Clean up inventory if this building had one
        this.gameState.inventoryManager.removeInventory(entityId);
    }

    /** Provide terrain data so movement obstacle resolution can function */
    public setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.groundType = groundType;
        this.groundHeight = groundHeight;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.mapSize = new MapSize(mapWidth, mapHeight);

        // Initialize terrain data in the movement system
        this.gameState.setTerrainData(groundType, groundHeight, mapWidth, mapHeight);
    }

    /**
     * Set the render callback, called every animation frame with interpolation alpha and delta time.
     * The callback should return render timing data if available (from Renderer.getLastRenderTiming()).
     */
    public setRenderCallback(callback: (alpha: number, deltaSec: number) => FrameRenderTiming | null): void {
        this.onRender = callback;
    }

    /** Set the animation data provider for updating entity animations */
    public setAnimationProvider(provider: AnimationDataProvider | null): void {
        this.animationProvider = provider;
    }

    public start(): void {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.animRequest = requestAnimationFrame((t) => this.frame(t));

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

    /** Clean up event listeners when destroying the game loop */
    public destroy(): void {
        this.stop();
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    public get isRunning(): boolean {
        return this.running;
    }

    /** Record detailed timing breakdown for debug stats */
    private recordFrameTiming(
        frameStart: number,
        ticksTime: number,
        animationsTime: number,
        callbackTime: number,
        renderTiming: FrameRenderTiming | null
    ): void {
        // Record FPS and get frame period for timing breakdown
        const framePeriod = debugStats.recordFrame();
        const workTime = performance.now() - frameStart;
        const renderTime = renderTiming?.render ?? 0;
        // Callback overhead is time in callback minus actual GPU render time
        const callbackOverhead = Math.max(0, callbackTime - renderTime);
        // "Other" accounts for browser overhead, vsync waiting, rAF scheduling
        const otherTime = Math.max(0, framePeriod - workTime);

        debugStats.recordRenderTiming({
            frame: framePeriod,
            ticks: ticksTime,
            animations: animationsTime,
            callback: callbackOverhead,
            other: otherTime,
            render: renderTime,
            landscape: renderTiming?.landscape ?? 0,
            entities: renderTiming?.entities ?? 0,
            cullSort: renderTiming?.cullSort ?? 0,
            visibleCount: renderTiming?.visibleCount ?? 0,
            drawCalls: renderTiming?.drawCalls ?? 0,
            spriteCount: renderTiming?.spriteCount ?? 0,
            indicators: renderTiming?.indicators ?? 0,
            textured: renderTiming?.textured ?? 0,
            color: renderTiming?.color ?? 0,
            selection: renderTiming?.selection ?? 0,
        });
    }

    private frame(now: number): void {
        if (!this.running) return;

        // When page is hidden, throttle to BACKGROUND_FPS to save CPU/battery
        const timeSinceLastRender = now - this.lastRenderTime;
        const shouldRender = this.pageVisible || timeSinceLastRender >= BACKGROUND_FRAME_DURATION;

        const frameStart = performance.now();
        let ticksTime = 0;
        let animationsTime = 0;
        let callbackTime = 0;
        let renderTiming: FrameRenderTiming | null = null;

        try {
            const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms
            this.lastTime = now;
            this.accumulator += deltaSec;

            // Fixed timestep simulation - always runs to keep game state consistent
            const scaledDt = TICK_DURATION * gameSettings.state.gameSpeed;
            const tickStart = performance.now();
            while (this.accumulator >= TICK_DURATION) {
                this.tick(scaledDt);
                this.accumulator -= TICK_DURATION;
            }
            ticksTime = performance.now() - tickStart;

            // Only update animations and render when not throttled
            if (shouldRender) {
                // Update animations (runs every rendered frame for smooth animation)
                const animStart = performance.now();
                if (this.animationProvider) {
                    updateAnimations(this.gameState, deltaSec * 1000, this.animationProvider);
                }
                animationsTime = performance.now() - animStart;

                // Render with interpolation alpha for smooth sub-tick visuals
                const callbackStart = performance.now();
                if (this.onRender) {
                    renderTiming = this.onRender(this.accumulator / TICK_DURATION, deltaSec);
                }
                callbackTime = performance.now() - callbackStart;

                this.lastRenderTime = now;
                this.recordFrameTiming(frameStart, ticksTime, animationsTime, callbackTime, renderTiming);
            }
        } catch (e) {
            GameLoop.log.error('Error in game frame', e instanceof Error ? e : new Error(String(e)));
        }

        this.animRequest = requestAnimationFrame((t) => this.frame(t));
    }

    private tick(dt: number): void {
        debugStats.recordTick();

        // Update terrain context for building construction if terrain data is available
        if (this.groundType && this.groundHeight && this.mapSize) {
            this.constructionSystem.setTerrainContext({
                groundType: this.groundType,
                groundHeight: this.groundHeight,
                mapSize: this.mapSize,
            });
        } else {
            this.constructionSystem.setTerrainContext(undefined);
        }

        // Run all registered tick systems in order
        for (const system of this.systems) {
            system.tick(dt);
        }
    }
}
