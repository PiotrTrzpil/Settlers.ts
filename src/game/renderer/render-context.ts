/**
 * RenderContext Interface
 *
 * Decouples the renderer from game internals by providing a read-only view
 * of all data needed for rendering. This allows:
 * - Clear separation between game state and rendering
 * - Easier testing (mock context implementation)
 * - Better encapsulation (renderer doesn't need direct Game access)
 *
 * @see docs/modularity-review.md item 8
 */

import type { Entity, StackedResourceState } from '../entity';
import type { UnitStateLookup } from '../game-state';
import type { BuildingVisualState, BuildingState } from '../features/building-construction';
import type { IViewPoint } from './i-view-point';
import { DEFAULT_LAYER_VISIBILITY, type LayerVisibility } from './layer-visibility';
import type { PlacementPreviewState } from './entity-renderer';
import { BuildingConstructionPhase } from '../features/building-construction';

/**
 * Selection state for rendering.
 */
export interface SelectionState {
    /** Primary selected entity ID (for backward compatibility) */
    readonly primaryId: number | null;
    /** All selected entity IDs */
    readonly ids: ReadonlySet<number>;
}

/**
 * Read-only interface providing all data needed for entity rendering.
 * The renderer should only depend on this interface, not on Game or GameState directly.
 */
export interface IRenderContext {
    // === Entity Data ===
    /** All entities to render */
    readonly entities: readonly Entity[];
    /** Unit movement states for interpolation */
    readonly unitStates: UnitStateLookup;
    /** Resource stack states */
    readonly resourceStates: ReadonlyMap<number, StackedResourceState>;
    /** Building construction states */
    readonly buildingStates: ReadonlyMap<number, BuildingState>;
    /** Get the visual state for a building (handles undefined states gracefully) */
    getBuildingVisualState(entityId: number): BuildingVisualState;

    // === Selection ===
    /** Current selection state */
    readonly selection: SelectionState;

    // === Placement Preview ===
    /** Current placement preview, if any */
    readonly placementPreview: PlacementPreviewState | null;

    // === Render Parameters ===
    /** Interpolation alpha for smooth sub-tick rendering (0-1) */
    readonly alpha: number;
    /** Layer visibility settings */
    readonly layerVisibility: LayerVisibility;

    // === Terrain Data ===
    /** Ground height array for tile-to-world conversion */
    readonly groundHeight: Uint8Array;
    /** Ground type array */
    readonly groundType: Uint8Array;
    /** Map dimensions */
    readonly mapWidth: number;
    readonly mapHeight: number;

    // === Camera ===
    /** Current view point for world coordinate calculation */
    readonly viewPoint: IViewPoint;
}

/**
 * Builder for creating IRenderContext instances.
 * Allows incremental construction with method chaining.
 */
export class RenderContextBuilder {
    private _entities: readonly Entity[] = [];
    private _unitStates: UnitStateLookup = { get: () => undefined };
    private _resourceStates: ReadonlyMap<number, StackedResourceState> = new Map();
    private _buildingStates: ReadonlyMap<number, BuildingState> = new Map();
    private _buildingVisualStateGetter: (entityId: number) => BuildingVisualState = () => ({
        phase: BuildingConstructionPhase.Completed,
        verticalProgress: 1,
        overallProgress: 1,
        useConstructionSprite: false,
        isCompleted: true,
    });
    private _selection: SelectionState = { primaryId: null, ids: new Set() };
    private _placementPreview: PlacementPreviewState | null = null;
    private _alpha = 0;
    private _layerVisibility: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };
    private _groundHeight: Uint8Array = new Uint8Array(0);
    private _groundType: Uint8Array = new Uint8Array(0);
    private _mapWidth = 0;
    private _mapHeight = 0;
    private _viewPoint: IViewPoint | null = null;

    entities(entities: readonly Entity[]): this {
        this._entities = entities;
        return this;
    }

    unitStates(states: UnitStateLookup): this {
        this._unitStates = states;
        return this;
    }

    resourceStates(states: ReadonlyMap<number, StackedResourceState>): this {
        this._resourceStates = states;
        return this;
    }

    buildingStates(states: ReadonlyMap<number, BuildingState>): this {
        this._buildingStates = states;
        return this;
    }

    buildingVisualStateGetter(getter: (entityId: number) => BuildingVisualState): this {
        this._buildingVisualStateGetter = getter;
        return this;
    }

    selection(state: SelectionState): this {
        this._selection = state;
        return this;
    }

    placementPreview(preview: PlacementPreviewState | null): this {
        this._placementPreview = preview;
        return this;
    }

    alpha(value: number): this {
        this._alpha = value;
        return this;
    }

    layerVisibility(visibility: LayerVisibility): this {
        this._layerVisibility = visibility;
        return this;
    }

    groundHeight(data: Uint8Array): this {
        this._groundHeight = data;
        return this;
    }

    groundType(data: Uint8Array): this {
        this._groundType = data;
        return this;
    }

    mapSize(width: number, height: number): this {
        this._mapWidth = width;
        this._mapHeight = height;
        return this;
    }

    viewPoint(vp: IViewPoint): this {
        this._viewPoint = vp;
        return this;
    }

    /**
     * Build the immutable render context.
     * @throws Error if required fields (viewPoint) are not set
     */
    build(): IRenderContext {
        if (!this._viewPoint) {
            throw new Error('RenderContext requires viewPoint to be set');
        }

        const buildingStates = this._buildingStates;
        const buildingVisualStateGetter = this._buildingVisualStateGetter;

        return {
            entities: this._entities,
            unitStates: this._unitStates,
            resourceStates: this._resourceStates,
            buildingStates,
            getBuildingVisualState: buildingVisualStateGetter,
            selection: this._selection,
            placementPreview: this._placementPreview,
            alpha: this._alpha,
            layerVisibility: this._layerVisibility,
            groundHeight: this._groundHeight,
            groundType: this._groundType,
            mapWidth: this._mapWidth,
            mapHeight: this._mapHeight,
            viewPoint: this._viewPoint,
        };
    }
}

/**
 * Create a new RenderContext builder.
 */
export function createRenderContext(): RenderContextBuilder {
    return new RenderContextBuilder();
}
