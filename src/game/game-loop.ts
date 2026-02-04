import { GameState } from './game-state';
import { updateMovement } from './systems/movement';
import { LogHandler } from '@/utilities/log-handler';

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
    private onRender: (() => void) | null = null;

    constructor(gameState: GameState) {
        this.gameState = gameState;
    }

    /** Set the render callback, called every animation frame */
    public setRenderCallback(callback: () => void): void {
        this.onRender = callback;
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

        try {
            const deltaSec = Math.min((now - this.lastTime) / 1000, 0.1); // cap at 100ms
            this.lastTime = now;
            this.accumulator += deltaSec;

            // Fixed timestep simulation
            while (this.accumulator >= TICK_DURATION) {
                this.tick(TICK_DURATION);
                this.accumulator -= TICK_DURATION;
            }

            // Render
            if (this.onRender) {
                this.onRender();
            }
        } catch (e) {
            GameLoop.log.error('Error in game frame', e instanceof Error ? e : new Error(String(e)));
        }

        this.animRequest = requestAnimationFrame((t) => this.frame(t));
    }

    private tick(dt: number): void {
        updateMovement(this.gameState, dt);
    }
}
