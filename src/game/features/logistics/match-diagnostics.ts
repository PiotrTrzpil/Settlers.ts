/**
 * MatchDiagnostics
 *
 * Periodically logs diagnostic information about requests that cannot
 * be matched to a supply. Helps identify logistics bottlenecks during
 * development and gameplay debugging.
 */

import { createLogger } from '@/utilities/logger';
import type { BuildingInventoryManager } from '../inventory';
import type { GameState } from '../../game-state';
import type { DemandEntry } from './demand-queue';
import { PeriodicTimer } from './periodic-timer';

/** How often to log match failure diagnostics (in seconds). */
const MATCH_DIAGNOSTIC_INTERVAL_SEC = 10;

const log = createLogger('MatchDiagnostics');

export interface MatchDiagnosticsConfig {
    gameState: GameState;
    inventoryManager: BuildingInventoryManager;
}

/**
 * Tracks and logs match failure diagnostics on a throttled interval.
 *
 * Call `tick(dt)` each game tick to advance the timer.
 * Use `isDue()` to check whether diagnostics should be emitted this tick,
 * and `logFailure(request)` to record an individual match failure.
 * Call `markConsumed()` after processing all failures for the tick.
 */
export class MatchDiagnostics {
    private readonly gameState: GameState;
    private readonly inventoryManager: BuildingInventoryManager;
    private readonly timer = new PeriodicTimer(MATCH_DIAGNOSTIC_INTERVAL_SEC);

    /** True when the diagnostic interval has elapsed and failures should be logged. */
    private diagnosticDue = false;

    constructor(config: MatchDiagnosticsConfig) {
        this.gameState = config.gameState;
        this.inventoryManager = config.inventoryManager;
    }

    /**
     * Advance the diagnostic timer.
     *
     * @param dt Delta time in seconds.
     */
    tick(dt: number): void {
        if (this.timer.advance(dt)) {
            this.diagnosticDue = true;
        }
    }

    /**
     * Returns true if diagnostic logging is due this tick.
     * After all failures have been logged, call `markConsumed()`.
     */
    isDue(): boolean {
        return this.diagnosticDue;
    }

    /**
     * Reset the diagnostic-due flag after the current tick's failures are logged.
     */
    markConsumed(): void {
        this.diagnosticDue = false;
    }

    /**
     * Log diagnostic information for a request that could not be matched to a supply.
     * Only logs if `isDue()` is true; callers should check before invoking.
     *
     * @param request The unmatched request.
     */
    logFailure(request: DemandEntry): void {
        const destBuilding = this.gameState.getEntity(request.buildingId);
        if (!destBuilding) return;

        const supplies = this.inventoryManager.getSourcesWithOutput(request.materialType, 1);
        const otherSupplies = supplies.filter((id: number) => id !== request.buildingId);
        if (otherSupplies.length > 0) {
            log.debug(
                `Request #${request.id} (material=${request.materialType}): ` +
                    `${otherSupplies.length} supply buildings exist but all reserved or insufficient`
            );
        }
    }
}
