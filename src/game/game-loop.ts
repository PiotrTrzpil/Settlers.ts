import { GameState } from './game-state';
import { TreeSystem } from './systems/tree-system';
import { WoodcuttingSystem } from './systems/woodcutting-system';
import { SettlerTaskSystem } from './systems/settler-tasks';
import { ProductionSystem } from './systems/production-system';
import { LogHandler } from '@/utilities/log-handler';
import { debugStats } from './debug-stats';
import { gameSettings } from './game-settings';
import { MapSize } from '@/utilities/map-size';
import type { TickSystem } from './tick-system';
import { BuildingConstructionSystem, BuildingStateManager } from './features/building-construction';
import { CarrierSystem, CarrierManager } from './features/carriers';
import {
    hasInventory,
    isProductionBuilding,
    InventoryVisualizer,
    BuildingInventoryManager,
} from './features/inventory';
import { LogisticsDispatcher, RequestManager } from './features/logistics';
import { ServiceAreaManager } from './features/service-areas';
import { EventBus } from './event-bus';
import type { FrameRenderTiming } from './renderer/renderer';
import { BuildingType, MapObjectType } from './entity';
import { AnimationService } from './animation/index';

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

    /** Error throttling - prevent console flooding */
    private lastErrorTime = 0;
    private suppressedErrorCount = 0;
    private static readonly ERROR_THROTTLE_MS = 1000;

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
    /** Render callback - returns render timing if available */
    private onRender: ((alpha: number, deltaSec: number) => FrameRenderTiming | null) | null = null;

    /** When true, game logic (ticks) is paused but rendering continues */
    private _ticksPaused = true;

    /** Registered tick systems */
    private systems: TickSystem[] = [];

    /** Event bus for inter-system communication */
    public readonly eventBus: EventBus;

    /** Building construction system (registered as TickSystem) */
    public readonly constructionSystem: BuildingConstructionSystem;

    /** Carrier logistics system */
    public readonly carrierSystem: CarrierSystem;

    /** Logistics dispatcher - connects resource requests to carriers */
    public readonly logisticsDispatcher!: LogisticsDispatcher;

    /** Animation service - manages entity animations */
    public readonly animationService: AnimationService;

    /** Tree lifecycle system - growth and cutting states */
    public readonly treeSystem: TreeSystem;

    /** Settler task system - manages all settler behaviors */
    public readonly settlerTaskSystem: SettlerTaskSystem;

    /** Woodcutting domain system - work handler for tree cutting */
    public readonly woodcuttingSystem: WoodcuttingSystem;

    /** Inventory visualizer - syncs building outputs to visual stacked resources */
    public readonly inventoryVisualizer: InventoryVisualizer;

    /** Production system - handles building production cycles */
    public readonly productionSystem: ProductionSystem;

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

    constructor(gameState: GameState, eventBus: EventBus) {
        this.gameState = gameState;
        this.eventBus = eventBus;

        // Bind frame handler once to avoid creating closures every frame
        this.boundFrame = this.frame.bind(this);

        // Create animation service first - other systems depend on it
        this.animationService = new AnimationService();

        // Instantiate managers (owned by GameLoop, used by systems)
        this.carrierManager = new CarrierManager();
        this.inventoryManager = new BuildingInventoryManager();
        this.serviceAreaManager = new ServiceAreaManager();
        this.requestManager = new RequestManager();
        this.buildingStateManager = new BuildingStateManager();

        // Set entity providers for managers that need entity lookup
        this.buildingStateManager.setEntityProvider(gameState);
        this.carrierManager.setEntityProvider(gameState);

        // Register all tick systems in execution order:
        // 1. Movement — updates unit positions (must run first)
        gameState.movement.setEventBus(eventBus);
        gameState.movement.setRng(gameState.rng);
        this.registerSystem(gameState.movement);

        // 2. Building construction — terrain modification, phase transitions
        this.constructionSystem = new BuildingConstructionSystem({
            gameState,
            buildingStateManager: this.buildingStateManager,
        });
        this.constructionSystem.registerEvents(eventBus);
        this.registerSystem(this.constructionSystem);

        // Wire up inventory and service area creation
        // (Building state creation is handled directly by GameState.addEntity)
        gameState.onBuildingCreated = (entityId, buildingType, x, y) => {
            this.handleBuildingCreated(entityId, buildingType as BuildingType, x, y);
        };

        // 3. Carrier system — manages carrier fatigue and behavior
        this.carrierSystem = new CarrierSystem({
            carrierManager: this.carrierManager,
            inventoryManager: this.inventoryManager,
            gameState: gameState,
            serviceAreaManager: this.serviceAreaManager,
            animationService: this.animationService,
        });
        this.carrierSystem.registerEvents(eventBus);
        this.registerSystem(this.carrierSystem);

        // 4. Logistics dispatcher — assigns carriers to pending requests
        this.logisticsDispatcher = new LogisticsDispatcher({
            gameState: gameState,
            carrierSystem: this.carrierSystem,
            requestManager: this.requestManager,
            serviceAreaManager: this.serviceAreaManager,
            inventoryManager: this.inventoryManager,
        });
        this.logisticsDispatcher.registerEvents(eventBus);
        this.registerSystem(this.logisticsDispatcher);

        // 5. Tree system — manages tree growth and cutting states
        this.treeSystem = new TreeSystem(gameState, this.animationService);
        this.registerSystem(this.treeSystem);

        // Wire up tree registration for map objects
        gameState.onMapObjectCreated = (entityId, objectType, _x, _y) => {
            this.handleMapObjectCreated(entityId, objectType);
        };

        // 6. Settler task system — manages all unit behaviors and animations
        this.settlerTaskSystem = new SettlerTaskSystem({
            gameState,
            animationService: this.animationService,
            inventoryManager: this.inventoryManager,
        });
        this.settlerTaskSystem.setEventBus(eventBus);
        this.registerSystem(this.settlerTaskSystem);

        // Wire up carrier system to settler task system
        this.carrierSystem.setSettlerTaskSystem(this.settlerTaskSystem);

        // 7. Woodcutting domain — registers work handler with task system
        this.woodcuttingSystem = new WoodcuttingSystem(gameState, this.treeSystem, this.settlerTaskSystem);

        // 8. Production system — handles building production cycles (requests inputs, produces outputs)
        this.productionSystem = new ProductionSystem({
            gameState,
            eventBus: this.eventBus,
            buildingStateManager: this.buildingStateManager,
            inventoryManager: this.inventoryManager,
            requestManager: this.requestManager,
        });
        this.registerSystem(this.productionSystem);

        // 9. Inventory visualizer — syncs building output to visual stacked resources
        this.inventoryVisualizer = new InventoryVisualizer(gameState, this.inventoryManager);

        // 10. Bridge inventory changes to EventBus for other consumers (debug panel, UI)
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

        // Wire up entity removal callback for cleanup
        gameState.onEntityRemoved = (entityId: number) => {
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
     * Building types that act as logistics hubs (taverns/carrier bases).
     * These buildings get service areas when created.
     */
    private static readonly SERVICE_AREA_BUILDINGS: ReadonlySet<BuildingType> = new Set([
        BuildingType.ResidenceSmall,
        BuildingType.ResidenceMedium,
        BuildingType.ResidenceBig,
    ]);

    /**
     * Handle building creation - creates inventory and service area as needed.
     */
    private handleBuildingCreated(entityId: number, buildingType: BuildingType, x: number, y: number): void {
        // Entity MUST exist - we just received a creation event for it
        const entity = this.gameState.getEntityOrThrow(entityId, 'created building');
        const playerId = entity.player;

        // Create service area for logistics hubs (taverns/warehouses)
        if (GameLoop.SERVICE_AREA_BUILDINGS.has(buildingType)) {
            this.serviceAreaManager.createServiceArea(entityId, playerId, x, y);
        }

        // Create inventory for buildings with input/output slots
        if (hasInventory(buildingType) || isProductionBuilding(buildingType)) {
            this.inventoryManager.createInventory(entityId, buildingType);
        }

        // Create building construction state
        this.buildingStateManager.createBuildingState(entityId, buildingType, x, y);
    }

    /**
     * Handle map object creation - registers trees with TreeSystem.
     */
    private handleMapObjectCreated(entityId: number, objectType: number): void {
        // Register trees with tree system (checks if it's a tree type internally)
        this.treeSystem.register(entityId, objectType as MapObjectType);
    }

    /**
     * Handle entity removal - cleans up carrier state, inventory, service areas, and logistics.
     */
    private handleEntityRemoved(entityId: number): void {
        // Notify all registered tick systems that implement onEntityRemoved
        for (const system of this.systems) {
            system.onEntityRemoved?.(entityId);
        }

        // Clean up carrier state if this was a carrier
        if (this.carrierManager.hasCarrier(entityId)) {
            this.carrierManager.removeCarrier(entityId);
        }

        // Clean up service area if this building had one
        this.serviceAreaManager.removeServiceArea(entityId);

        // Clean up inventory if this building had one
        this.inventoryManager.removeInventory(entityId);

        // Clean up logistics state (requests to/from this building, reservations)
        this.logisticsDispatcher.handleBuildingDestroyed(entityId);

        // Clean up visual inventory stacks
        this.inventoryVisualizer.removeBuilding(entityId);
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

    /** Log errors with throttling to prevent console flooding */
    private logThrottledError(message: string, error: unknown): void {
        const now = performance.now();
        const timeSinceLastError = now - this.lastErrorTime;

        if (timeSinceLastError >= GameLoop.ERROR_THROTTLE_MS) {
            // Enough time has passed, log the error
            const err = error instanceof Error ? error : new Error(String(error));
            if (this.suppressedErrorCount > 0) {
                GameLoop.log.error(`${message} (${this.suppressedErrorCount} similar errors suppressed)`, err);
                this.suppressedErrorCount = 0;
            } else {
                GameLoop.log.error(message, err);
            }
            this.lastErrorTime = now;
        } else {
            // Throttled - just count the suppressed error
            this.suppressedErrorCount++;
        }
    }

    /** Record detailed timing breakdown for debug stats */
    // eslint-disable-next-line complexity -- timing breakdown requires many branches
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

            // Fixed timestep simulation - only runs when ticks are enabled and not paused
            const scaledDt = TICK_DURATION * gameSettings.state.gameSpeed;
            const tickStart = performance.now();
            const shouldTick = !this._ticksPaused && !gameSettings.state.paused;
            if (shouldTick) {
                while (this.accumulator >= TICK_DURATION) {
                    this.tick(scaledDt);
                    this.accumulator -= TICK_DURATION;
                }
            } else {
                // Drain accumulator to prevent catch-up burst when unpaused
                this.accumulator = 0;
            }
            ticksTime = performance.now() - tickStart;

            // Only update animations and render when not throttled
            if (shouldRender) {
                // Update animations (runs every rendered frame for smooth animation)
                // Scale by game speed so animations match game pace
                // Skip animation updates when paused
                const animStart = performance.now();
                if (shouldTick) {
                    const scaledDeltaMs = deltaSec * 1000 * gameSettings.state.gameSpeed;
                    this.animationService.update(scaledDeltaMs);
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
            this.logThrottledError('Error in game frame', e);
        }

        this.animRequest = requestAnimationFrame(this.boundFrame);
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

        // Update debug stats from game state so entity counts are available
        // even without a render callback (headless/CI environments)
        debugStats.updateFromGameState(this.gameState);
    }
}
