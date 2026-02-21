import type { Page, Locator } from '@playwright/test';
import { Frames, Timeout } from './wait-config';
import { WaitProfiler, type WaitCategory } from './wait-profiler';

// ── Profiler infrastructure ──────────────────────────────────

/**
 * Instrumented wrapper for page.waitForFunction with profiling.
 * @param label - Format: "category:method:condition"
 */
async function waitForFunction<T>(
    page: Page,
    label: string,
    pageFunction: (...args: any[]) => T | Promise<T>,
    arg?: any,
    options?: { timeout?: number }
): Promise<void> {
    const timeout = options?.timeout ?? Timeout.DEFAULT;

    if (!WaitProfiler.isEnabled()) {
        await page.waitForFunction(pageFunction as any, arg, options);
        return;
    }

    const [category, method, ...conditionParts] = label.split(':');
    const condition = conditionParts.join(':') || method || label;
    const startTime = performance.now();
    let timedOut = false;

    try {
        await page.waitForFunction(pageFunction as any, arg, options);
    } catch (error) {
        if (error instanceof Error && error.message.includes('Timeout')) {
            timedOut = true;
        }
        throw error;
    } finally {
        const endTime = performance.now();
        WaitProfiler.record({
            category: (category as WaitCategory) || 'state',
            method: method || 'waitForFunction',
            condition,
            startTime,
            endTime,
            duration: endTime - startTime,
            pollCount: 0,
            timedOut,
            timeout,
        });
    }
}

/**
 * Instrumented wrapper for any async wait operation.
 * @param label - Format: "category:method:condition"
 */
async function profiledWait<T>(label: string, timeout: number, fn: () => Promise<T>): Promise<T> {
    if (!WaitProfiler.isEnabled()) {
        return fn();
    }

    const [category, method, ...conditionParts] = label.split(':');
    const condition = conditionParts.join(':') || method || label;
    const startTime = performance.now();
    let timedOut = false;

    try {
        return await fn();
    } catch (error) {
        if (error instanceof Error && error.message.includes('Timeout')) {
            timedOut = true;
        }
        throw error;
    } finally {
        const endTime = performance.now();
        WaitProfiler.record({
            category: (category as WaitCategory) || 'state',
            method: method || 'wait',
            condition,
            startTime,
            endTime,
            duration: endTime - startTime,
            pollCount: 0,
            timedOut,
            timeout,
        });
    }
}

// ── Game readiness waits ─────────────────────────────────────

/** Wait until the game UI is mounted in the DOM. */
export async function waitForGameUi(
    page: Page,
    gameUi: Locator,
    timeout: number = Timeout.INITIAL_LOAD
): Promise<void> {
    await profiledWait('dom:waitForGameUi:game UI visible', timeout, () => gameUi.waitFor({ timeout }));
}

/**
 * Wait until the renderer has drawn at least `minFrames` **new** frames.
 */
export async function waitForFrames(
    page: Page,
    minFrames: number = Frames.RENDER_SETTLE,
    timeout: number = Timeout.INITIAL_LOAD
): Promise<void> {
    const start = await page.evaluate(() => window.__settlers__?.debug?.frameCount ?? 0);
    const target = start + minFrames;
    await waitForFunction(
        page,
        `frame:waitForFrames:${minFrames} frames`,
        t => (window.__settlers__?.debug?.frameCount ?? 0) >= t,
        target,
        { timeout }
    );
}

/**
 * Wait for game loaded + renderer ready + N frames rendered.
 */
export async function waitForReady(
    page: Page,
    minFrames: number = Frames.RENDER_SETTLE,
    timeout: number = Timeout.INITIAL_LOAD
): Promise<void> {
    await waitForFunction(
        page,
        'frame:waitForReady:gameLoaded && rendererReady',
        () => {
            const d = window.__settlers__?.debug;
            return d?.gameLoaded && d?.rendererReady;
        },
        null,
        { timeout }
    );
    await waitForFrames(page, minFrames, timeout);
}

/**
 * Wait for game state to be initialized, WITHOUT requiring WebGL rendering.
 */
export async function waitForGameReady(
    page: Page,
    minTicks: number = 5,
    timeout: number = Timeout.INITIAL_LOAD
): Promise<void> {
    await waitForFunction(
        page,
        'state:waitForGameReady:gameLoaded',
        () => window.__settlers__?.debug?.gameLoaded,
        null,
        { timeout }
    );
    await waitForTicks(page, minTicks, timeout);
}

/**
 * Wait for N game ticks to elapse (not render frames).
 */
export async function waitForTicks(page: Page, minTicks: number = 5, timeout: number = Timeout.DEFAULT): Promise<void> {
    const start = await page.evaluate(() => window.__settlers__?.debug?.tickCount ?? 0);
    const target = start + minTicks;
    await waitForFunction(
        page,
        `state:waitForTicks:${minTicks} ticks`,
        t => (window.__settlers__?.debug?.tickCount ?? 0) >= t,
        target,
        { timeout }
    );
}

// ── Polling waits ────────────────────────────────────────────

/** Wait for entity count to exceed a given value. */
export async function waitForEntityCountAbove(page: Page, n: number, timeout: number = Timeout.DEFAULT): Promise<void> {
    await waitForFunction(
        page,
        `state:waitForEntityCountAbove:entityCount > ${n}`,
        min => (window.__settlers__?.view?.entityCount ?? 0) > min,
        n,
        { timeout }
    );
}

/** Wait for unit count to reach expected value. */
export async function waitForUnitCount(page: Page, expected: number, timeout: number = Timeout.DEFAULT): Promise<void> {
    await waitForFunction(
        page,
        `state:waitForUnitCount:unitCount === ${expected}`,
        n => window.__settlers__?.view?.unitCount === n,
        expected,
        { timeout }
    );
}

/** Wait for building count to reach expected value. */
export async function waitForBuildingCount(
    page: Page,
    expected: number,
    timeout: number = Timeout.DEFAULT
): Promise<void> {
    await waitForFunction(
        page,
        `state:waitForBuildingCount:buildingCount === ${expected}`,
        n => window.__settlers__?.view?.buildingCount === n,
        expected,
        { timeout }
    );
}

/** Wait for mode to change to expected value. */
export async function waitForMode(page: Page, expectedMode: string, timeout: number = Timeout.DEFAULT): Promise<void> {
    await waitForFunction(
        page,
        `render:waitForMode:mode === ${expectedMode}`,
        mode => window.__settlers__?.view?.mode === mode,
        expectedMode,
        { timeout }
    );
}

// ── Movement waits ───────────────────────────────────────────

/** Wait for at least N units to be moving. */
export async function waitForUnitsMoving(
    page: Page,
    minMoving: number,
    timeout: number = Timeout.DEFAULT
): Promise<void> {
    await waitForFunction(
        page,
        `movement:waitForUnitsMoving:unitsMoving >= ${minMoving}`,
        n => (window.__settlers__?.view?.unitsMoving ?? 0) >= n,
        minMoving,
        { timeout }
    );
}

/** Wait for no units to be moving (all stationary). */
export async function waitForNoUnitsMoving(page: Page, timeout: number = Timeout.DEFAULT): Promise<void> {
    await waitForFunction(
        page,
        'movement:waitForNoUnitsMoving:unitsMoving === 0',
        () => (window.__settlers__?.view?.unitsMoving ?? 0) === 0,
        null,
        { timeout }
    );
}

/** Wait for a specific unit to reach its destination. */
export async function waitForUnitAtDestination(
    page: Page,
    unitId: number,
    targetX: number,
    targetY: number,
    timeout: number = Timeout.LONG_MOVEMENT
): Promise<void> {
    await waitForFunction(
        page,
        `movement:waitForUnitAtDestination:unit ${unitId} at (${targetX},${targetY})`,
        ({ id, tx, ty }) => {
            const game = window.__settlers__?.game;
            if (!game) return false;
            const unit = game.state.getEntity(id);
            const unitState = game.state.unitStates.get(id);
            return unit && unit.x === tx && unit.y === ty && unitState && unitState.path.length === 0;
        },
        { id: unitId, tx: targetX, ty: targetY },
        { timeout }
    );
}

/** Wait for a unit to move away from its starting position. */
export async function waitForUnitToMove(
    page: Page,
    unitId: number,
    startX: number,
    startY: number,
    timeout: number = Timeout.DEFAULT
): Promise<void> {
    await waitForFunction(
        page,
        `movement:waitForUnitToMove:unit ${unitId} moved from (${startX},${startY})`,
        ({ id, sx, sy }) => {
            const game = window.__settlers__?.game;
            if (!game) return false;
            const unit = game.state.getEntity(id);
            return unit != null && (unit.x !== sx || unit.y !== sy);
        },
        { id: unitId, sx: startX, sy: startY },
        { timeout }
    );
}

/** Wait for a unit's movement controller to reach 'idle' state. */
export async function waitForMovementIdle(
    page: Page,
    unitId: number,
    timeout: number = Timeout.DEFAULT
): Promise<void> {
    await waitForFunction(
        page,
        `movement:waitForMovementIdle:controller idle for unit ${unitId}`,
        id => {
            const game = window.__settlers__?.game;
            if (!game) return false;
            const controller = game.state.movement.getController(id);
            return controller && controller.state === 'idle';
        },
        unitId,
        { timeout }
    );
}

// ── Inventory waits ──────────────────────────────────────────

/** Wait for a building's output slot to reach a minimum amount. */
export async function waitForBuildingOutput(
    page: Page,
    buildingId: number,
    materialType: number,
    minAmount: number,
    timeout: number = Timeout.DEFAULT
): Promise<void> {
    await waitForFunction(
        page,
        `state:waitForBuildingOutput:building ${buildingId} output material ${materialType} >= ${minAmount}`,
        ({ id, mt, min }) => {
            const game = window.__settlers__?.game;
            if (!game?.services?.inventoryManager) return false;
            return game.services.inventoryManager.getOutputAmount(id, mt) >= min;
        },
        { id: buildingId, mt: materialType, min: minAmount },
        { timeout }
    );
}

/** Wait for a building's input slot to reach a minimum amount. */
export async function waitForBuildingInput(
    page: Page,
    buildingId: number,
    materialType: number,
    minAmount: number,
    timeout: number = Timeout.DEFAULT
): Promise<void> {
    await waitForFunction(
        page,
        `state:waitForBuildingInput:building ${buildingId} input material ${materialType} >= ${minAmount}`,
        ({ id, mt, min }) => {
            const game = window.__settlers__?.game;
            if (!game?.services?.inventoryManager) return false;
            return game.services.inventoryManager.getInputAmount(id, mt) >= min;
        },
        { id: buildingId, mt: materialType, min: minAmount },
        { timeout }
    );
}

// ── Audio waits ──────────────────────────────────────────────

/** Wait for AudioContext to be in 'running' state. Resolves gracefully if no AudioContext. */
export async function waitForAudioContextRunning(page: Page, timeout: number = Timeout.FAST): Promise<void> {
    await waitForFunction(
        page,
        'audio:unlockAudio:AudioContext running',
        () => {
            const game = window.__settlers__?.game;
            const ctx = (game?.soundManager as { audioContext?: AudioContext } | undefined)?.audioContext;
            return !ctx || ctx.state === 'running';
        },
        null,
        { timeout }
    );
}
