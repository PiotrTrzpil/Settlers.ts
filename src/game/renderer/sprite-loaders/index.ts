/**
 * Sprite Loaders Module
 *
 * Category-specific sprite loaders extracted from SpriteRenderManager.
 * Each loader handles a specific entity category and follows the same
 * context-passing pattern as sprite-unit-loader.
 *
 * @module renderer/sprite-loaders
 */

export { loadBuildingSprites, collectBuildingFileNumbers, type BuildingLoadContext } from './building-sprite-loader';
export { loadMapObjectSprites, type MapObjectsLoadContext } from './map-objects-sprite-loader';
export { loadResourceSprites, type ResourceLoadContext } from './resource-sprite-loader';
export { loadOverlaySprites, type OverlayLoadContext } from './overlay-sprite-loader';
