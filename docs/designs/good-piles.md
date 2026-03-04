Pile System Architecture Review                                                     
                                                                                      
  Overview of what's actually in place                                              

  The system has three logical layers:
  - BuildingInventoryManager — abstract material counts per building slot
  - InventoryVisualizer / MaterialStackState — maps slot changes → StackedResource
  entity lifecycle
  - BuildingPileRegistry / InventoryLayout — resolves tile positions from XML pile
  data

  The three pile categories you listed map to:
  - Building piles (production/storage) — fully implemented, well-structured
  - Construction piles — largely unimplemented as visuals
  - Free piles — implicit (entities with buildingId === undefined), no explicit model

  ---
  Issue 1 (Critical) — Construction delivery has no visual piles

  inventory-layout.ts:74 has this comment and return null:
  // No pile defined (e.g. construction materials delivered to a production building).
  // Return null so the visualizer skips creating a visual stack entity.

  resolveStackPosition tries two paths:
  1. getPilePositionForSlot(bt, race, 'input', material) — production XML input piles
  2. hasStoragePiles(bt, race) — only true for StorageArea

  A building like WoodcutterHut under construction takes LOG + BOARD inputs. Its
  production XML has only an output pile for LOG. Neither path matches BOARD as a
  construction input → position is null → no visual pile is ever created for delivered
   construction materials.

  Carriers walk to the building door, deposit into the construction inventory, and the
   materials are tracked in the abstract inventory — but there's nothing on the map.
  This directly violates requirement #2. The pile system needs a third path in
  resolveStackPosition: construction-specific positions (around the flag/door of the
  site).

  ---
  Issue 2 (Major) — Inventory swap on completion is silent and doesn't clean
  MaterialStackState

  In game-services.ts:547-548:
  this.inventoryManager.removeInventory(entityId); // no onChange event
  this.inventoryManager.createInventory(entityId, buildingType); // starts at 0

  removeInventory just does this.inventories.delete(buildingId) with no event.
  MaterialStackState is never told the swap happened. The buildingVisuals map still
  holds the old BuildingVisualState for that building.

  When the first production deposit fires onChange, getOrCreate(buildingId) returns
  the old state with stale inputStacks entries from construction. Those entries never
  get cleaned up. In practice issue #1 means construction inputStacks are empty, so no
   visible corruption occurs — but structurally, after every building completion, the
  state object is reused from construction with whatever dangled. If #1 were fixed,
  this would immediately cause visual ghosts.

  Fix: the visualizer should listen to building:completed and call
  removeBuilding(entityId) before the swap (clearing MaterialStackState), then
  reinitialize after.

  ---
  Issue 3 (Major) — findAvailablePosition blocks storage positions with any entity

  inventory-layout.ts:96:
  const occupant = this.gameState.getEntityAt(pos.x, pos.y);
  if (!occupant) return pos;

  getEntityAt is the tile occupancy map — it returns any entity at a tile: unit,
  settler, carrier, tree, stone, etc. A carrier standing on a StorageArea pile
  position while making a pickup temporarily blocks that position from being used for
  new stacks. More severely, if a Unit entity happens to share a storage tile
  (passable during construction), the position is permanently skipped.

  The check should filter to only EntityType.StackedResource entities (and
  cross-reference against usedPositions already in visualState), not any entity type.

  ---
  Issue 4 (Major) — Free piles have no explicit model or lifecycle

  "Free piles" are defined only by the absence of buildingId:
  if (state?.buildingId !== undefined) continue; // skip reserved

  There is no way to distinguish:
  - A pile created by a worker placing resources directly (a "true" free pile)
  - A pile that became free because its building was destroyed

  This matters for two reasons:
  1. No creation path for truly free piles — there is no spawn_free_pile command path.
   The only way to make a free pile is via building destruction. If a gatherer
  produces output that should go directly to a ground pile (original S4 behavior for
  some workers), the system can't model it without routing through a building
  inventory first.
  2. No way to query free pile origin — diagnostic/AI queries can't distinguish
  orphaned piles (which should be priority-collected) from fresh output piles.

  ---
  Issue 5 (Moderate) — StorageArea: 8 visual positions for 30+ material types

  DROPPABLE_MATERIALS has 30+ entries. The StorageArea XML has 8 storage pile
  positions. findAvailablePosition returns null when all 8 are occupied, silently
  suppressing the visual. This means a busy StorageArea holding 9+ distinct material
  types will have some materials with no map representation.

  No warning is surfaced to the user. The inventory works correctly (abstract counts
  are accurate), but the visual contract breaks — the requirement that piles are
  "actual objects on map" is violated for overflow materials in storage.

  ---
  Issue 6 (Moderate) — removeInventory is registered as a late-cleanup handler AND
  called explicitly on completion

  From game-services.ts:420-423:
  this.cleanupRegistry.onEntityRemoved(
      this.inventoryManager.removeInventory.bind(this.inventoryManager),
      CLEANUP_PRIORITY.LATE
  );

  And from onBuildingCompleted:547:
  this.inventoryManager.removeInventory(entityId); // called explicitly

  When a building completes construction, removeInventory is called twice: once
  explicitly in onBuildingCompleted, and once later in the entity cleanup registry's
  LATE priority handler if the building entity is re-removed. The second call does
  nothing (Map.delete on missing key), so it's harmless — but the intent is unclear.
  The first call is the "inventory swap"; the second is the "entity removal cleanup".
  These are different operations with the same method.

  This is a naming/contract confusion: the same removeInventory serves both "swap on
  completion" and "cleanup on destruction".

  ---
  Issue 7 (Moderate) — rebuildFromExistingEntities classifies stacks by production
  inventory, breaks during construction

  material-stack-state.ts:173-184:
  const isOutput = inventory.outputSlots.some(s => s.materialType === materialType);
  const isInput  = inventory.inputSlots.some(s => s.materialType === materialType);

  This uses the current inventory to classify entities. During construction phase, the
   inventory has only input slots (construction materials). After HMR
  mid-construction, a LOG entity with buildingId set would be checked against the
  construction inventory (which has LOG as input) → correctly mapped to inputStacks.
  But if rebuildFromExistingEntities is called after building completion (when
  inventory is production), a LOG entity remaining from construction would be checked
  against the production inventory — which for a woodcutter has LOG as output. The
  entity would be misclassified as an output stack, potentially preventing a new
  output entity from being created at that position.

  This is an edge case but it documents a gap in the rebuild logic: it doesn't account
   for the construction-to-production phase transition.

  ---
  Issue 8 (Minor) — Pile quantity capped in two places independently

  InventoryVisualizer:135:
  const visualQuantity = Math.min(quantity, MAX_RESOURCE_STACK_SIZE);

  StackedResourceManager.setQuantity:30:
  state.quantity = Math.min(quantity, MAX_RESOURCE_STACK_SIZE);

  Double-capping is harmless but the contract is inconsistent: who is responsible for
  enforcing the cap? If the visualizer sends quantity=9, the manager silently caps it
  at 8. The cap should be enforced in one place with the other trusting the contract.

  ---
  Summary table

  ┌─────┬──────────┬───────────────────────────────────────────────────────────────┐
  │  #  │ Severity │                             Issue                             │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 1   │ Critical │ Construction delivery materials have no visual piles —        │
  │     │          │ resolveStackPosition returns null                             │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 2   │ Major    │ Inventory swap on completion doesn't clear MaterialStackState │
  │     │          │  — stale state reuse                                          │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 3   │ Major    │ findAvailablePosition uses getEntityAt (any entity type)      │
  │     │          │ instead of filtering to StackedResources                      │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 4   │ Major    │ Free piles have no explicit model — no creation path outside  │
  │     │          │ building destruction                                          │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 5   │ Moderate │ StorageArea: 8 visual positions for 30+ material types —      │
  │     │          │ overflow materials are invisibly stockpiled                   │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 6   │ Moderate │ removeInventory called twice on building completion (explicit │
  │     │          │  + cleanup registry) — confusing contract                     │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 7   │ Moderate │ rebuildFromExistingEntities misclassifies entities when       │
  │     │          │ inventory has changed phase since entity creation             │
  ├─────┼──────────┼───────────────────────────────────────────────────────────────┤
  │ 8   │ Minor    │ Quantity cap enforced in both InventoryVisualizer and         │
  │     │          │ StackedResourceManager independently                          │
  └─────┴──────────┴───────────────────────────────────────────────────────────────┘

  The biggest architectural gap is #1 — construction sites are the only pile category
  with a completely missing visual. Issues #2 and #3 would need to be fixed alongside
  #1 to make construction piles work correctly. Issue #4 is the conceptual gap about
  free piles that may be intentional but limits future scenarios (direct worker
  output, map-defined resource deposits).

✻ Worked for 5m 29s                                       

❯ but i asked you about arhcitecurla issues, not bugs                                 
                                                      
⏺ Fair point. Let me focus on the structural design problems, not bugs.               
                                                                                    
  ---                                                                                 
  Pile System — Architectural Issues
                                                                                      
  1. No unified pile-type model: three categories share one entity type with no     
  discriminator                                                                     

  All three pile kinds are EntityType.StackedResource. The only distinction is a
  nullable buildingId flag in a separate state object (StackedResourceManager.states).
   This flag collapses two independent concerns:

  - Ownership / accounting: "this pile is the visual for building X's slot"
  - Logistics access: "this pile cannot be freely picked up by carriers"

  For production building piles, both concerns align. But they don't have to. A
  construction pile should be owned by the construction site (for position,
  accounting, and cleanup) but accessible by the builder workers at the site. A free
  pile has neither. The current single-flag model cannot express these distinctions —
  so the system works around it by having no visual piles at all during construction.

  The downstream effect: findNearestResource, resolveTransportPos, and
  updateVisualStack all branch on buildingId !== undefined without any sense of which
  kind of pile they're dealing with.

  ---
  2. Inventory is the source of truth but piles are what physically exists on the map

  The current data flow is:

  BuildingInventoryManager (abstract counts)
    → onChange event
      → InventoryVisualizer
        → resolveStackPosition
          → spawn_visual_resource entity (the pile)

  The pile is a derivative of the inventory. This is architecturally backward relative
   to the requirement. In the original game (and your stated requirement), piles are
  physical objects on the map that persist independently. The inventory of a building
  is what you get by counting what's in its associated piles. When a building is
  destroyed, piles survive because they're primary — not because something explicitly
  unlinks them.

  In the current model, when a building is destroyed, removeBuilding manually iterates
   stacks and sets buildingId = undefined. The survival of piles is a side effect of
  this cleanup, not a structural property.

  The consequence is that inventory and pile quantity must be kept in sync manually.
  They're the same information stored in two places (slot.currentAmount and
  StackedResourceState.quantity), with the visualizer serving as the synchronization
  layer. Any desync (missed event, failed spawn, HMR) requires
  rebuildFromExistingEntities to reconcile them.

  ---
  3. Construction phase exists in inventory-space but not in map-space

  Construction has a complete inventory model: getConstructionInventoryConfig,
  constructionSiteManager, constructionRequestSystem, onBuildingCompleted swapping
  inventories. But there is no spatial model for construction piles — no pile
  positions, no entities, nothing on the map.

  InventoryLayout.resolveStackPosition has exactly two code paths: material-specific
  XML positions (production buildings) and shared-pool positions (storage).
  Construction is handled by the implicit third path: fall through to return null. The
   comment confirms this is intentional: "No pile defined (e.g. construction materials
   delivered to a production building)."

  This means the pile system fundamentally cannot express pile category #2 from your
  requirement as currently structured. Adding construction pile support requires a new
   code path in InventoryLayout, new position data (the XML has nothing for
  construction staging), and a new way to distinguish construction-phase from
  production-phase when a building entity exists in both states sequentially.

  ---
  4. InventoryLayout has no extension point: it's a closed if/else over pile
  categories

  // 1. Exact material match (production buildings)
  const pos = this.pileRegistry.getPilePositionForSlot(...);
  if (pos) return pos;

  // 2. Storage buildings: shared pool of XML-defined positions
  if (this.pileRegistry.hasStoragePiles(...)) { ... }

  // No pile defined
  return null;

  This is an open-coded categorical dispatch. Each new pile category (construction
  site, map-defined free pile, barracks weapon rack, etc.) requires modifying this
  method and the surrounding registry. The layout doesn't know the reason it's being
  asked to place a stack — it only knows building type, material, and slot direction.
  The phase of the building (under construction vs. producing) is invisible to it.

  ---
  5. MaterialStackState is a secondary index over two separate data sources

  MaterialStackState maps (buildingId, material, slotType) → entityId. This
  information is not stored on the entity itself, nor in the inventory slot — it lives
   only in this index. If the index is lost (HMR, future persistence),
  rebuildFromExistingEntities reconstructs it by joining entity state against
  inventory slots. This works, but the reconstruction logic encodes assumptions about
  which pile belongs to which slot that the rest of the system doesn't formally
  express.

  The structural issue: the relationship "entity E is the visual pile for building B's
   output slot of material M" is real domain knowledge, but it's stored as a derived,
  reconstructable index rather than as an explicit association. This makes the
  three-way join (entity, inventory, visual state) the cognitive center of the system
  without being architecturally named.

  ---
  6. The StorageArea pile model is a special case sewn into a general mechanism

  StorageArea gets a different code path in InventoryLayout (pool allocation vs.
  material-specific lookup) and a different treatment in BuildingPileRegistry
  (storagePositions vs. slots). But this distinction isn't expressed in any
  abstraction — it's a runtime check: if (this.pileRegistry.hasStoragePiles(bt,
  race)).

  The StorageArea constraint — 8 physical positions for 30+ material slots — means the
   "pile per inventory slot" contract that the rest of the system assumes cannot hold
  for storage. The workaround (first-unoccupied, silent null when full) is pragmatic,
  but it means StorageArea breaks the requirement that all piles are actual map
  objects. It's not treated as a fundamentally different pile model, just as a
  building type with a special registry bucket.

  ---
  Summary

  The root architectural tension is that the system was designed around production
  building piles, with construction piles and free piles retrofitted implicitly rather
   than designed as first-class pile categories. Coherently supporting all three as
  "actual objects on the map that survive building destruction" requires:

  1. A pile-type taxonomy expressed in the entity or its state (not just
  presence/absence of buildingId)
  2. Spatial models for all three categories (not just XML production positions)
  3. InventoryLayout or an equivalent to be extensible over pile categories, not a
  closed categorical dispatch
  4. Either piles as the source of truth (inventory as derived sum of pile quantities)
   or an explicit, named association between pile entity and inventory slot — not a
  reconstructable secondary index







  Thinking from first principles, there are really three orthogonal axes:             
                                                                                    
  ---                                                                                 
  Axis 1: Ownership (the most fundamental)
                                                                                      
  Linked — the pile mirrors exactly one building's inventory slot. Its quantity is  
  driven by that slot. If the building dies, it converts to Free.                   

  Free — no building. Quantity is self-contained. Persists until physically depleted.

  Everything else follows from this.

  ---
  Axis 2: Producer / Consumer (who puts in, who takes out)

  This determines flow direction, not just "input/output from the building's
  perspective":

  ┌─────────────────────┬─────────────────────┬─────────────────────────┐
  │      Producer       │      Consumer       │        Pile role        │
  ├─────────────────────┼─────────────────────┼─────────────────────────┤
  │ Building system     │ Logistics (carrier) │ production output       │
  ├─────────────────────┼─────────────────────┼─────────────────────────┤
  │ Logistics (carrier) │ Building system     │ production input        │
  ├─────────────────────┼─────────────────────┼─────────────────────────┤
  │ Logistics (carrier) │ Construction worker │ construction            │
  ├─────────────────────┼─────────────────────┼─────────────────────────┤
  │ Logistics           │ Logistics           │ storage (bidirectional) │
  ├─────────────────────┼─────────────────────┼─────────────────────────┤
  │ —                   │ Logistics           │ free (self-sovereign)   │
  └─────────────────────┴─────────────────────┴─────────────────────────┘

  input/output in the current code conflates the building's perspective with the flow
  direction. Construction is the case that doesn't fit — a carrier delivers (which
  looks like "input") but the consumer is a builder, not the production system, and
  the pile needs different spatial and access semantics.

  ---
  Axis 3: Position authority (who decides where the tile is)

  Material-specific fixed — XML says "LOG output is always at this offset from this
  building type." One pile per material, immovable.

  Pool-allocated — a set of positions is shared; first available wins. The pile can
  hold any material. (StorageArea)

  Site-staged — computed near the construction flag/door; not in XML, not
  material-specific.

  Positionally inherited — the pile is wherever it ended up. Free piles after building
   destruction keep their last position.

  ---
  The resulting taxonomy

  Combining axes 1 and 2 gives the natural categories:

  Pile
  ├── Linked
  │   ├── Output        (building → carrier)        fixed position
  │   ├── Input         (carrier → building)         fixed position
  │   ├── Construction  (carrier → builder)          site-staged position
  │   └── Storage       (carrier ↔ carrier)          pool-allocated position
  └── Free              (→ carrier)                  inherited position

  ---
  What's NOT a fundamental dimension

  - Material type — every pile holds exactly one material type, always. Not a category
   distinction.
  - Quantity — a property, not a category.
  - Race / building type — these affect which positions and which materials, not the
  pile's structural role.
  - The visual stack size cap (8) — an implementation constraint, not a category.

  ---
  The key insight

  The current slotType: 'input' | 'output' is a binary that almost works but collapses
   two different things: storage (which is bidirectional, not cleanly input or output)
   and construction (which is "input from logistics but consumed by a different actor
  than the production system"). Both are currently special-cased in the code rather
  than being first-class categories.
