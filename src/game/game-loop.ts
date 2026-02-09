import { GameState } from './game-state';
import { updateAnimations, AnimationDataProvider } from './systems/animation';
import { updateIdleBehavior } from './systems/idle-behavior';
import { LogHandler } from '@/utilities/log-handler';
import { debugStats } from './debug-stats';
import { MapSize } from '@/utilities/map-size';
import type { TickSystem } from './tick-system';
import { BuildingConstructionSystem } from './features/building-construction';
import { EventBus } from './event-bus';

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
    private onRender: ((alpha: number, deltaSec: number) => void) | null = null;
    private onTerrainModified: (() => void) | null = null;
    private animationProvider: AnimationDataProvider | null = null;

    /** Registered tick systems */
    private systems: TickSystem[] = [];

    /** Event bus for inter-system communication */
    public readonly eventBus: EventBus;

    /** Building construction system (registered as TickSystem) */
    public readonly constructionSystem: BuildingConstructionSystem;

    constructor(gameState: GameState, eventBus: EventBus) {
        this.gameState = gameState;
        this.eventBus = eventBus;

        // Create and register the building construction system
        this.constructionSystem = new BuildingConstructionSystem(gameState);
        this.constructionSystem.registerEvents(eventBus);
        this.registerSystem(this.constructionSystem);

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

    /** Set the render callback, called every animation frame with interpolation alpha and delta time */
    public setRenderCallback(callback: (alpha: number, deltaSec: number) => void): void {
        this.onRender = callback;
    }

    /** Set callback for when terrain is modified (e.g., during building construction) */
    public setTerrainModifiedCallback(callback: () => void): void {
        this.onTerrainModified = callback;
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
    }

    public stop(): void {
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

    private frame(now: number): void {
        if (!this.running) return;

        // When page is hidden, throttle to BACKGROUND_FPS to save CPU/battery
        const timeSinceLastRender = now - this.lastRenderTime;
        const shouldRender = this.pageVisible || timeSinceLastRender >= BACKGROUND_FRAME_DURATION;

        if (shouldRender) {
            debugStats.recordFrame(now);
        }

        try {
            const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms
            this.lastTime = now;
            this.accumulator += deltaSec;

            // Fixed timestep simulation - always runs to keep game state consistent
            while (this.accumulator >= TICK_DURATION) {
                this.tick(TICK_DURATION);
                this.accumulator -= TICK_DURATION;
            }

            // Only update animations and render when not throttled
            if (shouldRender) {
                // Update animations (runs every rendered frame for smooth animation)
                if (this.animationProvider) {
                    const deltaMs = deltaSec * 1000;
                    updateAnimations(this.gameState, deltaMs, this.animationProvider);
                }

                // Render with interpolation alpha for smooth sub-tick visuals
                if (this.onRender) {
                    const alpha = this.accumulator / TICK_DURATION;
                    this.onRender(alpha, deltaSec);
                }

                this.lastRenderTime = now;
            }
        } catch (e) {
            GameLoop.log.error('Error in game frame', e instanceof Error ? e : new Error(String(e)));
        }

        this.animRequest = requestAnimationFrame((t) => this.frame(t));
    }

    private tick(dt: number): void {
        debugStats.recordTick();
        // Update unit movement using the new MovementSystem
        this.gameState.movement.update(dt);
        updateIdleBehavior(this.gameState, dt);

        // Update terrain context for building construction if terrain data is available
        if (this.groundType && this.groundHeight && this.mapSize) {
            this.constructionSystem.setTerrainContext({
                groundType: this.groundType,
                groundHeight: this.groundHeight,
                mapSize: this.mapSize,
                onTerrainModified: this.onTerrainModified ?? undefined,
            });
        } else {
            this.constructionSystem.setTerrainContext(undefined);
        }

        // Run all registered tick systems
        for (const system of this.systems) {
            system.tick(dt);
        }

        this.gameState.lumberjackSystem.update(this.gameState, dt);
    }
}
