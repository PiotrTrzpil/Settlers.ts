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

import type { Entity, StackedPileState, TileCoord } from '../entity';
import type { Race } from '../core/race';
import type { EntityVisualState, DirectionTransition } from '../animation/entity-visual-service';
import type { IViewPoint } from './i-view-point';
import { DEFAULT_LAYER_VISIBILITY, type LayerVisibility } from './layer-visibility';
import type { SpriteEntry } from './sprite-metadata/sprite-metadata';

// ============================================================================
// Renderer-local types (no feature module imports)
// ============================================================================

/**
 * Supported placement entity types.
 * Renderer-local definition — mirrors input/render-state.PlacementEntityType.
 */
export type PlacementEntityType = 'building' | 'pile' | 'unit';

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
    /** Specific subtype (BuildingType or EMaterialType) */
    subType: number | string;
    /** Race for the entity being placed. Optional — only for buildings/units. */
    race?: Race;
    /** Variation/direction for sprite rendering (0-7 for resources) */
    variation?: number;
    /** Military unit level (1-3) for level-specific preview sprites */
    level?: number;
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
 * Pre-computed in the glue layer from ConstructionSite + getBuildingVisualState.
 * The renderer never needs to know about BuildingConstructionPhase.
 */
export interface BuildingRenderState {
    /** Show construction sprite (true) or completed sprite (false) */
    useConstructionSprite: boolean;
    /** Vertical visibility progress (0.0 = hidden, 1.0 = fully visible) */
    verticalProgress: number;
}

/** Default building render state for completed buildings */
const DEFAULT_BUILDING_RENDER_STATE: BuildingRenderState = {
    useConstructionSprite: false,
    verticalProgress: 1.0,
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
 * Territory boundary dot for rendering (avoids importing full TerritoryDot type).
 */
export interface TerritoryDotRenderData {
    readonly x: number;
    readonly y: number;
    readonly player: number;
    /** Fractional tile offset toward own territory at player borders. */
    readonly offsetX?: number;
    readonly offsetY?: number;
}

/**
 * Lightweight circle data for rendering overlays (work areas, etc.).
 */
export interface CircleRenderData {
    centerX: number;
    centerY: number;
    radius: number;
}

/**
 * Ghost resource stack for rendering semi-transparent resource sprites at a tile.
 * Used by the stack-adjust mode to preview where input/output resources will appear.
 */
export interface StackGhostRenderData {
    readonly x: number;
    readonly y: number;
    /** EMaterialType numeric value */
    readonly materialType: number;
    /** Number of resource sprites to draw (1-8) */
    readonly count: number;
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

// ============================================================================
// Building Overlay Render Data
// ============================================================================

/**
 * Render layer for a building overlay, relative to the parent building sprite.
 * Mirrors OverlayLayer from the feature module — renderer-local copy avoids
 * the renderer depending on feature-layer types.
 */
export enum OverlayRenderLayer {
    /** Behind the building sprite (ground effects, shadows) */
    BehindBuilding = 0,
    /** On top of the building — rendered in array order after the building sprite */
    AboveBuilding = 1,
}

/**
 * Pre-computed render data for a single building overlay.
 * Produced by the glue layer (use-renderer.ts) from overlay instance state.
 * The renderer just draws these — no animation or condition logic needed.
 *
 * Supports both custom overlays (smoke, wheels) and construction overlays
 * (construction background + rising completed sprite) via verticalProgress.
 */
export interface BuildingOverlayRenderData {
    /** The resolved sprite for the current animation frame */
    readonly sprite: SpriteEntry;
    /** World-space offset from the building's render anchor */
    readonly worldOffsetX: number;
    readonly worldOffsetY: number;
    /** Render layer relative to the building */
    readonly layer: OverlayRenderLayer;
    /** Whether this overlay uses player team coloring */
    readonly teamColored: boolean;
    /**
     * Vertical visibility progress (0.0 = hidden, 1.0 = fully visible).
     * Used for construction-style rising effects. Default 1.0.
     */
    readonly verticalProgress: number;
}

const EMPTY_OVERLAYS: readonly BuildingOverlayRenderData[] = [];

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
    readonly pileStates: ReadonlyMap<number, StackedPileState>;

    // === Building Visual State ===
    /** Get the pre-computed render state for a building entity */
    readonly getBuildingRenderState: (entityId: number) => BuildingRenderState;

    // === Building Overlays ===
    /** Get pre-computed overlay render data for a building (empty array if none) */
    readonly getBuildingOverlays: (entityId: number) => readonly BuildingOverlayRenderData[];

    // === Animation ===
    /** Get the visual state for an entity (undefined if not tracked) */
    readonly getVisualState: (entityId: number) => EntityVisualState | undefined;
    /** Get direction transition for a unit (undefined if not transitioning) */
    readonly getDirectionTransition: (entityId: number) => DirectionTransition | undefined;

    // === Combat ===
    /** Get health ratio (0-1) for a unit. Returns null if no health tracking (civilian units). */
    readonly getHealthRatio: (entityId: number) => number | null;

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

    // === Territory ===
    /** Territory boundary dots to render */
    readonly territoryDots: readonly TerritoryDotRenderData[];

    // === Work Areas ===
    /** Work area circles to render as line overlays (debug adjustment mode) */
    readonly workAreaCircles: readonly CircleRenderData[];
    /** Work area boundary dots to render as sprites (gameplay adjustment mode) */
    readonly workAreaDots: readonly TerritoryDotRenderData[];

    // === Stack Ghosts ===
    /** Ghost resource stacks to render during stack-adjust mode */
    readonly stackGhosts: readonly StackGhostRenderData[];
}

/**
 * Builder for creating IRenderContext instances.
 * Allows incremental construction with method chaining.
 */
export class RenderContextBuilder {
    private _entities: readonly Entity[] = [];
    private _unitStates: UnitStateLookup = { get: () => undefined };
    private _pileStates: ReadonlyMap<number, StackedPileState> = new Map();
    private _buildingRenderStateGetter: (entityId: number) => BuildingRenderState = () => DEFAULT_BUILDING_RENDER_STATE;
    private _buildingOverlaysGetter: (entityId: number) => readonly BuildingOverlayRenderData[] = () => EMPTY_OVERLAYS;
    private _visualStateGetter: (entityId: number) => EntityVisualState | undefined = () => undefined;
    private _directionTransitionGetter: (entityId: number) => DirectionTransition | undefined = () => undefined;
    private _healthRatioGetter: (entityId: number) => number | null = () => null;
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
    private _territoryDots: readonly TerritoryDotRenderData[] = [];
    private _workAreaCircles: readonly CircleRenderData[] = [];
    private _workAreaDots: readonly TerritoryDotRenderData[] = [];
    private _stackGhosts: readonly StackGhostRenderData[] = [];

    entities(entities: readonly Entity[]): this {
        this._entities = entities;
        return this;
    }

    unitStates(states: UnitStateLookup): this {
        this._unitStates = states;
        return this;
    }

    pileStates(states: ReadonlyMap<number, StackedPileState>): this {
        this._pileStates = states;
        return this;
    }

    buildingRenderStateGetter(getter: (entityId: number) => BuildingRenderState): this {
        this._buildingRenderStateGetter = getter;
        return this;
    }

    buildingOverlaysGetter(getter: (entityId: number) => readonly BuildingOverlayRenderData[]): this {
        this._buildingOverlaysGetter = getter;
        return this;
    }

    visualStateGetter(getter: (entityId: number) => EntityVisualState | undefined): this {
        this._visualStateGetter = getter;
        return this;
    }

    directionTransitionGetter(getter: (entityId: number) => DirectionTransition | undefined): this {
        this._directionTransitionGetter = getter;
        return this;
    }

    healthRatioGetter(getter: (entityId: number) => number | null): this {
        this._healthRatioGetter = getter;
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

    territoryDots(dots: readonly TerritoryDotRenderData[]): this {
        this._territoryDots = dots;
        return this;
    }

    workAreaCircles(circles: readonly CircleRenderData[]): this {
        this._workAreaCircles = circles;
        return this;
    }

    workAreaDots(dots: readonly TerritoryDotRenderData[]): this {
        this._workAreaDots = dots;
        return this;
    }

    stackGhosts(ghosts: readonly StackGhostRenderData[]): this {
        this._stackGhosts = ghosts;
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
            pileStates: this._pileStates,
            getBuildingRenderState: this._buildingRenderStateGetter,
            getBuildingOverlays: this._buildingOverlaysGetter,
            getVisualState: this._visualStateGetter,
            getDirectionTransition: this._directionTransitionGetter,
            getHealthRatio: this._healthRatioGetter,
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
            territoryDots: this._territoryDots,
            workAreaCircles: this._workAreaCircles,
            workAreaDots: this._workAreaDots,
            stackGhosts: this._stackGhosts,
        };
    }
}

/**
 * Create a new RenderContext builder.
 */
export function createRenderContext(): RenderContextBuilder {
    return new RenderContextBuilder();
}
