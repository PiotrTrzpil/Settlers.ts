/**
 * MatchDiagnostics
 *
 * Periodically logs diagnostic information about requests that cannot
 * be matched to a supply. Helps identify logistics bottlenecks during
 * development and gameplay debugging.
 */

import { LogHandler } from '@/utilities/log-handler';
import type { BuildingInventoryManager } from '../inventory';
import type { GameState } from '../../game-state';
import type { ResourceRequest } from './resource-request';

/** How often to log match failure diagnostics (in milliseconds). */
const MATCH_DIAGNOSTIC_INTERVAL_MS = 10_000;

const log = new LogHandler('MatchDiagnostics');

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

    /** Accumulated time since last diagnostic log (in ms). */
    private timeSinceDiagnostic = 0;

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
        this.timeSinceDiagnostic += dt * 1000;
        if (this.timeSinceDiagnostic >= MATCH_DIAGNOSTIC_INTERVAL_MS) {
            this.timeSinceDiagnostic = 0;
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
    logFailure(request: ResourceRequest): void {
        const destBuilding = this.gameState.getEntity(request.buildingId);
        if (!destBuilding) return;

        const supplies = this.inventoryManager.getBuildingsWithOutput(request.materialType, 1);
        const otherSupplies = supplies.filter((id: number) => id !== request.buildingId);
        if (otherSupplies.length > 0) {
            log.debug(
                `Request #${request.id} (material=${request.materialType}): ` +
                    `${otherSupplies.length} supply buildings exist but all reserved or insufficient`
            );
        }
    }
}
