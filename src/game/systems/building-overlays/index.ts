/**
 * Building Overlays System
 *
 * General-purpose system for rendering multiple layered sprites per building.
 * Handles both custom attachments (smoke, spinning wheels, status effects)
 * and structural overlays (construction background behind a rising building).
 *
 * Each building type can declare multiple overlays — independently animated
 * sprite layers drawn at configurable offsets and render layers relative
 * to the building sprite. Each overlay supports optional vertical clipping
 * (verticalProgress) for construction-style rising effects.
 *
 * ## Construction overlay migration
 *
 * The existing hardcoded construction rendering in entity-renderer.ts
 * (backgroundSprite + verticalProgress) can be migrated to use this system.
 * The BuildingOverlayRenderData.verticalProgress field exists for this purpose:
 * during CompletedRising, emit the construction sprite as an overlay with
 * verticalProgress=1.0 and the completed sprite with verticalProgress=<rising>.
 *
 * External code should only import from this file.
 *
 * Public API:
 * - Types: BuildingOverlayDef, BuildingOverlayInstance, OverlaySpriteRef
 * - Enums: OverlayLayer, OverlayCondition
 * - Registry: OverlayRegistry (static definitions per building type)
 * - Manager: BuildingOverlayManager (runtime state, animation ticking)
 * - Helpers: getOverlayFrame
 */

// Types
export type { BuildingOverlayDef, BuildingOverlayInstance, OverlaySpriteRef } from './types';
export { OverlayLayer, OverlayCondition, getOverlayFrame } from './types';

// Registry
export { OverlayRegistry } from './overlay-registry';

// Manager
export { BuildingOverlayManager, type BuildingOverlayManagerConfig } from './building-overlay-manager';

// Data loader
export { populateOverlayRegistry } from './overlay-data-loader';
