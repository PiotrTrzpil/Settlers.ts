/**
 * Sprite Loaders Module
 *
 * Category-specific sprite loaders extracted from SpriteRenderManager.
 * Each loader handles a specific entity category using the shared SpriteLoadContext.
 *
 * @module renderer/sprite-loaders
 */

export { loadGilManifest, loadGilSpriteBatch } from './gil-manifest-loader';
export { loadBuildingSprites, collectBuildingFileNumbers } from './building-sprite-loader';
export { loadMapObjectSprites } from './map-objects-sprite-loader';
export { loadResourceSprites } from './resource-sprite-loader';
export { loadOverlaySprites } from './overlay-sprite-loader';
