/**
 * Building Overlay Manager (System)
 *
 * Runtime state management for building overlay instances. Creates overlay
 * instances when buildings are completed, removes them when buildings are
 * destroyed, and advances animation timers each tick.
 *
 * This is an engine-level system, not a game feature. It handles rendering
 * concerns (layered sprite management) that serve multiple game features
 * including construction visualization and production animations.
 *
 * The manager does NOT know about sprites — it only tracks timing and
 * condition state. The glue layer (use-renderer.ts) resolves sprites
 * and converts overlay state into render data for the renderer.
 *
 * Public API:
 * - addBuilding / removeBuilding — lifecycle
 * - setWorking — condition state
 * - getOverlays — read overlay instances for rendering
 * - tick — advance animation timers
 */

import type { TickSystem } from '../../tick-system';
import type { BuildingType, EntityProvider } from '../../entity';
import type { Race } from '../../race';
import type { EventBus, EventSubscriptionManager as ESM } from '../../event-bus';
import { EventSubscriptionManager } from '../../event-bus';
import type { OverlayRegistry } from './overlay-registry';
import { OverlayCondition, type BuildingOverlayInstance, type BuildingOverlayDef } from './types';

// ============================================================================
// Config
// ============================================================================

export interface BuildingOverlayManagerConfig {
    /** Registry of static overlay definitions */
    overlayRegistry: OverlayRegistry;
    /** Entity provider for looking up building race */
    entityProvider: EntityProvider;
}

// ============================================================================
// Manager
// ============================================================================

/**
 * Manages building overlay instances and their animation state.
 *
 * Implements TickSystem to advance animation timers each frame.
 * Subscribes to building lifecycle events for automatic cleanup.
 */
export class BuildingOverlayManager implements TickSystem {
    private readonly registry: OverlayRegistry;
    private readonly entityProvider: EntityProvider;
    private readonly overlaysByEntity = new Map<number, BuildingOverlayInstance[]>();
    private readonly subscriptions: ESM = new EventSubscriptionManager();

    constructor(config: BuildingOverlayManagerConfig) {
        this.registry = config.overlayRegistry;
        this.entityProvider = config.entityProvider;
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Create overlay instances for a building.
     * Call when a building completes construction (or is placed already complete).
     *
     * No-op if the building type has no overlay definitions for the given race,
     * or if the building already has overlays registered.
     */
    addBuilding(entityId: number, buildingType: BuildingType, race: Race): void {
        if (this.overlaysByEntity.has(entityId)) return;

        const defs = this.registry.getOverlays(buildingType, race);
        if (defs.length === 0) return;

        const instances = defs.map(def => createInstance(def, entityId));
        this.overlaysByEntity.set(entityId, instances);
    }

    /**
     * Remove all overlay instances for a building.
     * Call when a building is destroyed or removed.
     */
    removeBuilding(entityId: number): void {
        this.overlaysByEntity.delete(entityId);
    }

    // ========================================================================
    // Condition State
    // ========================================================================

    /**
     * Update the working state for a building's overlays.
     *
     * Activates overlays with `OverlayCondition.Working` when working=true,
     * and overlays with `OverlayCondition.Idle` when working=false.
     * Resets animation timers when an overlay transitions from inactive→active.
     */
    setWorking(entityId: number, working: boolean): void {
        const instances = this.overlaysByEntity.get(entityId);
        if (!instances) return;

        for (const inst of instances) {
            const shouldBeActive = evaluateCondition(inst.def.condition, working);
            if (shouldBeActive && !inst.active) {
                // Transition to active — reset animation
                inst.elapsedMs = 0;
            }
            inst.active = shouldBeActive;
        }
    }

    // ========================================================================
    // Read API (used by glue layer)
    // ========================================================================

    /**
     * Get all overlay instances for a building entity.
     * Returns undefined if the building has no overlays.
     *
     * Callers should filter by `active` and use `getOverlayFrame()` for the current frame.
     */
    getOverlays(entityId: number): readonly BuildingOverlayInstance[] | undefined {
        return this.overlaysByEntity.get(entityId);
    }

    /**
     * Set the frame count for an overlay after its sprites have been loaded.
     * Called by the sprite loading pipeline once overlay sprites are in the atlas.
     */
    setFrameCount(entityId: number, overlayKey: string, frameCount: number): void {
        const instances = this.overlaysByEntity.get(entityId);
        if (!instances) return;

        for (const inst of instances) {
            if (inst.def.key === overlayKey) {
                inst.frameCount = frameCount;
                return;
            }
        }
    }

    /**
     * Bulk-set frame counts for all instances matching a given overlay def.
     * More efficient than per-entity setFrameCount when sprites are loaded globally.
     */
    setFrameCountForDef(gfxFile: number, jobIndex: number, directionIndex: number, frameCount: number): void {
        for (const instances of this.overlaysByEntity.values()) {
            for (const inst of instances) {
                const ref = inst.def.spriteRef;
                if (
                    ref.gfxFile === gfxFile &&
                    ref.jobIndex === jobIndex &&
                    (ref.directionIndex ?? 0) === directionIndex
                ) {
                    inst.frameCount = frameCount;
                }
            }
        }
    }

    // ========================================================================
    // TickSystem
    // ========================================================================

    /** Advance animation timers for all active overlays */
    tick(dt: number): void {
        const dtMs = dt * 1000;
        for (const instances of this.overlaysByEntity.values()) {
            for (const inst of instances) {
                if (!inst.active || inst.def.frameDurationMs <= 0) continue;
                inst.elapsedMs += dtMs;
            }
        }
    }

    // ========================================================================
    // Event Registration
    // ========================================================================

    /**
     * Subscribe to building lifecycle events.
     * - `building:completed` → addBuilding
     * - `entity:removed` → removeBuilding
     */
    registerEvents(eventBus: EventBus): void {
        this.subscriptions.subscribe(eventBus, 'building:completed', ({ entityId, buildingState }) => {
            const entity = this.entityProvider.getEntity(entityId);
            if (!entity) return;
            this.addBuilding(entityId, buildingState.buildingType, entity.race);
        });
        this.subscriptions.subscribe(eventBus, 'entity:removed', ({ entityId }) => {
            this.removeBuilding(entityId);
        });
    }

    /** Unsubscribe from all events */
    unregisterEvents(): void {
        this.subscriptions.unsubscribeAll();
    }

    /** Clean up all state */
    destroy(): void {
        this.unregisterEvents();
        this.overlaysByEntity.clear();
    }
}

// ============================================================================
// Internal helpers
// ============================================================================

function createInstance(def: Readonly<BuildingOverlayDef>, entityId: number): BuildingOverlayInstance {
    return {
        def,
        entityId,
        elapsedMs: 0,
        active: def.condition === OverlayCondition.Always,
        frameCount: 1, // Default 1 frame until sprite loading resolves actual count
    };
}

function evaluateCondition(condition: OverlayCondition, working: boolean): boolean {
    switch (condition) {
    case OverlayCondition.Always:
        return true;
    case OverlayCondition.Working:
        return working;
    case OverlayCondition.Idle:
        return !working;
    }
}
