import { reactive } from 'vue';
import { GameState } from './game-state';
import { EntityType } from './entity';
import type { Game } from './game';

const WINDOW_SIZE = 60;

export interface DebugStatsState {
    // Readiness (for Playwright tests)
    gameLoaded: boolean;
    rendererReady: boolean;
    frameCount: number;

    // Performance
    fps: number;
    frameTimeMs: number;
    frameTimeMin: number;
    frameTimeMax: number;
    ticksPerSec: number;

    // Entities
    entityCount: number;
    buildingCount: number;
    unitCount: number;
    unitsMoving: number;
    totalPathSteps: number;

    // Camera (written externally)
    cameraX: number;
    cameraY: number;
    zoom: number;
    zoomSpeed: number;
    canvasWidth: number;
    canvasHeight: number;

    // Tile (written externally)
    tileX: number;
    tileY: number;
    tileGroundType: number;
    tileGroundHeight: number;
    hasTile: boolean;

    // Game mode (written externally)
    mode: string;
    selectedEntityId: number | null;
    selectedCount: number;

    // River texture debug
    riverSlotPermutation: number;
    riverFlipInner: boolean;
    riverFlipOuter: boolean;
    riverFlipMiddle: boolean;
}

class DebugStats {
    public readonly state: DebugStatsState;

    private frameTimes: number[] = [];
    private lastFrameTime = 0;
    private tickCount = 0;
    private tickResetTime = 0;

    constructor() {
        this.state = reactive<DebugStatsState>({
            gameLoaded: false,
            rendererReady: false,
            frameCount: 0,
            fps: 0,
            frameTimeMs: 0,
            frameTimeMin: 0,
            frameTimeMax: 0,
            ticksPerSec: 0,
            entityCount: 0,
            buildingCount: 0,
            unitCount: 0,
            unitsMoving: 0,
            totalPathSteps: 0,
            cameraX: 0,
            cameraY: 0,
            zoom: 0,
            zoomSpeed: 0.05,
            canvasWidth: 0,
            canvasHeight: 0,
            tileX: 0,
            tileY: 0,
            tileGroundType: 0,
            tileGroundHeight: 0,
            hasTile: false,
            mode: '',
            selectedEntityId: null,
            selectedCount: 0,
            riverSlotPermutation: 0,
            riverFlipInner: false,
            riverFlipOuter: false,
            riverFlipMiddle: false,
        });

        // Expose on window for Playwright tests
        (window as any).__settlers_debug__ = this.state;
    }

    public recordFrame(now: number): void {
        this.state.frameCount++;
        if (this.lastFrameTime > 0) {
            const dt = now - this.lastFrameTime;
            this.frameTimes.push(dt);
            if (this.frameTimes.length > WINDOW_SIZE) {
                this.frameTimes.shift();
            }

            const sum = this.frameTimes.reduce((a, b) => a + b, 0);
            const avg = sum / this.frameTimes.length;
            this.state.fps = Math.round(1000 / avg);
            this.state.frameTimeMs = Math.round(avg * 10) / 10;
            this.state.frameTimeMin = Math.round(Math.min(...this.frameTimes) * 10) / 10;
            this.state.frameTimeMax = Math.round(Math.max(...this.frameTimes) * 10) / 10;
        }
        this.lastFrameTime = now;
    }

    public recordTick(): void {
        this.tickCount++;
        const now = performance.now();
        if (now - this.tickResetTime >= 1000) {
            this.state.ticksPerSec = this.tickCount;
            this.tickCount = 0;
            this.tickResetTime = now;
        }
    }

    public updateFromGame(game: Game): void {
        // Expose game reference for e2e tests (Vue internals are stripped in prod builds)
        (window as any).__settlers_game__ = game;
        const gameState = game.state;
        this.state.entityCount = gameState.entities.length;

        let buildings = 0;
        let units = 0;
        for (const e of gameState.entities) {
            if (e.type === EntityType.Building) buildings++;
            else if (e.type === EntityType.Unit) units++;
        }
        this.state.buildingCount = buildings;
        this.state.unitCount = units;

        let moving = 0;
        let pathSteps = 0;
        for (const us of gameState.unitStates.values()) {
            const remaining = us.path.length - us.pathIndex;
            if (remaining > 0) {
                moving++;
                pathSteps += remaining;
            }
        }
        this.state.unitsMoving = moving;
        this.state.totalPathSteps = pathSteps;

        this.state.mode = game.mode;
        this.state.selectedEntityId = gameState.selectedEntityId;
        this.state.selectedCount = gameState.selectedEntityIds.size;
    }
}

export const debugStats = new DebugStats();
