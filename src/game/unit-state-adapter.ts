/**
 * Legacy UnitState adapters — backward-compatible read-only views
 * into the MovementSystem's MovementController.
 *
 * Extracted from game-state.ts to keep the main entity store under the line limit.
 */

import { EntityType, UnitType, isUnitTypeSelectable, Tile } from './entity';
import type { MovementSystem, MovementController } from './systems/movement/index';

/**
 * Legacy UnitState interface for backward compatibility.
 * This is a read-only view into a MovementController.
 * Note: Animation-related state (idleTime, etc.) is now managed by the animation system.
 */
export interface UnitStateView {
    readonly entityId: number;
    readonly path: ReadonlyArray<Tile>;
    readonly pathIndex: number;
    readonly moveProgress: number;
    readonly speed: number;
    readonly prevX: number;
    readonly prevY: number;
    /** Current facing direction (EDirection enum value, 0-5). */
    readonly direction: number;
}

/**
 * Interface for looking up unit states by entity ID.
 * Used by renderers and other systems that need to access unit movement state.
 */
export interface UnitStateLookup {
    get(entityId: number): UnitStateView | undefined;
}

/**
 * Adapter that wraps a MovementController as a UnitStateView.
 * Provides backward-compatible read access to movement state.
 */
class UnitStateAdapter implements UnitStateView {
    constructor(private controller: MovementController) {}

    get entityId(): number {
        return this.controller.entityId;
    }
    get path(): ReadonlyArray<Tile> {
        return this.controller.path;
    }
    get pathIndex(): number {
        return this.controller.pathIndex;
    }
    get moveProgress(): number {
        return this.controller.progress;
    }
    get speed(): number {
        return this.controller.speed;
    }
    get prevX(): number {
        return this.controller.prevTileX;
    }
    get prevY(): number {
        return this.controller.prevTileY;
    }
    get direction(): number {
        return this.controller.direction;
    }
}

/**
 * Adapter Map that provides legacy unitStates interface.
 * Wraps MovementSystem for backward compatibility with existing code.
 */
export class UnitStateMap implements UnitStateLookup {
    constructor(private movementSystem: MovementSystem) {}

    get(entityId: number): UnitStateView | undefined {
        const controller = this.movementSystem.getController(entityId);
        return controller ? new UnitStateAdapter(controller) : undefined;
    }

    has(entityId: number): boolean {
        return this.movementSystem.hasController(entityId);
    }

    delete(entityId: number): boolean {
        if (this.movementSystem.hasController(entityId)) {
            this.movementSystem.removeController(entityId);
            return true;
        }
        return false;
    }

    values(): IterableIterator<UnitStateView> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- needed for generator context
        const self = this;
        return (function* () {
            for (const controller of self.movementSystem.getAllControllers()) {
                yield new UnitStateAdapter(controller);
            }
        })();
    }

    *[Symbol.iterator](): IterableIterator<[number, UnitStateView]> {
        for (const controller of this.movementSystem.getAllControllers()) {
            yield [controller.entityId, new UnitStateAdapter(controller)];
        }
    }
}

/** Determine entity selectability from type + subtype (no explicit override). */
export function resolveEntitySelectable(type: EntityType, subType: number | string): boolean | undefined {
    switch (type) {
        case EntityType.Unit:
            return isUnitTypeSelectable(subType as UnitType);
        case EntityType.Building:
            return true;
        case EntityType.MapObject:
        case EntityType.StackedPile:
        case EntityType.Decoration:
        case EntityType.None:
            return false;
    }
}
