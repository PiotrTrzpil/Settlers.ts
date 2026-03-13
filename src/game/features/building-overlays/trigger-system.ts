/**
 * TriggerSystem — fires and stops building overlay animations from choreography trigger IDs.
 *
 * When a ChoreoNode has a non-empty `trigger` field, the choreography executor calls
 * `fireTrigger` at node start and `stopTrigger` at node end (or on interrupt).
 *
 * Trigger IDs from jobInfo.xml (e.g. `TRIGGER_BAKER_WORK`, `TRIGGER_START_SLOT6`) are
 * looked up in BuildingTrigger.xml via GameDataLoader. Each trigger maps to overlay
 * actions (currently: Working condition) driven through BuildingOverlayManager.
 *
 * Slot-specific triggers (TRIGGER_START_SLOT*) target a specific patch slot whereas
 * generic work triggers activate the building's Working condition overlays.
 */

import { createLogger } from '@/utilities/logger';
import type { TriggerSystem } from '@/game/features/settler-tasks/choreo-types';
import type { GameState } from '@/game/game-state';
import type { GameDataLoader } from '@/resources/game-data/game-data-loader';
import type { BuildingTrigger } from '@/resources/game-data/types';
import { EntityType } from '@/game/entity';
import { raceToRaceId } from '@/game/data/game-data-access';
const log = createLogger('TriggerSystem');

// ============================================================================
// Config
// ============================================================================

/** Constructor dependencies for TriggerSystemImpl. */
export interface TriggerSystemConfig {
    /** Callback to set working/idle overlay state on a building. */
    setWorkingOverlay: (buildingId: number, working: boolean) => void;
    /** Entity store for building race and type lookups. */
    gameState: Pick<GameState, 'getEntity' | 'getEntityOrThrow'>;
    /** Game data loader for BuildingTrigger XML definitions. */
    dataLoader: Pick<GameDataLoader, 'getBuildingTrigger'>;
}

// ============================================================================
// Internal types
// ============================================================================

/** Tracks which trigger IDs are currently active for a building. */
type ActiveTriggerSet = Set<string>;

// ============================================================================
// Implementation
// ============================================================================

/**
 * Implements TriggerSystem by mapping trigger IDs to BuildingOverlayManager calls.
 *
 * On `fireTrigger`:
 *   1. Look up the building entity to get its race.
 *   2. Look up the BuildingTrigger definition from game data.
 *   3. Activate Working overlays on the building via the overlay manager.
 *   4. Track the active trigger for cleanup.
 *
 * On `stopTrigger`:
 *   1. Remove the trigger from active tracking.
 *   2. If no more triggers are active for the building, deactivate Working overlays.
 *
 * The "working" state on the overlay manager is ref-counted: the building stays in
 * Working state as long as at least one trigger is active.  This correctly handles
 * the (unusual) case where two triggers fire simultaneously for the same building.
 */
export class TriggerSystemImpl implements TriggerSystem {
    private readonly setWorkingOverlay: (buildingId: number, working: boolean) => void;
    private readonly gameState: Pick<GameState, 'getEntity' | 'getEntityOrThrow'>;
    private readonly dataLoader: Pick<GameDataLoader, 'getBuildingTrigger'>;

    /** Active triggers per building: buildingId → Set of active trigger IDs */
    private readonly activeTriggers = new Map<number, ActiveTriggerSet>();

    constructor(config: TriggerSystemConfig) {
        this.setWorkingOverlay = config.setWorkingOverlay;
        this.gameState = config.gameState;
        this.dataLoader = config.dataLoader;
    }

    // ========================================================================
    // TriggerSystem interface
    // ========================================================================

    /**
     * Fire a trigger for a building.
     *
     * Looks up the building entity, resolves the BuildingTrigger definition,
     * activates Working overlays, and records the trigger as active.
     *
     * Logs a warning and is a no-op when:
     * - The trigger ID is unknown for the building's race (unknown triggers in XML)
     * - The trigger is already active for this building (idempotent guard)
     */
    fireTrigger(buildingId: number, triggerId: string): void {
        if (!triggerId) {
            return;
        }

        const building = this.gameState.getEntity(buildingId);
        if (!building) {
            return;
        }

        if (building.type !== EntityType.Building) {
            log.warn(
                `fireTrigger: entity ${buildingId} is not a building (type=${building.type}) for trigger '${triggerId}'`
            );
            return;
        }

        // Retrieve trigger definition — tolerate unknown triggers (XML may not cover all races)
        const raceId = raceToRaceId(building.race);
        const triggerDef = this.dataLoader.getBuildingTrigger(raceId, triggerId);
        if (!triggerDef) {
            if (!SUPPRESSED_TRIGGERS.get(raceId)?.has(triggerId)) {
                log.warn(`fireTrigger: unknown trigger '${triggerId}' for race ${raceId} on building ${buildingId}`);
            }
            return;
        }

        // Record as active
        let activeSet = this.activeTriggers.get(buildingId);
        if (!activeSet) {
            activeSet = new Set();
            this.activeTriggers.set(buildingId, activeSet);
        }

        if (activeSet.has(triggerId)) {
            // Already active — idempotent, no need to re-activate
            return;
        }

        activeSet.add(triggerId);

        // Activate overlay: if this is the first trigger on the building, switch to Working
        if (activeSet.size === 1) {
            this.setWorkingOverlay(buildingId, true);
        }

        this.applyTriggerEffects(buildingId, triggerDef, true);
    }

    /**
     * Stop a trigger for a building.
     *
     * Removes the trigger from the active set. When no triggers remain active,
     * deactivates Working overlays (switches to Idle).
     *
     * Safe to call when the trigger is not active (no-op). Building must still exist.
     */
    stopTrigger(buildingId: number, triggerId: string): void {
        if (!triggerId) {
            return;
        }

        const activeSet = this.activeTriggers.get(buildingId);
        if (!activeSet || !activeSet.has(triggerId)) {
            // Trigger was never fired or already stopped — no-op
            return;
        }

        activeSet.delete(triggerId);

        if (activeSet.size === 0) {
            // No more active triggers — deactivate Working overlays
            this.activeTriggers.delete(buildingId);
            this.setWorkingOverlay(buildingId, false);

            // Apply stop effects (if any)
            const building = this.gameState.getEntityOrThrow(buildingId, 'building for trigger deactivation');
            if (building.type === EntityType.Building) {
                const raceId = raceToRaceId(building.race);
                const triggerDef = this.dataLoader.getBuildingTrigger(raceId, triggerId);
                if (triggerDef) {
                    this.applyTriggerEffects(buildingId, triggerDef, false);
                }
            }
        }
    }

    // ========================================================================
    // Cleanup
    // ========================================================================

    /**
     * Remove all active triggers for a building and deactivate its Working overlays.
     * Call when a building is destroyed or when the game is reset.
     */
    clearBuilding(buildingId: number): void {
        if (!this.activeTriggers.has(buildingId)) {
            return;
        }
        this.activeTriggers.delete(buildingId);
        this.setWorkingOverlay(buildingId, false);
    }

    /** Clear all active trigger state. */
    reset(): void {
        this.activeTriggers.clear();
    }

    // ========================================================================
    // Read API
    // ========================================================================

    /** Returns true if any trigger is currently active for the given building. */
    hasActiveTrigger(buildingId: number): boolean {
        const set = this.activeTriggers.get(buildingId);
        return set !== undefined && set.size > 0;
    }

    /** Returns the set of currently active trigger IDs for a building (empty if none). */
    getActiveTriggers(buildingId: number): ReadonlySet<string> {
        return this.activeTriggers.get(buildingId) ?? EMPTY_SET;
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    /**
     * Apply any additional side-effects from a BuildingTrigger definition.
     *
     * Currently this is a forward-compatible stub: the BuildingTrigger data includes
     * `effects` (visual effects like smoke) and `patches` (slot animations).  Full
     * patch/slot activation requires a sprite patch system that is not yet implemented.
     * We log the trigger contents at debug level so future implementers can see what
     * data is available.
     *
     * @param buildingId - The building entity ID
     * @param triggerDef - Parsed BuildingTrigger from game data
     * @param starting - true when the trigger is starting, false when stopping
     */
    private applyTriggerEffects(buildingId: number, triggerDef: BuildingTrigger, starting: boolean): void {
        if (triggerDef.patches.length > 0) {
            log.debug(
                `TriggerSystem: ${starting ? 'start' : 'stop'} trigger '${triggerDef.id}' ` +
                    `on building ${buildingId} — ${triggerDef.patches.length} patch(es), ` +
                    `${triggerDef.effects.length} effect(s) (patch activation not yet implemented)`
            );
        }
    }
}

// ============================================================================
// Constants
// ============================================================================

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Triggers intentionally absent from BuildingTrigger.xml for specific races
 * (commented out in the original game data). Silence warnings for these.
 */
const SUPPRESSED_TRIGGERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ['RACE_ROMAN', new Set(['TRIGGER_TOOLSMITH_SMALLSMOKE', 'TRIGGER_WEAPONSMITH_SMALLSMOKE'])],
]);
