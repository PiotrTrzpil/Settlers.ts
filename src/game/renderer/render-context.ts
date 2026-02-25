/**
 * RenderContext Interface
 *
 * Decouples the renderer from game internals by providing a read-only view
 * of all data needed for rendering. The renderer imports ONLY from this file
 * (plus Layer 0 entity/economy types) — never from features, systems, or services.
 *
 * Feature-specific computation (e.g., building visual state, animation state)
 * happens in the composable/glue layer (use-renderer.ts) before entering the renderer.
 */

import type { Entity, StackedResourceState, TileCoord } from '../entity';
import type { Race } from '../race';
import type { AnimationState } from '../animation';
import type { IViewPoint } from './i-view-point';
import { DEFAULT_LAYER_VISIBILITY, type LayerVisibility } from './layer-visibility';

// ============================================================================
// Renderer-local types (no feature module imports)
// ============================================================================

/**
 * Supported placement entity types.
 * Renderer-local definition — mirrors input/render-state.PlacementEntityType.
 */
export type PlacementEntityType = 'building' | 'resource' | 'unit';

/**
 * Consolidated placement preview state for the renderer.
 */
export interface PlacementPreviewState {
    /** Tile position for the preview */
    tile: TileCoord;
    /** Whether placement is valid at this position */
    valid: boolean;
    /** Entity type being placed */
    entityType: PlacementEntityType;
    /** Specific subtype (BuildingType or EMaterialType as number) */
    subType: number;
    /** Race for the entity being placed. Optional — only for buildings/units. */
    race?: Race;
    /** Variation/direction for sprite rendering (0-7 for resources) */
    variation?: number;
}

/**
 * Renderer's view of a unit's movement state.
 * Structural subset of the full UnitStateView — no mapping needed.
 */
export interface UnitRenderState {
    readonly prevX: number;
    readonly prevY: number;
    readonly moveProgress: number;
    readonly path: ReadonlyArray<{ x: number; y: number }>;
    readonly pathIndex: number;
}

/**
 * Interface for looking up unit render states by entity ID.
 * Structurally compatible with GameState's UnitStateLookup.
 */
export interface UnitStateLookup {
    get(entityId: number): UnitRenderState | undefined;
}

/**
 * Renderer's view of a building's visual state.
 * Pre-computed in the glue layer from BuildingState + getBuildingVisualState.
 * The renderer never needs to know about BuildingConstructionPhase.
 */
export interface BuildingRenderState {
    /** Show construction sprite (true) or completed sprite (false) */
    useConstructionSprite: boolean;
    /** Vertical visibility progress (0.0 = hidden, 1.0 = fully visible) */
    verticalProgress: number;
    /** Whether to render the construction background (during completed-rising transition) */
    showConstructionBackground: boolean;
}

/** Default building render state for completed buildings */
const DEFAULT_BUILDING_RENDER_STATE: BuildingRenderState = {
    useConstructionSprite: false,
    verticalProgress: 1.0,
    showConstructionBackground: false,
};

/**
 * Subset of game settings relevant to rendering.
 */
export interface RenderSettings {
    showBuildingFootprint: boolean;
    disablePlayerTinting: boolean;
    antialias: boolean;
}

/**
 * Lightweight service area data for rendering (avoids importing full ServiceArea type).
 */
export interface ServiceAreaRenderData {
    centerX: number;
    centerY: number;
    radius: number;
}

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

    // === Building Visual State ===
    /** Get the pre-computed render state for a building entity */
    getBuildingRenderState(entityId: number): BuildingRenderState;

    // === Animation ===
    /** Get the animation state for an entity (null if no animation) */
    getAnimationState(entityId: number): AnimationState | null;

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
    /** Rendering-relevant game settings */
    readonly settings: RenderSettings;

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

    // === Service Areas ===
    /** Service areas to render for selected hub buildings */
    readonly selectedServiceAreas: readonly ServiceAreaRenderData[];
}

/**
 * Builder for creating IRenderContext instances.
 * Allows incremental construction with method chaining.
 */
export class RenderContextBuilder {
    private _entities: readonly Entity[] = [];
    private _unitStates: UnitStateLookup = { get: () => undefined };
    private _resourceStates: ReadonlyMap<number, StackedResourceState> = new Map();
    private _buildingRenderStateGetter: (entityId: number) => BuildingRenderState = () => DEFAULT_BUILDING_RENDER_STATE;
    private _animationStateGetter: (entityId: number) => AnimationState | null = () => null;
    private _selection: SelectionState = { primaryId: null, ids: new Set() };
    private _placementPreview: PlacementPreviewState | null = null;
    private _alpha = 0;
    private _layerVisibility: LayerVisibility = { ...DEFAULT_LAYER_VISIBILITY };
    private _settings: RenderSettings = { showBuildingFootprint: false, disablePlayerTinting: false, antialias: false };
    private _groundHeight: Uint8Array = new Uint8Array(0);
    private _groundType: Uint8Array = new Uint8Array(0);
    private _mapWidth = 0;
    private _mapHeight = 0;
    private _viewPoint: IViewPoint | null = null;
    private _selectedServiceAreas: readonly ServiceAreaRenderData[] = [];

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

    buildingRenderStateGetter(getter: (entityId: number) => BuildingRenderState): this {
        this._buildingRenderStateGetter = getter;
        return this;
    }

    animationStateGetter(getter: (entityId: number) => AnimationState | null): this {
        this._animationStateGetter = getter;
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

    settings(s: RenderSettings): this {
        this._settings = s;
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

    selectedServiceAreas(areas: readonly ServiceAreaRenderData[]): this {
        this._selectedServiceAreas = areas;
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

        return {
            entities: this._entities,
            unitStates: this._unitStates,
            resourceStates: this._resourceStates,
            getBuildingRenderState: this._buildingRenderStateGetter,
            getAnimationState: this._animationStateGetter,
            selection: this._selection,
            placementPreview: this._placementPreview,
            alpha: this._alpha,
            layerVisibility: this._layerVisibility,
            settings: this._settings,
            groundHeight: this._groundHeight,
            groundType: this._groundType,
            mapWidth: this._mapWidth,
            mapHeight: this._mapHeight,
            viewPoint: this._viewPoint,
            selectedServiceAreas: this._selectedServiceAreas,
        };
    }
}

/**
 * Create a new RenderContext builder.
 */
export function createRenderContext(): RenderContextBuilder {
    return new RenderContextBuilder();
}
