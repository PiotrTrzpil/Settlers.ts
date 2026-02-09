# Lua Scripting Implementation Plan

This document provides a detailed implementation plan for adding Settlers 4-compatible Lua scripting to Settlers.ts.

## Table of Contents

1. [Overview](#overview)
2. [Interpreter Selection](#interpreter-selection)
3. [Architecture](#architecture)
4. [Implementation Phases](#implementation-phases)
5. [API Binding Layer](#api-binding-layer)
6. [Event System](#event-system)
7. [Script Loading](#script-loading)
8. [Security Considerations](#security-considerations)
9. [Testing Strategy](#testing-strategy)
10. [File Structure](#file-structure)

---

## Overview

### Goals

1. **API Compatibility**: Implement the S4 Lua API so existing map scripts work with minimal modification
2. **Clean Integration**: Fit naturally into the existing `GameLoop`/`TickSystem`/`EventBus` architecture
3. **Performance**: Minimize JS↔Lua boundary crossings; batch operations where possible
4. **Safety**: Sandbox scripts to prevent malicious code execution
5. **Developer Experience**: Provide clear error messages and debugging tools

### Lua Version Challenge

Settlers 4 uses **Lua 3.2** (1999), while modern JS interpreters support **Lua 5.x**.

**Strategy**: Use Lua 5.x interpreter with a **compatibility shim** that:
- Provides Lua 3.2-style global functions (`getn`, `strlen`, `tinsert`, etc.)
- Handles syntax differences in a preprocessor or warns about incompatibilities
- Documents migration path for script authors

---

## Interpreter Selection

### Options Comparison

| Interpreter | Lua Version | Performance | Size | Interop Cost | Notes |
|-------------|-------------|-------------|------|--------------|-------|
| [Wasmoon](https://github.com/ceifa/wasmoon) | 5.4 | Excellent | ~400KB | Medium | Real Lua VM via WASM |
| [Fengari](https://github.com/fengari-lua/fengari) | 5.3 | Good | ~150KB | Low | Pure JS implementation |
| [wasmoon-lua5.1](https://www.npmjs.com/package/wasmoon-lua5.1) | 5.1 | Excellent | ~350KB | Medium | Older Lua, closer to 3.2 |

### Recommendation: **Fengari**

**Rationale**:
1. **Lower interop cost** - We'll have heavy JS↔Lua traffic (entity queries, event callbacks)
2. **Smaller bundle** - Important for web deployment
3. **Pure JS** - Easier to debug, no WASM complexity
4. **Sufficient performance** - Script logic isn't CPU-intensive; game simulation runs in JS

If performance becomes an issue, Wasmoon can be swapped in later (same API shape).

### Installation

```bash
pnpm add fengari fengari-interop
```

---

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         Game                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  GameState  │  │  GameLoop   │  │       EventBus          │  │
│  │             │  │             │  │                         │  │
│  │  entities[] │  │  systems[]  │◄─┤  'building:placed'      │  │
│  │  movement   │  │             │  │  'unit:spawned'         │  │
│  │  ...        │  │             │  │  'script:event'  ◄──────┼──┤
│  └─────────────┘  └──────┬──────┘  └─────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │   LuaScriptSystem     │ (TickSystem)             │
│              │                       │                          │
│              │  ┌─────────────────┐  │                          │
│              │  │  LuaRuntime     │  │                          │
│              │  │  (Fengari VM)   │  │                          │
│              │  └────────┬────────┘  │                          │
│              │           │           │                          │
│              │  ┌────────▼────────┐  │                          │
│              │  │  API Bindings   │  │                          │
│              │  │  Game, Settlers │  │                          │
│              │  │  Buildings, ... │  │                          │
│              │  └─────────────────┘  │                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Integration Points

1. **GameLoop** - `LuaScriptSystem` registers as a `TickSystem`
2. **EventBus** - Script events emit through EventBus; Lua handlers receive them
3. **GameState** - API bindings read/write game state
4. **MapLoader** - Scripts loaded from map file or external `.txt` file

---

## Implementation Phases

### Phase 1: Core Runtime (Week 1)

**Goal**: Basic Lua execution with Game table

```
src/game/scripting/
├── index.ts                 # Public exports
├── lua-runtime.ts           # Fengari wrapper
├── lua-script-system.ts     # TickSystem implementation
└── api/
    └── game-api.ts          # Game.* functions
```

**Deliverables**:
- [ ] Fengari integration
- [ ] `LuaRuntime` class (create VM, execute code, call functions)
- [ ] `LuaScriptSystem` (registers with GameLoop)
- [ ] `Game` table with basic functions
- [ ] Unit tests for runtime

### Phase 2: Entity APIs (Week 2)

**Goal**: Settlers, Buildings, Vehicles tables

```
src/game/scripting/api/
├── settlers-api.ts          # Settlers.* functions
├── buildings-api.ts         # Buildings.* functions
├── vehicles-api.ts          # Vehicles.* functions
└── goods-api.ts             # Goods.* constants
```

**Deliverables**:
- [ ] `Settlers.AddSettlers()`, `Settlers.Amount()`, etc.
- [ ] `Buildings.AddBuilding()`, `Buildings.Amount()`, etc.
- [ ] Type enums exposed to Lua
- [ ] Integration tests with GameState

### Phase 3: Event System (Week 3)

**Goal**: Full event registration and dispatch

```
src/game/scripting/
├── event-dispatcher.ts      # Events.* registration
└── api/
    └── events-api.ts        # Event constants
```

**Deliverables**:
- [ ] `Events.TICK()`, `Events.VICTORY_CONDITION_CHECK()`, etc.
- [ ] Bridge EventBus → Lua callbacks
- [ ] `new_game()` / `register_functions()` lifecycle

### Phase 4: Advanced APIs (Week 4)

**Goal**: AI, Magic, Map, Debug tables

```
src/game/scripting/api/
├── ai-api.ts
├── magic-api.ts
├── map-api.ts
├── debug-api.ts
└── tutorial-api.ts
```

**Deliverables**:
- [ ] AI squad control
- [ ] Map queries (Width, Height, PointIsOnScreen)
- [ ] Debug output (`dbg.stm()`)
- [ ] Tutorial system (if implementing tutorials)

### Phase 5: Script Loading & Compatibility (Week 5)

**Goal**: Load scripts from maps, Lua 3.2 compatibility

```
src/game/scripting/
├── script-loader.ts         # Load from map/file
├── compat/
│   ├── lua32-shim.lua       # Compatibility functions
│   └── preprocessor.ts      # Syntax adaptation (optional)
```

**Deliverables**:
- [ ] Load scripts from MapQuestText chunk
- [ ] Load scripts from external files
- [ ] Lua 3.2 compatibility shim
- [ ] Test with original S4 scripts

---

## API Binding Layer

### Binding Strategy

Use **Fengari-interop** to expose TypeScript functions to Lua:

```typescript
// src/game/scripting/api/game-api.ts
import { luaopen_base } from 'fengari-interop';
import { lua, lauxlib, lualib } from 'fengari';

export function registerGameAPI(L: lua.State, gameState: GameState): void {
    // Create Game table
    lua.lua_newtable(L);

    // Game.Time()
    lua.lua_pushcfunction(L, (L) => {
        lua.lua_pushnumber(L, gameState.gameTime);
        return 1;
    });
    lua.lua_setfield(L, -2, 'Time');

    // Game.LocalPlayer()
    lua.lua_pushcfunction(L, (L) => {
        lua.lua_pushinteger(L, gameState.localPlayer);
        return 1;
    });
    lua.lua_setfield(L, -2, 'LocalPlayer');

    // Game.PlayerWon(player)
    lua.lua_pushcfunction(L, (L) => {
        const player = lauxlib.luaL_checkinteger(L, 1);
        gameState.setPlayerWon(player);
        return 0;
    });
    lua.lua_setfield(L, -2, 'PlayerWon');

    // ... more functions

    // Set as global
    lua.lua_setglobal(L, 'Game');
}
```

### Type Mapping

| Lua Type | TypeScript Type | Notes |
|----------|-----------------|-------|
| `number` | `number` | Integers and floats |
| `string` | `string` | UTF-8 strings |
| `boolean` | `boolean` | |
| `nil` | `undefined` | |
| `table` | `object` / `Map` | Convert as needed |
| `function` | `(...args) => any` | Wrapped callbacks |

### Enum Exposure

Expose S4 enums as Lua table constants:

```typescript
// src/game/scripting/api/settlers-api.ts
function registerSettlerTypes(L: lua.State): void {
    lua.lua_newtable(L);

    // Map UnitType enum values
    lua.lua_pushinteger(L, UnitType.Carrier);
    lua.lua_setfield(L, -2, 'CARRIER');

    lua.lua_pushinteger(L, UnitType.Digger);
    lua.lua_setfield(L, -2, 'DIGGER');

    lua.lua_pushinteger(L, UnitType.Builder);
    lua.lua_setfield(L, -2, 'BUILDER');

    // ... all 66 settler types

    lua.lua_setglobal(L, 'Settlers');
}
```

---

## Event System

### Event Registration

Scripts register callbacks via `Events.EVENTNAME(handler)`:

```typescript
// src/game/scripting/event-dispatcher.ts
export class LuaEventDispatcher {
    private handlers: Map<string, number[]> = new Map(); // event -> Lua function refs
    private L: lua.State;

    registerHandler(eventName: string, luaFuncRef: number): void {
        if (!this.handlers.has(eventName)) {
            this.handlers.set(eventName, []);
        }
        this.handlers.get(eventName)!.push(luaFuncRef);
    }

    dispatch(eventName: string, ...args: any[]): void {
        const refs = this.handlers.get(eventName);
        if (!refs) return;

        for (const ref of refs) {
            // Push function from registry
            lua.lua_rawgeti(this.L, lua.LUA_REGISTRYINDEX, ref);

            // Push arguments
            for (const arg of args) {
                this.pushValue(arg);
            }

            // Call with error handling
            if (lua.lua_pcall(this.L, args.length, 0, 0) !== lua.LUA_OK) {
                const error = lua.lua_tostring(this.L, -1);
                console.error(`Lua event error [${eventName}]:`, error);
                lua.lua_pop(this.L, 1);
            }
        }
    }
}
```

### Event Exposure

```typescript
// src/game/scripting/api/events-api.ts
export function registerEventsAPI(L: lua.State, dispatcher: LuaEventDispatcher): void {
    lua.lua_newtable(L);

    // Events.TICK(handler)
    lua.lua_pushcfunction(L, (L) => {
        lauxlib.luaL_checktype(L, 1, lua.LUA_TFUNCTION);
        const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
        dispatcher.registerHandler('TICK', ref);
        return 0;
    });
    lua.lua_setfield(L, -2, 'TICK');

    // Events.VICTORY_CONDITION_CHECK(handler)
    lua.lua_pushcfunction(L, (L) => {
        lauxlib.luaL_checktype(L, 1, lua.LUA_TFUNCTION);
        const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
        dispatcher.registerHandler('VICTORY_CONDITION_CHECK', ref);
        return 0;
    });
    lua.lua_setfield(L, -2, 'VICTORY_CONDITION_CHECK');

    // ... all 21 event types

    lua.lua_setglobal(L, 'Events');
}
```

### Bridge to EventBus

Connect game events to Lua dispatcher:

```typescript
// src/game/scripting/lua-script-system.ts
export class LuaScriptSystem implements TickSystem {
    private dispatcher: LuaEventDispatcher;
    private tickCounter = 0;

    constructor(gameState: GameState, eventBus: EventBus) {
        // Bridge EventBus events to Lua
        eventBus.on('building:placed', (payload) => {
            this.dispatcher.dispatch('DRAG_BUILDING',
                payload.player, payload.buildingType, payload.x, payload.y);
        });

        eventBus.on('unit:spawned', (payload) => {
            this.dispatcher.dispatch('SETTLER_CHANGE_TYPE',
                payload.player, payload.unitType);
        });
    }

    tick(dt: number): void {
        // Dispatch TICK event
        this.dispatcher.dispatch('TICK');

        // Every 5 ticks, dispatch FIVE_TICKS
        this.tickCounter++;
        if (this.tickCounter % 5 === 0) {
            this.dispatcher.dispatch('FIVE_TICKS');
        }

        // Periodic victory check (every ~30 ticks)
        if (this.tickCounter % 30 === 0) {
            this.dispatcher.dispatch('VICTORY_CONDITION_CHECK');
        }
    }
}
```

---

## Script Loading

### From Map File

Scripts may be embedded in map chunks:

```typescript
// src/game/scripting/script-loader.ts
import { MapChunkType } from '@/resources/map/original/map-chunk-type';

export class ScriptLoader {
    /**
     * Load script from map file (embedded in MapQuestText or similar chunk)
     */
    loadFromMap(mapLoader: IMapLoader): string | null {
        // Try to get script chunk
        const origMap = mapLoader as unknown as OriginalMapFile;
        if (typeof origMap.getChunkReader !== 'function') {
            return null;
        }

        // MapQuestText (11) or dedicated script chunk
        const reader = origMap.getChunkReader(MapChunkType.MapQuestText);
        if (!reader || reader.length === 0) {
            return null;
        }

        // Script is stored as null-terminated string
        return reader.readNullString();
    }

    /**
     * Load script from external file
     */
    async loadFromFile(fileManager: FileManager, mapName: string): Promise<string | null> {
        const scriptPath = `Script/${mapName}.txt`;
        const file = await fileManager.getFile(scriptPath);
        if (!file) return null;

        const data = await file.readText();
        return data;
    }
}
```

### Script Initialization

```typescript
// src/game/scripting/lua-runtime.ts
export class LuaRuntime {
    private L: lua.State;

    /**
     * Load and initialize a map script
     */
    loadScript(source: string): void {
        // Load the script
        if (lauxlib.luaL_loadstring(this.L, source) !== lua.LUA_OK) {
            throw new Error(`Lua parse error: ${lua.lua_tostring(this.L, -1)}`);
        }

        // Execute to define functions
        if (lua.lua_pcall(this.L, 0, 0, 0) !== lua.LUA_OK) {
            throw new Error(`Lua execution error: ${lua.lua_tostring(this.L, -1)}`);
        }

        // Call new_game() if it exists
        lua.lua_getglobal(this.L, 'new_game');
        if (lua.lua_isfunction(this.L, -1)) {
            if (lua.lua_pcall(this.L, 0, 0, 0) !== lua.LUA_OK) {
                throw new Error(`Error in new_game(): ${lua.lua_tostring(this.L, -1)}`);
            }
        } else {
            lua.lua_pop(this.L, 1);
        }
    }
}
```

---

## Security Considerations

### Sandbox Configuration

Disable dangerous Lua functions:

```typescript
// src/game/scripting/lua-runtime.ts
function createSandboxedVM(): lua.State {
    const L = lauxlib.luaL_newstate();

    // Load only safe libraries
    lualib.luaL_openlibs(L);

    // Remove dangerous functions
    const dangerous = [
        'os',           // File system, process control
        'io',           // File I/O
        'loadfile',     // Load arbitrary files
        'dofile',       // Execute arbitrary files
        'load',         // Load arbitrary code (keep loadstring for compat)
        'package',      // Module loading
        'debug',        // Debug library (not dbg)
    ];

    for (const name of dangerous) {
        lua.lua_pushnil(L);
        lua.lua_setglobal(L, name);
    }

    return L;
}
```

### Resource Limits

Prevent infinite loops and memory exhaustion:

```typescript
// src/game/scripting/lua-runtime.ts
const MAX_INSTRUCTIONS = 1_000_000;
const MAX_MEMORY_MB = 16;

function setupResourceLimits(L: lua.State): void {
    let instructionCount = 0;

    // Instruction count hook
    lua.lua_sethook(L, (L, ar) => {
        instructionCount++;
        if (instructionCount > MAX_INSTRUCTIONS) {
            lauxlib.luaL_error(L, 'Script exceeded maximum instruction count');
        }
    }, lua.LUA_MASKCOUNT, 10000);

    // Note: Memory limits require custom allocator in Fengari
    // For now, rely on browser memory limits
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// tests/unit/scripting/lua-runtime.spec.ts
describe('LuaRuntime', () => {
    it('should execute basic Lua code', () => {
        const runtime = new LuaRuntime();
        const result = runtime.eval('return 1 + 2');
        expect(result).toBe(3);
    });

    it('should expose Game.Time()', () => {
        const gameState = new GameState();
        gameState.gameTime = 1000;
        const runtime = new LuaRuntime(gameState);

        const result = runtime.eval('return Game.Time()');
        expect(result).toBe(1000);
    });

    it('should handle script errors gracefully', () => {
        const runtime = new LuaRuntime();
        expect(() => runtime.eval('invalid syntax !!!')).toThrow();
    });
});
```

### Integration Tests

```typescript
// tests/unit/scripting/settlers-api.spec.ts
describe('Settlers API', () => {
    it('should count settlers by type', () => {
        const gameState = new GameState();
        gameState.addEntity(EntityType.Unit, UnitType.Carrier, 10, 10, 1);
        gameState.addEntity(EntityType.Unit, UnitType.Carrier, 12, 12, 1);
        gameState.addEntity(EntityType.Unit, UnitType.Builder, 14, 14, 1);

        const runtime = new LuaRuntime(gameState);
        const carriers = runtime.eval('return Settlers.Amount(1, Settlers.CARRIER)');
        expect(carriers).toBe(2);
    });

    it('should add settlers via script', () => {
        const gameState = new GameState();
        const runtime = new LuaRuntime(gameState);

        runtime.eval('Settlers.AddSettlers(50, 50, 1, Settlers.CARRIER, 5)');

        const carriers = gameState.entities.filter(
            e => e.type === EntityType.Unit && e.subType === UnitType.Carrier
        );
        expect(carriers.length).toBe(5);
    });
});
```

### Compatibility Tests

Test with actual S4 scripts (from History Edition):

```typescript
// tests/unit/scripting/s4-compat.spec.ts
describe('S4 Script Compatibility', () => {
    it('should run Tutorial01 without errors', async () => {
        const scriptSource = await loadTestScript('Tutorial01.txt');
        const runtime = new LuaRuntime(gameState);

        expect(() => runtime.loadScript(scriptSource)).not.toThrow();
    });
});
```

---

## File Structure

```
src/game/scripting/
├── index.ts                      # Public exports
├── lua-runtime.ts                # Fengari VM wrapper
├── lua-script-system.ts          # TickSystem implementation
├── script-loader.ts              # Load scripts from map/file
├── event-dispatcher.ts           # Lua event registration/dispatch
│
├── api/                          # API bindings
│   ├── index.ts                  # Register all APIs
│   ├── game-api.ts               # Game.* functions
│   ├── settlers-api.ts           # Settlers.* functions
│   ├── buildings-api.ts          # Buildings.* functions
│   ├── vehicles-api.ts           # Vehicles.* functions
│   ├── goods-api.ts              # Goods.* constants
│   ├── events-api.ts             # Events.* registration
│   ├── ai-api.ts                 # AI.* functions
│   ├── magic-api.ts              # Magic.* functions
│   ├── map-api.ts                # Map.* functions
│   ├── debug-api.ts              # dbg.* functions
│   ├── tutorial-api.ts           # Tutorial.* functions
│   └── effects-api.ts            # Effects.* constants
│
├── compat/                       # Lua 3.2 compatibility
│   ├── lua32-shim.lua            # Polyfills for old functions
│   └── preprocessor.ts           # Optional syntax adaptation
│
└── types/                        # TypeScript types
    └── fengari.d.ts              # Fengari type declarations
```

---

## API Implementation Priority

### P0 - MVP (Required for basic scripts)

| Table | Functions |
|-------|-----------|
| `Game` | `Time()`, `LocalPlayer()`, `NumberOfPlayers()`, `PlayerWon()`, `PlayerLost()` |
| `Settlers` | `AddSettlers()`, `Amount()`, `AmountInArea()` + all type constants |
| `Buildings` | `AddBuilding()`, `Amount()`, `ExistsBuildingInArea()` + all type constants |
| `Events` | `TICK()`, `FIRST_TICK_OF_NEW_GAME()`, `VICTORY_CONDITION_CHECK()` |
| `dbg` | `stm()` (show text message) |

### P1 - Full Campaign Support

| Table | Functions |
|-------|-----------|
| `Game` | `Random()`, `ShowClock()`, `IsAreaOwned()`, `GetDifficulty()` |
| `Settlers` | `Kill()` |
| `Buildings` | `CrushBuilding()` |
| `Vehicles` | `AddVehicle()`, `Amount()` |
| `Goods` | All constants |
| `Events` | `DRAG_BUILDING()`, `CRUSH_BUILDING()`, `WARRIOR_SENT()`, `PRODUCTION()` |
| `Map` | `Width()`, `Height()`, `SetScreenPos()` |
| `AI` | `NewSquad()`, `AttackNow()`, `DeactivateAllPlayerAIs()` |

### P2 - Complete API

| Table | Functions |
|-------|-----------|
| `Magic` | All spell functions |
| `Tutorial` | All tutorial functions |
| `Effects` | All effect constants |
| `Sounds` | All sound constants |
| `Events` | Remaining events |

---

## Example: Complete Script Flow

```lua
-- Example mission script (compatible with our implementation)

gObjective1Complete = 0
gObjective2Complete = 0

function new_game()
    register_functions()
    dbg.stm("Welcome! Build 3 woodcutter huts and recruit 20 carriers to win.")
end

function register_functions()
    Events.TICK(on_tick)
    Events.DRAG_BUILDING(on_building_placed)
    Events.VICTORY_CONDITION_CHECK(check_victory)
end

function on_tick()
    -- Update UI or periodic checks
end

function on_building_placed(player, buildingType, x, y)
    if player == 1 and buildingType == Buildings.WOODCUTTERHUT then
        local count = Buildings.Amount(1, Buildings.WOODCUTTERHUT, Buildings.STANDARD)
        if count >= 3 and gObjective1Complete == 0 then
            gObjective1Complete = 1
            dbg.stm("Objective 1 complete! Now recruit 20 carriers.")
        end
    end
end

function check_victory()
    local carriers = Settlers.Amount(1, Settlers.CARRIER)

    if carriers >= 20 and gObjective2Complete == 0 then
        gObjective2Complete = 1
        dbg.stm("Objective 2 complete!")
    end

    if gObjective1Complete == 1 and gObjective2Complete == 1 then
        dbg.stm("Victory! You've built a thriving settlement!")
        Game.PlayerWon(1)
    end
end
```

---

## References

- [Fengari Documentation](https://fengari.io/)
- [Fengari GitHub](https://github.com/fengari-lua/fengari)
- [Wasmoon GitHub](https://github.com/ceifa/wasmoon)
- [Settlers 4 Lua API Documentation](https://docs.settlers-united.com/s4-lua-api-de)
- [Original S4 Scripts](https://github.com/PaweX/Settlers_IV_Map_Scripts)
- [Lua 5.3 Reference Manual](https://www.lua.org/manual/5.3/)
- [Lua 3.2 Reference Manual](https://www.lua.org/manual/3.2/)
