Inventory → System                                       
                                                                     
  What Inventory Currently Is                                        
                                                                     
  - 2 features: InventoryFeature (core state) +                      
  InventoryPileSyncFeature (visual pile entities)                   
  - 0 feature dependencies on the core feature — it's already
  self-contained                                                     
  - 9 dependents import from it — it's infrastructure, not a feature 
  - The feature registration gives it: EventBus bridging,            
  persistence, and dependency injection via                          
  ctx.getFeature('inventory')                                        
                                                                     
  What Would Change                                                  
                                                                     
  Core inventory (BuildingInventoryManager, PileRegistry,            
  StorageFilterManager) → system                                     
  - Move to src/game/systems/inventory/                              
  - Instantiated directly in game-services.ts and passed as          
  constructor args (like MovementSystem, PathFinding)                
  - Persistence registered manually (already just a persistKey +
  serialize/deserialize)
  - EventBus bridging wired manually in game-services

  Pile sync stays as a feature — it has real dependencies
  (building-construction) and lifecycle (event
  registration/disposal). Or it could move to building-construction
  since it's tightly coupled there.

  Migration Steps

  1. Move files: src/game/features/inventory/ →
  src/game/systems/inventory/ (except inventory-feature.ts,
  inventory-pile-sync-feature.ts, inventory-pile-sync.ts)
  2. In game-services.ts: Create BuildingInventoryManager,
  PileRegistry, StorageFilterManager directly instead of through
  feature registry. Wire the onChange → eventBus.emit bridge
  manually.
  3. Update all 9 dependents: Change
  ctx.getFeature<InventoryExports>('inventory') → accept
  inventoryManager as a constructor param or from context directly.
  4. Pile sync: Either keep as a small feature that receives
  inventoryManager from context, or fold into building-construction.
  5. Update imports: All from '…/features/inventory' → from
  '…/systems/inventory'. Mass sd replacement.

  Impact

  ┌───────────────┬─────────────────────────────┬────────────────┐
  │    Aspect     │           Before            │     After      │
  ├───────────────┼─────────────────────────────┼────────────────┤
  │ Instantiation │ Feature registry,           │ Direct in      │
  │               │ dependency-ordered          │ game-services  │
  ├───────────────┼─────────────────────────────┼────────────────┤
  │ Access        │ ctx.getFeature('inventory') │ Constructor    │
  │ pattern       │                             │ injection      │
  ├───────────────┼─────────────────────────────┼────────────────┤
  │               │                             │ Manual         │
  │ Persistence   │ Auto via feature            │ registration   │
  │               │                             │ (trivial)      │
  ├───────────────┼─────────────────────────────┼────────────────┤
  │ Files moved   │ —                           │ ~10 files      │
  ├───────────────┼─────────────────────────────┼────────────────┤
  │ Import        │ —                           │ ~15-20 files   │
  │ changes       │                             │                │
  ├───────────────┼─────────────────────────────┼────────────────┤
  │               │                             │ Low — no logic │
  │ Risk          │ Low                         │  changes, just │
  │               │                             │  wiring        │
  └───────────────┴─────────────────────────────┴────────────────┘
