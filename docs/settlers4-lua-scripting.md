# Settlers 4 Lua Scripting System

This document details how Lua scripting works in The Settlers 4, including the original game implementation and community extensions.

## Overview

Settlers 4 includes a **built-in Lua scripting system** for map customization, mission logic, and tutorials. This is **original functionality** that shipped with the game - not a community addition. The community has since documented, extended, and created tools around this system.

### Key Points

- **Lua Version**: 3.2 (a legacy version from 1999)
- **Purpose**: Map scripting, mission objectives, AI behavior, tutorials
- **Integration**: Scripts can be embedded in .map files or loaded from external .txt files
- **Execution**: The game's Lua interpreter runs scripts during gameplay

## Script Storage Methods

### Method 1: External Text Files

Scripts are stored as `.txt` files in the game's `Script/` directory:
```
thesettlers4/Script/576_demo.txt
```

The filename must match the map name. The game automatically loads the script when the map is played.

### Method 2: Embedded in Map File

Using the **S4Editor+** tool (by MuffinMario), scripts can be embedded directly in the `.map` file. This eliminates the need to distribute separate files.

The script data is stored in the map file's chunk structure, likely in the `MapQuestText` (chunk type 11) or a dedicated script chunk.

## Script Structure

### Basic Template

```lua
-- Global state variables
gMyVariable = 0

-- Called when map starts
function new_game()
    -- Register event handlers
    register_functions()

    -- Initialize game state
    dbg.stm("Script loaded!")
end

-- Register event callbacks
function register_functions()
    Events.TICK(on_tick)
    Events.FIRST_TICK_OF_NEW_GAME(on_first_tick)
    Events.VICTORY_CONDITION_CHECK(check_victory)
end

-- Called every game tick
function on_tick()
    -- Game logic here
end

-- Check if player has won
function check_victory()
    if Settlers.Amount(1, Settlers.CARRIER) > 100 then
        Game.PlayerWon(1)
    end
end
```

### Entry Points

| Function | When Called |
|----------|-------------|
| `new_game()` | When map first loads |
| `register_functions()` | Called by `new_game()` to set up event handlers |

## Event System

Scripts respond to game events by registering callback functions. The game calls these functions when specific actions occur.

### Available Events

| Event | Description |
|-------|-------------|
| `Events.TICK` | Called every game tick (main game loop) |
| `Events.FIVE_TICKS` | Called every 5 ticks |
| `Events.FIRST_TICK_OF_NEW_GAME` | Called once when new game starts |
| `Events.FIRST_TICK_OF_NEW_OR_LOADED_GAME` | Called when game starts or loads |
| `Events.VICTORY_CONDITION_CHECK` | Periodic check for win/lose conditions |
| `Events.COMMAND` | Player issues a command |
| `Events.SPACE` | Player presses spacebar |
| `Events.DRAG_BUILDING` | Player places a building |
| `Events.CRUSH_BUILDING` | Building is destroyed |
| `Events.WARRIOR_SENT` | Military unit dispatched |
| `Events.MAGIC_SPELL_CAST` | Spell is cast |
| `Events.PRODUCTION` | Production cycle completes |
| `Events.GOODARRIVE` | Goods arrive at destination |
| `Events.SETTLER_CHANGE_TYPE` | Settler changes profession |
| `Events.MENUCLICK` | UI menu clicked |
| `Events.ZOOM_FACTOR_CHANGED` | Camera zoom changes |
| `Events.BUILD_PRIO` | Build priority changes |
| `Events.WORK_AREA` | Work area modified |
| `Events.WORK_STATUS` | Work status changes |
| `Events.SHOW_WORK_AREA` | Work area display toggled |
| `Events.CREATE_FOUNDATION_CART` | Foundation cart created |

### Event Registration

```lua
function register_functions()
    Events.TICK(my_tick_handler)
    Events.VICTORY_CONDITION_CHECK(my_victory_check)
    Events.DRAG_BUILDING(on_building_placed)
end
```

## API Reference

### Game Table

Core game state and utility functions.

```lua
-- Constants
Game.RACE_ROMAN      -- 0
Game.RACE_VIKING     -- 1
Game.RACE_MAYA       -- 2
Game.RACE_DARK       -- 3
Game.RACE_TROJAN     -- 4

-- Functions
Game.GetDifficulty()           -- Returns difficulty level
Game.LocalPlayer()             -- Returns local player ID
Game.NumberOfPlayers()         -- Returns total player count
Game.PlayerLost(player)        -- Mark player as defeated
Game.PlayerWon(player)         -- Mark player as victorious
Game.Time()                    -- Current game time
Game.ShowClock(time)           -- Display countdown timer
Game.Random(max)               -- Random number 0 to max-1
Game.IsAreaOwned(player, x, y, range)  -- Check area ownership
```

### Settlers Table

Settler/unit management.

```lua
-- Constants (partial list)
Settlers.CARRIER          -- 1
Settlers.DIGGER           -- 2
Settlers.BUILDER          -- 3
Settlers.WOODCUTTER       -- 4
Settlers.STONECUTTER      -- 5
Settlers.FORESTER         -- 6
Settlers.SWORDSMAN_01     -- Level 1 swordsman
Settlers.SWORDSMAN_02     -- Level 2 swordsman
Settlers.SWORDSMAN_03     -- Level 3 swordsman
Settlers.BOWMAN_01        -- Level 1 bowman
Settlers.BOWMAN_02        -- Level 2 bowman
Settlers.BOWMAN_03        -- Level 3 bowman
-- ... 66+ settler types total

-- Functions
Settlers.AddSettlers(x, y, player, type, amount)  -- Spawn settlers
Settlers.Amount(player, type)                      -- Count settlers
Settlers.AmountInArea(player, type, x, y, range)  -- Count in area
Settlers.Kill(id)                                  -- Kill settler
```

### Buildings Table

Building management.

```lua
-- Constants (partial list)
Buildings.WOODCUTTERHUT    -- 1
Buildings.FORESTERHUT      -- 2
Buildings.SAWMILL          -- 3
Buildings.STONECUTTERHUT   -- 4
Buildings.CASTLE           -- 48
Buildings.BARRACKS         -- 24
-- ... 82 building types total

-- Building states
Buildings.BUILD            -- Under construction
Buildings.STANDARD         -- Completed

-- Functions
Buildings.AddBuilding(x, y, player, type)           -- Create building
Buildings.CrushBuilding(id)                          -- Destroy building
Buildings.Amount(player, type, state)                -- Count buildings
Buildings.ExistsBuildingInArea(player, type, x, y, range)
```

### Vehicles Table

Vehicle management.

```lua
-- Constants
Vehicles.WARSHIP
Vehicles.FERRY
Vehicles.TRANSPORTSHIP
Vehicles.CART
Vehicles.WARMACHINE

-- Functions
Vehicles.AddVehicle(x, y, player, type, direction, charge, addToSquad)
Vehicles.Amount(player, type)
Vehicles.AmountInArea(player, type, x, y, range)
```

### Goods Table

Resource types.

```lua
Goods.WOOD           -- Logs
Goods.BOARD          -- Planks
Goods.STONE
Goods.COAL
Goods.IRONORE
Goods.IRONBAR
Goods.GOLDORE
Goods.GOLDBAR
Goods.BREAD
Goods.MEAT
Goods.FISH
Goods.FLOUR
Goods.GRAIN
Goods.WATER
Goods.SWORD
Goods.BOW
Goods.ARMOR
Goods.AXE
Goods.HAMMER
Goods.PICKAXE
-- ... 42 good types total
```

### Magic Table

Spell system.

```lua
-- Spell categories
Magic.SPELL_DIVINE_PRESENT
Magic.SPELL_CONVERT_GOOD
Magic.SPELL_TERRAIN
Magic.SPELL_DEFENSE
Magic.SPELL_ATTACK
Magic.SPELL_SOLDIER
Magic.SPELL_SPECIAL

-- Functions
Magic.CastSpell(...)
Magic.CurrentManaAmount(player)
Magic.IncreaseMana(player, amount)
Magic.DecreaseMana(player, amount)
```

### AI Table

AI control.

```lua
-- Difficulty levels
AI.DIFFICULTY_LEVEL_EASY
AI.DIFFICULTY_LEVEL_NORMAL
AI.DIFFICULTY_LEVEL_HARD

-- Attack modes
AI.ATTACK_MODE_AGGRESSIVE
AI.ATTACK_MODE_NORMAL
AI.ATTACK_MODE_DEFENSIVE
AI.ATTACK_MODE_DONT_ATTACK

-- Commands
AI.CMD_MOVE_AND_STAY
AI.CMD_MOVE_AND_VANISH
AI.CMD_MOVE_HOME
AI.CMD_SUICIDE_MISSION

-- Functions
AI.NewSquad(player, aiType, x, y)        -- Create AI squad
AI.AttackNow(fromPlayer, toPlayer, amt)  -- Order attack
AI.DeactivateAllPlayerAIs()              -- Disable all AI
AI.SetPlayerVar(player, "Var", n0, n1, n2)
```

### Map Table

Map/terrain functions.

```lua
Map.Height()                      -- Map height in tiles
Map.Width()                       -- Map width in tiles
Map.SetScreenPos(x, y)           -- Move camera
Map.PointIsOnScreen(x, y)        -- Check visibility
Map.AddDecoObject(x, y, obj)     -- Add decoration
Map.DeleteDecoObject(x, y, range, obj)
```

### Debug Table

Development utilities.

```lua
dbg.stm(message)                 -- Show text message (chat)
dbg.OutputDebugString(str)       -- Debug output
dbg.ActivateAI(player)           -- Enable AI
dbg.DeactivateAI(player)         -- Disable AI
```

### Tutorial Table

Tutorial system (used in tutorial missions).

```lua
Tutorial.ShowText(id)            -- Display tutorial text
Tutorial.SetMarker(x, y)         -- Place marker
Tutorial.ClearMarker()           -- Remove marker
Tutorial.SetWorldCursor(x, y)    -- Set cursor position
Tutorial.DeleteWorldCursor()     -- Remove cursor
Tutorial.DisableControls()       -- Lock player input
Tutorial.EnableAllControls()     -- Unlock input
Tutorial.DisableExcept(...)      -- Selective disable
Tutorial.EnableControls(...)     -- Selective enable
Tutorial.PressButton(id)         -- Simulate button press
Tutorial.SetZoom(level)          -- Set camera zoom
Tutorial.GetCurrentZoomFactor()  -- Get zoom level
Tutorial.SelectNextBuilding()    -- Select next building
Tutorial.Won()                   -- Mark tutorial complete
Tutorial.Exit()                  -- Exit tutorial mode
```

### Effects Table

Visual effects.

```lua
Effects.FLYINGARROWS
Effects.CRUSH_SMALL
Effects.CRUSH_MEDIUM
Effects.CRUSH_LARGE
Effects.SMOKE_SMALL
Effects.SMOKE_LARGE
Effects.MAGIC_CONVERT
Effects.MAGIC_FREEZE
-- ... 100+ effect types
```

### Sounds Table

Audio playback.

```lua
-- 100+ sound constants for various game sounds
Sounds.SWORD_CLASH
Sounds.ARROW_HIT
Sounds.BUILDING_COMPLETE
-- etc.
```

## Complete Script Example

Here's a mission script that requires the player to build a sawmill and recruit 10 carriers:

```lua
-- Mission: Build Economy
-- Objective: Build a sawmill and have 10 carriers

gStep = 0
gSawmillBuilt = 0

function new_game()
    register_functions()
    dbg.stm("Mission started! Build a sawmill and recruit 10 carriers.")
end

function register_functions()
    Events.TICK(on_tick)
    Events.DRAG_BUILDING(on_building_placed)
    Events.VICTORY_CONDITION_CHECK(check_victory)
end

function on_tick()
    -- Update objectives display
    local carriers = Settlers.Amount(1, Settlers.CARRIER)
    if gStep == 0 and gSawmillBuilt == 1 then
        dbg.stm("Sawmill built! Now recruit 10 carriers. Current: " .. carriers)
        gStep = 1
    end
end

function on_building_placed(player, buildingType, x, y)
    if player == 1 and buildingType == Buildings.SAWMILL then
        gSawmillBuilt = 1
    end
end

function check_victory()
    local carriers = Settlers.Amount(1, Settlers.CARRIER)
    if gSawmillBuilt == 1 and carriers >= 10 then
        dbg.stm("Victory! You built a strong economy!")
        Game.PlayerWon(1)
    end
end
```

## Lua 3.2 Syntax Notes

Settlers 4 uses Lua 3.2, which has some differences from modern Lua:

### Differences from Modern Lua

| Feature | Lua 3.2 | Modern Lua (5.x) |
|---------|---------|------------------|
| Comments | `-- comment` | Same |
| Not equal | `~=` | Same |
| String concat | `..` | Same |
| Tables | `{}` | Same |
| No `local` in loops | Use global | `local` preferred |
| No `elseif` | Use `else if` | `elseif` available |
| No `+=` operator | `x = x + 1` | Same |
| No `#` length | `strlen()`, `getn()` | `#table` |

### Example Lua 3.2 Patterns

```lua
-- String length
local len = strlen(myString)

-- Table length
local count = getn(myTable)

-- No elseif, use nested else if
if x == 1 then
    -- ...
else
    if x == 2 then
        -- ...
    end
end

-- Global variables (no local scope in older Lua)
gMyGlobal = 0
```

## Community Tools & Extensions

### S4ModApi

The [S4ModApi](https://github.com/nyfrk/S4ModApi) is a **community-created modding library** that provides additional capabilities beyond the built-in Lua scripting:

- **Custom UI elements**: Create new interface components
- **Event hooks**: Intercept game events at a lower level
- **Memory access**: Read/write game memory safely
- **Building/unit control**: More granular control over game entities

This is a C++ DLL that mods link against, separate from the Lua system.

### S4Editor+

[S4Editor+](https://docs.settlers-united.com/settler-iv-wiki-en/tips-and-tricks/s4editor+) by MuffinMario enhances the map editor:

- Embed scripts directly in .map files
- Remove vanilla editor restrictions
- Place multiple Dark Tribe instances
- Support for expansion content

### Documentation Resources

- [Settlers United Wiki - Lua API](https://docs.settlers-united.com/s4-lua-api-de) - Comprehensive German documentation
- [SettlerWiki/Settlers-4-Lua-API-DE](https://github.com/SettlerWiki/Settlers-4-Lua-API-DE) - GitHub documentation
- [MuffinMario/Siedler-4-Script-und-Referenzen](https://github.com/MuffinMario/Siedler-4-Script-und-Referenzen) - Script examples and references
- [PaweX/Settlers_IV_Map_Scripts](https://github.com/PaweX/Settlers_IV_Map_Scripts) - Original campaign scripts

## History Edition Changes

The **Settlers 4 History Edition** (Ubisoft, 2018) released:

- All configuration files publicly
- Debug logs
- Scripts for every map extracted outside map files

This made the scripting system much more accessible for modders and researchers.

## Map File Script Storage

Scripts may be stored in map files in these chunks:

| Chunk Type | ID | Purpose |
|------------|-----|---------|
| MapQuestText | 11 | Quest/mission text, possibly scripts |
| MapQuestTip | 12 | Quest tips |

The exact binary format for embedded scripts requires further reverse engineering. The S4Editor+ tool handles this automatically when embedding scripts.

## Credits

- **MuffinMario** - S4Editor+, ScriptEditor, extensive API documentation and reverse engineering
- **nyfrk** - S4ModApi library
- **Settlers United community** - Documentation, tutorials, and tools
- **ANDY** - Original script extraction work
- **PaweX** - Original campaign script collection
