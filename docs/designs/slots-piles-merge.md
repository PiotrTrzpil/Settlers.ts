 Refactor: Merge Slots and Piles                                          
                                                                           
  New Model                                                                
                                                                  
  PileSlot {                                                               
      material: EMaterialType       // what it holds (or NO_MATERIAL)      
      currentAmount: number         // 0..maxCapacity                      
      maxCapacity: number           // 8 (SLOT_CAPACITY)                   
      position: { x, y }           // world position (resolved at creation)
      entityId: number | null       // pile entity (created when amount >  
  0, removed when 0)                                                       
      kind: PileKind                //                                     
  output/input/construction/storage/free                                   
  }                                                                        
                                                                           
  A building's inventory = Map<slotId, PileSlot>. No separate arrays, no
  flat index encoding, no sync layer.

  What gets removed

  ┌──────────────────────┬───────────┬─────────────────────────────────┐
  │      Component       │   Lines   │               Why               │
  ├──────────────────────┼───────────┼─────────────────────────────────┤
  │ InventoryPileSync    │ ~290      │ Sync layer gone — slot IS the   │
  │                      │           │ pile                            │
  ├──────────────────────┼───────────┼─────────────────────────────────┤
  │ PileRegistry         │ ~180      │ Merged into inventory — slot    │
  │                      │           │ holds entityId and position     │
  ├──────────────────────┼───────────┼─────────────────────────────────┤
  │ PileSlotKey          │ ~60       │ Slots have stable IDs, no need  │
  │ serialization        │           │ to serialize keys               │
  ├──────────────────────┼───────────┼─────────────────────────────────┤
  │ Flat index           │ scattered │ depositAt(buildingId,           │
  │ encoding/decoding    │           │ slotIndex) → depositAt(slotId)  │
  ├──────────────────────┼───────────┼─────────────────────────────────┤
  │ onChange callback    │ ~40       │ No external sync needed —       │
  │ chain                │           │ entity spawn/update is internal │
  └──────────────────────┴───────────┴─────────────────────────────────┘

  What changes

  BuildingInventoryManager → simplified:
  - deposit(slotId, amount) — updates amount, spawns/updates pile entity
  inline
  - withdraw(slotId, amount) — updates amount, removes pile entity at 0
  - findSlot(buildingId, material, kind) — finds slot with space
  - getSlots(buildingId) — all slots for a building
  - No more input/output split — kind distinguishes purpose

  Transport jobs reference slotId (stable identifier) instead of flat array
   index:
  - No stale index after swapInventoryPhase (#6 solved)
  - Carrier walks to slot.position directly (no TransportPositionResolver
  indirection)

  StorageArea slot claiming moves to TransportJobService.activate():
  - Demand says "building needs LOG" (slot-agnostic)
  - Job creation calls findSlot(buildingId, LOG, 'storage') → claims free
  slot if needed
  - Cancellation releases empty claimed slot (one place, clear ownership) —
   #4 solved

  Construction → Operational transition (swapInventoryPhase):
  - Destroys construction PileSlots (removes entities if quantity > 0)
  - Creates operational PileSlots with fresh positions
  - In-flight jobs with old slotIds get cancelled (rare, cheap) — #6 solved

  Free piles: already match the model — a PileSlot with kind: 'free', no
  building link.

  What stays the same

  - InventoryConfig / getInventoryConfig() — still defines what slots a
  building type has
  - PilePositionResolver — still resolves positions from building type +
  material + kind
  - StackedPileManager (GameState.piles) — still tracks pile entity state
  for renderer
  - Transport job lifecycle (Reserved → PickedUp → Delivered)
  - DemandQueue, LogisticsDispatcher, CarrierAssigner — mostly unchanged

  Migration path

  1. Create PileSlot type and new inventory manager — new file, doesn't
  touch old code
  2. Migrate transport layer — slotIndex → slotId in TransportJobRecord,
  TransportJobBuilder, executors
  3. Migrate demand layer — remove slotIndex from DemandEntry (already
  planned)
  4. Migrate callers — deposit/withdraw by slotId instead of material-type
  lookup
  5. Delete old layers — InventoryPileSync, PileRegistry, old
  BuildingInventoryManager
  6. Fix withdrawOutput multi-slot (#5) — withdraw(buildingId, material)
  drains from last slot first

  Risk areas

  - swapInventoryPhase — the construction→operational transition touches
  the most moving parts. Need integration tests covering in-flight
  deliveries during completion.
  - Save/load — slot IDs must be stable across serialize/deserialize.
  Entity IDs are already stable, so slotId can derive from them or be
  assigned at creation.
  - Free pile creation — FreePileHandler currently creates a fake inventory
   for free piles. In the new model, a free pile IS a PileSlot directly —
  simpler but needs the handler rewritten.

  Scope

  Medium-large. ~800 lines removed, ~400 new. The core change is conceptual
   (slot = pile), and most callers get simpler. The transport layer
  slotIndex→slotId migration touches the most files but is mechanical.

  Key Files (current → action)

  REMOVE:
  - src/game/features/inventory/inventory-pile-sync.ts — sync layer
  - src/game/systems/inventory/pile-registry.ts — slot→entity mapping

  REWRITE:
  - src/game/systems/inventory/building-inventory.ts — BuildingInventoryManager
    Current: separate inputSlots[]/outputSlots[] arrays, flat index encoding,
    onChange callbacks. Methods: depositInput/Output, withdrawInput/Output,
    depositAt(flatIndex), getInputSlots, getOutputSlots, swapInventoryPhase,
    createInventory, destroyBuildingInventory, setSlotMaterial.
    New: Map<slotId, PileSlot> per building, deposit(slotId)/withdraw(slotId),
    findSlot(buildingId, material, kind), entity spawn/remove inline.

  MODIFY (slotIndex → slotId):
  - src/game/features/logistics/transport-job-store.ts — TransportJobRecord.slotIndex → slotId
  - src/game/features/logistics/transport-job-service.ts — activate() does slot claiming here
  - src/game/features/logistics/transport-job-builder.ts — reads slot.position directly
  - src/game/features/logistics/demand-queue.ts — remove slotIndex from DemandEntry
  - src/game/features/material-requests/material-request-system.ts — already slot-agnostic
  - src/game/features/building-construction/internal/construction-executors.ts — withdraw by slotId
  - src/game/commands/handlers/system-handlers.ts — set_storage_filter uses new API

  MODIFY (deposit/withdraw call sites):
  - src/game/features/logistics/internal/material-transfer.ts — pickUp/deposit use new API
  - src/game/features/settler-tasks/transport-executors.ts — depositAt(slotId) not flatIndex
  - src/game/features/building-construction/building-lifecycle-handler.ts — createInventory, swapPhase
  - src/game/features/inventory/free-pile-handler.ts — free pile = PileSlot with kind:'free'
  - src/game/systems/inventory/storage-filter-manager.ts — slot release uses new API

  KEEP (no changes needed):
  - src/game/features/inventory/inventory-config.ts — defines slot layout per building type
  - src/game/features/inventory/pile-position-resolver.ts — resolves world positions
  - src/game/core/pile-kind.ts — PileKind types
  - src/game/systems/inventory/stacked-pile-manager.ts — renderer-facing pile state

  Subsystem Boundaries for Parallel Work

  1. PileSlot type + new BuildingInventoryManager (core, no deps on old code)
  2. DemandQueue (remove slotIndex) + MaterialRequestSystem (already done)
  3. TransportJobRecord/Store/Service (slotIndex → slotId, slot claiming in activate)
  4. TransportJobBuilder + transport executors (use slot.position, deposit by slotId)
  5. BuildingLifecycleHandler + construction executors (create/swap inventory)
  6. FreePileHandler rewrite (free pile = PileSlot)
  7. Command handlers (set_storage_filter, spawn_pile)
  8. Delete old files (InventoryPileSync, PileRegistry, old building-inventory.ts)

  Dependencies: 1 must complete first (shared types). 2-7 can parallel against
  the new API. 8 is cleanup after all others.