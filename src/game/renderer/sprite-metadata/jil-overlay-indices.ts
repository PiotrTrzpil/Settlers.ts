/**
 * Building overlay direction convention for GFX files.
 *
 * ## Direction index derivation
 *
 * In each race's building GFX file, a building job stores its sprite data across
 * multiple DIL "directions":
 *
 * The DIL reader's `getItems()` returns a **compacted** array that skips null
 * entries. In the compacted array:
 *
 *   index 0  = constructed building sprite
 *   index 1  = shadow / construction-phase sprite
 *   index 2+ = overlay animations (smoke, fire, animals, doors, etc.)
 *
 * Only patches with a `<job>` name in the XML occupy a real DIL direction; jobless
 * patches correspond to null DIL slots and are skipped by compaction. The compacted
 * direction index for a patch overlay is:
 *
 *   `directionIndex = OVERLAY_DIRECTION_BASE + overlayIndex`
 *
 * where `overlayIndex` counts only patches that have a job name (0-based).
 *
 * Critically, each race defines its own set of patches per building in
 * buildingInfo.xml. A building may have 4 patches for Trojan but only 1 for Viking.
 * The GFX file for each race stores directions only for that race's patches, so
 * the direction index for the same overlay (e.g. SMELTGOLD_MELTED) differs across
 * races. The `slot` field in the XML is an internal engine identifier and does NOT
 * correspond to the direction index.
 *
 * See scripts/analyze-overlay-directions.ts for the analysis that confirmed this.
 */

/**
 * Base direction offset for overlay animations within a building job.
 * Directions 0 and 1 are reserved for the building sprite and shadow.
 */
export const OVERLAY_DIRECTION_BASE = 2;
