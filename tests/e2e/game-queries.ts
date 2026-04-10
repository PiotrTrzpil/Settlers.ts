/**
 * Unit state and movement query helpers for e2e tests.
 *
 * Standalone functions that operate on a Playwright Page via `page.evaluate()`.
 * GamePage delegates to these; tests can also import them directly.
 */
import type { Page } from '@playwright/test';
import type { Tile } from '@/game/core/coordinates';

// ── Return types ────────────────────────────────────────────────

export interface UnitState {
    prevX: number;
    prevY: number;
    pathLength: number;
    pathIndex: number;
    moveProgress: number;
}

export interface AnimationState {
    sequenceKey: string;
    currentFrame: number;
    direction: number;
    playing: boolean;
    loop: boolean;
    elapsedMs: number;
}

export interface MovementControllerState {
    state: string;
    direction: number;
    tileX: number;
    tileY: number;
}

export interface AnimationSample {
    playing: boolean;
    sequenceKey: string;
}

export interface MovementEvent {
    event: string;
    entityId: number;
    direction: number;
}

// ── Unit state reads ────────────────────────────────────────────

/**
 * Get the unit state for a specific entity (path, movement progress, etc).
 */
export async function getUnitState(page: Page, unitId: number): Promise<UnitState | null> {
    return page.evaluate(
        ({ id }) => {
            const game = window.__settlers__?.game;
            if (!game) return null;
            const us = game.state.unitStates.get(id);
            if (!us) return null;
            return {
                prevX: us.prevX,
                prevY: us.prevY,
                pathLength: us.path.length,
                pathIndex: us.pathIndex,
                moveProgress: us.moveProgress,
            };
        },
        { id: unitId }
    );
}

/**
 * Get animation state for a unit from EntityVisualService.
 */
export async function getAnimationState(page: Page, unitId: number): Promise<AnimationState | null> {
    return page.evaluate(
        ({ id }) => {
            const game = window.__settlers__?.game;
            const visualService = game?.services?.visualService;
            if (!visualService) return null;
            const vs = visualService.getState(id);
            if (!vs?.animation) return null;
            return {
                sequenceKey: vs.animation.sequenceKey,
                currentFrame: vs.animation.currentFrame,
                direction: vs.animation.direction,
                playing: vs.animation.playing,
                loop: vs.animation.loop,
                elapsedMs: vs.animation.elapsedMs,
            };
        },
        { id: unitId }
    );
}

/**
 * Get movement controller state for a unit.
 */
export async function getMovementControllerState(page: Page, unitId: number): Promise<MovementControllerState | null> {
    return page.evaluate(
        ({ id }) => {
            const game = window.__settlers__?.game;
            if (!game) return null;
            const controller = game.state.movement.getController(id);
            if (!controller) return null;
            return {
                state: controller.state,
                direction: controller.direction,
                tileX: controller.tileX,
                tileY: controller.tileY,
            };
        },
        { id: unitId }
    );
}

// ── Sampling helpers ────────────────────────────────────────────

/**
 * Sample animation states over multiple frames while a unit is moving.
 * Returns an array of animation snapshots.
 */
export async function sampleAnimationStates(
    page: Page,
    unitId: number,
    numSamples: number = 10
): Promise<AnimationSample[]> {
    return page.evaluate(
        ({ id, maxSamples }) => {
            return new Promise<Array<{ playing: boolean; sequenceKey: string }>>(resolve => {
                const samples: Array<{ playing: boolean; sequenceKey: string }> = [];
                let count = 0;
                function sample() {
                    const game = window.__settlers__?.game;
                    const visualService = game?.services?.visualService;
                    if (visualService) {
                        const vs = visualService.getState(id);
                        if (vs?.animation) {
                            samples.push({ playing: vs.animation.playing, sequenceKey: vs.animation.sequenceKey });
                        }
                    }
                    count++;
                    if (count < maxSamples) {
                        requestAnimationFrame(sample);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(sample);
            });
        },
        { id: unitId, maxSamples: numSamples }
    );
}

/**
 * Sample unit positions over multiple frames to verify smooth movement.
 * Returns position snapshots taken at each animation frame.
 */
export async function sampleUnitPositions(page: Page, unitId: number, numSamples: number = 10): Promise<Tile[]> {
    return page.evaluate(
        ({ id, maxSamples }) => {
            return new Promise<Array<{ x: number; y: number }>>(resolve => {
                const positions: Array<{ x: number; y: number }> = [];
                let count = 0;
                function sample() {
                    const game = window.__settlers__?.game;
                    if (game) {
                        const u = game.state.getEntity(id);
                        if (u) positions.push({ x: u.x, y: u.y });
                    }
                    count++;
                    if (count < maxSamples) {
                        requestAnimationFrame(sample);
                    } else {
                        resolve(positions);
                    }
                }
                requestAnimationFrame(sample);
            });
        },
        { id: unitId, maxSamples: numSamples }
    );
}

// ── Event capture ───────────────────────────────────────────────

/**
 * Capture movement events by listening on the game event bus.
 * Sets up a capture array and returns functions to retrieve captured events.
 */
export async function captureMovementEvents(page: Page): Promise<{
    getEvents: () => Promise<MovementEvent[]>;
    getCount: () => Promise<number>;
}> {
    await page.evaluate(() => {
        const game = window.__settlers__?.game;
        if (!game) return;
        const captured: Array<{ event: string; entityId: number; direction: number }> = [];
        game.eventBus.on('unit:movementStopped', (payload: any) => {
            captured.push({
                event: 'movementStopped',
                entityId: payload.entityId,
                direction: payload.direction,
            });
        });
        (window as any).__capturedMovementEvents = captured;
    });
    return {
        getEvents: () => page.evaluate(() => (window as any).__capturedMovementEvents ?? []),
        getCount: () => page.evaluate(() => ((window as any).__capturedMovementEvents ?? []).length),
    };
}
