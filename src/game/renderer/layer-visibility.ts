/**
 * Layer visibility system for controlling which entity types are rendered.
 * Supports hierarchical layers with sub-layers for environment objects.
 * Persists settings to localStorage.
 */

import { MapObjectType } from '../entity';

// ============================================================================
// Layer Types
// ============================================================================

/** Top-level rendering layers */
export enum RenderLayer {
    Buildings = 'buildings',
    Units = 'units',
    Environment = 'environment',
    Resources = 'resources',
}

/** Sub-layers within the Environment layer */
export enum EnvironmentSubLayer {
    Trees = 'trees',
    Stones = 'stones',
    Plants = 'plants',
    Other = 'other',
}

// ============================================================================
// Layer Visibility State
// ============================================================================

/** Visibility state for environment sub-layers */
export interface EnvironmentLayerVisibility {
    trees: boolean;
    stones: boolean;
    plants: boolean;
    other: boolean;
}

/** Complete layer visibility state */
export interface LayerVisibility {
    buildings: boolean;
    units: boolean;
    environment: boolean;
    resources: boolean;
    /** Sub-layer visibility (only applies when environment is true) */
    environmentLayers: EnvironmentLayerVisibility;
}

/** Default layer visibility (all visible) */
export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
    buildings: true,
    units: true,
    environment: true,
    resources: true,
    environmentLayers: {
        trees: true,
        stones: true,
        plants: true,
        other: true,
    },
};

// ============================================================================
// MapObjectType to Sub-Layer Mapping
// ============================================================================

/** Map MapObjectType to its environment sub-layer category */
export function getEnvironmentSubLayer(objectType: MapObjectType): EnvironmentSubLayer {
    // Trees
    if (objectType >= 0 && objectType <= 18) { // S4_TREE_ENUM range
        return EnvironmentSubLayer.Trees;
    }

    // Other types (Stones, plants) to be re-added once S4ModApi mapping is verified
    return EnvironmentSubLayer.Other;
}

/** Check if a MapObjectType is a resource deposit */
export function isResourceDeposit(_objectType: MapObjectType): boolean {
    return false; // No resource deposits mapped currently
}

// ============================================================================
// Layer Visibility Checks
// ============================================================================

/** Check if a specific environment sub-layer is visible */
export function isEnvironmentSubLayerVisible(
    visibility: LayerVisibility,
    subLayer: EnvironmentSubLayer
): boolean {
    if (!visibility.environment) return false;
    return visibility.environmentLayers[subLayer];
}

/** Check if a specific MapObjectType should be visible */
export function isMapObjectVisible(
    visibility: LayerVisibility,
    objectType: MapObjectType
): boolean {
    // Resource deposits are controlled by the Resources layer
    if (isResourceDeposit(objectType)) {
        return visibility.resources;
    }

    // Other map objects use the Environment layer and sub-layers
    if (!visibility.environment) return false;

    const subLayer = getEnvironmentSubLayer(objectType);
    return visibility.environmentLayers[subLayer];
}

// ============================================================================
// localStorage Persistence
// ============================================================================

const STORAGE_KEY = 'settlers_layer_visibility';

/** Save layer visibility to localStorage */
export function saveLayerVisibility(visibility: LayerVisibility): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
    } catch (e) {
        // localStorage might be unavailable (e.g., private browsing)
        console.warn('Failed to save layer visibility to localStorage:', e);
    }
}

/** Load layer visibility from localStorage, or return defaults */
export function loadLayerVisibility(): LayerVisibility {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return { ...DEFAULT_LAYER_VISIBILITY };

        const parsed = JSON.parse(stored) as Partial<LayerVisibility>;

        // Merge with defaults to handle missing fields from older saves
        return {
            buildings: parsed.buildings ?? DEFAULT_LAYER_VISIBILITY.buildings,
            units: parsed.units ?? DEFAULT_LAYER_VISIBILITY.units,
            environment: parsed.environment ?? DEFAULT_LAYER_VISIBILITY.environment,
            resources: parsed.resources ?? DEFAULT_LAYER_VISIBILITY.resources,
            environmentLayers: {
                trees: parsed.environmentLayers?.trees ?? DEFAULT_LAYER_VISIBILITY.environmentLayers.trees,
                stones: parsed.environmentLayers?.stones ?? DEFAULT_LAYER_VISIBILITY.environmentLayers.stones,
                plants: parsed.environmentLayers?.plants ?? DEFAULT_LAYER_VISIBILITY.environmentLayers.plants,
                other: parsed.environmentLayers?.other ?? DEFAULT_LAYER_VISIBILITY.environmentLayers.other,
            },
        };
    } catch (e) {
        console.warn('Failed to load layer visibility from localStorage:', e);
        return { ...DEFAULT_LAYER_VISIBILITY };
    }
}

/** Create a reactive layer visibility object that auto-saves on changes */
export function createLayerVisibility(): LayerVisibility {
    return loadLayerVisibility();
}

// ============================================================================
// Fallback Colors for Entities Without Textures
// ============================================================================

/** Colors for rendering entities as colored dots when textures are unavailable.
 * Colors chosen to be visible against typical bright green grass backgrounds. */
export const FALLBACK_ENTITY_COLORS: Record<string, [number, number, number, number]> = {
    // Buildings - will use player color, this is just a fallback shape indicator
    building_default: [0.6, 0.5, 0.3, 1.0], // Brown

    // Units - will use player color
    unit_default: [0.8, 0.7, 0.5, 1.0], // Light tan

    // Trees - dark browns and olive tones to contrast with grass
    tree_pine: [0.2, 0.35, 0.15, 1.0], // Dark forest green-brown
    tree_oak: [0.35, 0.3, 0.15, 1.0], // Brown-olive
    tree_birch: [0.8, 0.75, 0.65, 1.0], // Light birch bark (white-ish)
    tree_palm: [0.5, 0.4, 0.25, 1.0], // Tropical brown
    tree_cypress: [0.15, 0.25, 0.2, 1.0], // Dark blue-green
    tree_dead: [0.5, 0.35, 0.2, 1.0], // Brown-gray

    // Stones - neutral grays with slight blue tint for visibility
    stone_small: [0.55, 0.55, 0.6, 1.0], // Light blue-gray
    stone_medium: [0.5, 0.5, 0.55, 1.0], // Medium blue-gray
    stone_large: [0.45, 0.45, 0.5, 1.0], // Dark blue-gray

    // Resource deposits - bright saturated colors
    deposit_iron: [0.7, 0.3, 0.2, 1.0], // Rust red
    deposit_gold: [1.0, 0.85, 0.0, 1.0], // Bright gold
    deposit_coal: [0.2, 0.2, 0.25, 1.0], // Dark charcoal with blue tint
    deposit_stone: [0.6, 0.6, 0.65, 1.0], // Light gray
    deposit_sulfur: [1.0, 0.95, 0.2, 1.0], // Bright yellow
    deposit_gems: [0.6, 0.2, 0.8, 1.0], // Bright purple

    // Plants - warm/distinct colors to contrast with grass
    plant_bush: [0.4, 0.35, 0.2, 1.0], // Olive brown (contrasts with bright green)
    plant_mushroom: [0.85, 0.6, 0.5, 1.0], // Warm tan/orange
    plant_flowers: [1.0, 0.4, 0.6, 1.0], // Bright pink
    plant_corn: [1.0, 0.9, 0.3, 1.0], // Bright yellow
    plant_wheat: [0.95, 0.8, 0.35, 1.0], // Golden wheat

    // Other - distinct brown tones
    stump: [0.55, 0.35, 0.15, 1.0], // Dark wood
    fallen_tree: [0.6, 0.4, 0.2, 1.0], // Medium wood
    pile: [0.65, 0.5, 0.3, 1.0], // Light wood
};

const DEFAULT_FALLBACK_COLOR: [number, number, number, number] = [0.5, 0.5, 0.5, 1.0];

/** Lookup table mapping MapObjectType to fallback colors */
const MAP_OBJECT_COLOR_LOOKUP: Partial<Record<MapObjectType, [number, number, number, number]>> = {
    // Trees
    [MapObjectType.TreePine]: FALLBACK_ENTITY_COLORS.tree_pine,
    [MapObjectType.TreeOak]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeBirch]: FALLBACK_ENTITY_COLORS.tree_birch,
    // [MapObjectType.TreePalm]: FALLBACK_ENTITY_COLORS.tree_palm, // Duplicate of TreeCoconut (10)
    // [MapObjectType.TreeCypress]: FALLBACK_ENTITY_COLORS.tree_cypress, // Duplicate of TreeFir (8)
    [MapObjectType.TreeDead]: FALLBACK_ENTITY_COLORS.tree_dead,
    // Add missing S4 trees if needed, mapping to generic colors
    [MapObjectType.TreeBeech]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeAsh]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeLinden]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreePoplar]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeChestnut]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeMaple]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeFir]: FALLBACK_ENTITY_COLORS.tree_pine,
    [MapObjectType.TreeSpruce]: FALLBACK_ENTITY_COLORS.tree_pine,
    [MapObjectType.TreeCoconut]: FALLBACK_ENTITY_COLORS.tree_palm,
    [MapObjectType.TreeDate]: FALLBACK_ENTITY_COLORS.tree_palm,
    [MapObjectType.TreeWalnut]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeCorkOak]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreePine2]: FALLBACK_ENTITY_COLORS.tree_pine,
    [MapObjectType.TreeOliveLarge]: FALLBACK_ENTITY_COLORS.tree_deciduous,
    [MapObjectType.TreeOliveSmall]: FALLBACK_ENTITY_COLORS.tree_deciduous,
};

/** Get fallback color for a MapObjectType */
export function getMapObjectFallbackColor(objectType: MapObjectType): [number, number, number, number] {
    return MAP_OBJECT_COLOR_LOOKUP[objectType] ?? DEFAULT_FALLBACK_COLOR;
}

/** Size multiplier for different object types (for dot rendering) */
export function getMapObjectDotScale(objectType: MapObjectType): number {
    // Trees are taller
    if (objectType >= 0 && objectType <= 18) {
        return 0.35;
    }

    // Default
    return 0.2;
}
