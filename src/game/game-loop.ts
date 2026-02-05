import { GameState } from './game-state';
import { updateMovement } from './systems/movement';
import { updateBuildingConstruction, TerrainContext } from './systems/building-construction';
import { LogHandler } from '@/utilities/log-handler';
import { debugStats } from './debug-stats';
import { MapSize } from '@/utilities/map-size';

const TICK_RATE = 30;
const TICK_DURATION = 1 / TICK_RATE;

/**
 * Fixed-timestep game loop using requestAnimationFrame.
 * Runs the simulation at a fixed tick rate and calls render every frame.
 * Errors in tick/render are caught so one bad frame doesn't kill the loop.
 */
export class GameLoop {
    private static log = new LogHandler('GameLoop');

    private accumulator = 0;
    private lastTime = 0;
    private running = false;
    private animRequest = 0;

    private gameState: GameState;
    private groundType: Uint8Array | undefined;
    private groundHeight: Uint8Array | undefined;
    private mapWidth: number | undefined;
    private mapHeight: number | undefined;
    private mapSize: MapSize | undefined;
    private onRender: ((alpha: number, deltaSec: number) => void) | null = null;
    private onTerrainModified: (() => void) | null = null;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /** Provide terrain data so movement obstacle resolution can function */
    public setTerrainData(groundType: Uint8Array, groundHeight: Uint8Array, mapWidth: number, mapHeight: number): void {
        this.groundType = groundType;
        this.groundHeight = groundHeight;
        this.mapWidth = mapWidth;
        this.mapHeight = mapHeight;
        this.mapSize = new MapSize(mapWidth, mapHeight);
    }

    /** Set the render callback, called every animation frame with interpolation alpha and delta time */
    public setRenderCallback(callback: (alpha: number, deltaSec: number) => void): void {
        this.onRender = callback;
    }

    /** Set callback for when terrain is modified (e.g., during building construction) */
    public setTerrainModifiedCallback(callback: () => void): void {
        this.onTerrainModified = callback;
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

    public get isRunning(): boolean {
        return this.running;
    }

    private frame(now: number): void {
        if (!this.running) return;

        debugStats.recordFrame(now);

        try {
            const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms
            this.lastTime = now;
            this.accumulator += deltaSec;

            // Fixed timestep simulation
            while (this.accumulator >= TICK_DURATION) {
                this.tick(TICK_DURATION);
                this.accumulator -= TICK_DURATION;
            }

            // Render with interpolation alpha for smooth sub-tick visuals
            if (this.onRender) {
                const alpha = this.accumulator / TICK_DURATION;
                this.onRender(alpha, deltaSec);
            }
        } catch (e) {
            GameLoop.log.error('Error in game frame', e instanceof Error ? e : new Error(String(e)));
        }

        this.animRequest = requestAnimationFrame((t) => this.frame(t));
    }

    private tick(dt: number): void {
        debugStats.recordTick();
        updateMovement(this.gameState, dt, this.groundType, this.groundHeight, this.mapWidth, this.mapHeight);

        // Create terrain context for building construction if terrain data is available
        let terrainContext: TerrainContext | undefined;
        if (this.groundType && this.groundHeight && this.mapSize) {
            terrainContext = {
                groundType: this.groundType,
                groundHeight: this.groundHeight,
                mapSize: this.mapSize,
                onTerrainModified: this.onTerrainModified ?? undefined,
            };
        }

        updateBuildingConstruction(this.gameState, dt, terrainContext);
    }
}
