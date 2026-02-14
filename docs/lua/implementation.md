# Lua Scripting

Settlers 4-compatible Lua scripting for map scripts and game logic.

## Current Implementation

Uses **Wasmoon** (Lua 5.4 via WASM) with a Lua 3.2 compatibility shim.

### File Structure

```
src/game/scripting/
├── index.ts              # Public exports
├── lua-runtime.ts        # Wasmoon VM wrapper
├── lua-script-system.ts  # TickSystem integration
├── script-loader.ts      # Load from map/file
├── script-service.ts     # High-level service
├── event-dispatcher.ts   # Event registration/dispatch
├── lua-compat.ts         # Lua 3.2 compatibility shim
├── api/
│   ├── game-api.ts       # Game.Time(), PlayerWon(), etc.
│   ├── settlers-api.ts   # Settlers.AddSettlers(), Amount(), etc.
│   ├── buildings-api.ts  # Buildings.AddBuilding(), Amount(), etc.
│   ├── goods-api.ts      # Goods.Amount(), AddGoods(), etc.
│   ├── map-api.ts        # Map.Width(), Height(), GetHeight(), etc.
│   ├── ai-api.ts         # AI.SetMode(), Enable(), SendSquad(), etc.
│   └── debug-api.ts      # Debug.Log(), Warn(), Error()
└── types/
    └── fengari.d.ts      # Type declarations
```

### Implemented APIs

| Table | Functions |
|-------|-----------|
| `Game` | Time, LocalPlayer, NumberOfPlayers, PlayerWon, PlayerLost, Random, ShowClock, IsAreaOwned, PlayerRace, MapWidth, MapHeight |
| `Settlers` | AddSettlers, Amount, AmountInArea, Kill, MoveTo, GetPosition, IsAlive, GetType, GetPlayer |
| `Buildings` | AddBuilding, AddBuildingEx, CrushBuilding, Amount, ExistsBuildingInArea, GetState, IsComplete, GetPosition, GetType, GetPlayer |
| `Goods` | Amount, AddGoods, RemoveGoods, GetStackAt, AddPileEx |
| `Map` | Width, Height, GetHeight, SetHeight, GetTerrainType, GetResourceAt, IsPointValid, IsWalkable, IsBuildable, GetOwner, FlattenGround |
| `AI` | SetMode, GetMode, Enable, IsEnabled, SetAttackTarget, SetDefendPosition, SetPriority, SendSquad, SetPlayerVar |
| `Debug` | Log, Warn, Error |

### Implemented Events

All S4 events are registered: TICK, FIVE_TICKS, VICTORY_CONDITION_CHECK, DRAG_BUILDING, CRUSH_BUILDING, WARRIOR_SENT, PRODUCTION, GOODARRIVE, etc.

---

## Remaining Work

### Missing APIs

| Table | Status | Notes |
|-------|--------|-------|
| `Vehicles` | Not implemented | AddVehicle, Amount, etc. |
| `Magic` | Not implemented | Spell casting functions |
| `Tutorial` | Not implemented | Tutorial system functions |
| `Effects` | Not implemented | Visual/sound effect constants |

### Other TODOs

- Test with more original S4 map scripts
- Add remaining S4 type constants (some settler/building types may be missing)
- Improve error messages for script debugging

---

## References

- [Settlers 4 Lua API Documentation](https://docs.settlers-united.com/s4-lua-api-de)
- [Wasmoon GitHub](https://github.com/ceifa/wasmoon)
- [Lua 5.4 Reference Manual](https://www.lua.org/manual/5.4/)
