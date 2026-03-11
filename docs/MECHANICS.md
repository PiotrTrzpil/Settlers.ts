# Game Mechanics Overview

How Settlers 4 works — the rules, economy, and systems that drive gameplay.

## Starting the Game

Each player begins with one or more **territory-generating buildings** (Castle or Guard Towers) already placed on the map. These buildings define the player's initial territory — a circular area of owned land.

**Free starting piles** of materials (LOG, STONE, BOARD, etc.) are placed on the ground within the player's territory. These are the initial resources used to bootstrap the economy. Starting pile quantities vary by map difficulty setting (low / medium / high). Piles are owned by whichever player's territory they sit in.

Players also start with initial **workers** — typically Carriers and Builders — positioned near their starting buildings.

## Territory

Territory is the foundational constraint of the game. Players can only build, gather, and operate within their own territory.

**Three building types generate territory:**

| Building | Influence Radius |
|----------|-----------------|
| GuardTowerSmall | 48 tiles |
| GuardTowerBig | 76 tiles |
| Castle | 100 tiles |

All tiles within the radius belong to the player who built the structure. When territories overlap, the closest tower wins. Territory recalculates whenever a tower is built or destroyed.

**Pioneers** can expand territory incrementally by claiming individual tiles beyond tower range.

**Territory rules:**
- Buildings can only be placed on owned territory
- Carriers only transport within their player's territory
- Free piles on the ground belong to the territory owner
- Enemy military can enter and contest territory

## Buildings

### Placement

Buildings occupy a **footprint** (multiple tiles) and have a **blocking area** that prevents unit movement through them. Each building has a **door position** where workers and carriers enter/exit. Material piles sit at designated positions within the footprint.

**Mines** (CoalMine, IronMine, GoldMine, StoneMine, SulfurMine) must be placed on **mountain/rock terrain** specifically.

### Construction Process

1. Player places a building — it appears as a **construction site** in PLANNING phase
2. The site demands construction materials (STONE, BOARD, sometimes GOLDBAR)
3. Carriers deliver materials to the construction site's input inventory
4. Once all materials arrive, the site enters CONSTRUCTING phase with a build timer
5. Builders work the site during construction
6. On completion, the building becomes operational and spawns its dedicated worker(s)
7. During construction, terrain under the building is **leveled flat** (restored if building is removed)

### Building Categories

**Resource Extraction** — workers leave the building to gather raw materials from the landscape:
- WoodcutterHut: woodcutter finds and cuts nearby trees, producing LOG
- StonecutterHut: stonecutter finds and mines nearby stones, producing STONE
- FisherHut: fisher catches fish from nearby water, producing FISH
- HunterHut: hunter finds and kills nearby animals, producing MEAT
- ForesterHut: forester plants new trees (no material output — sustains the forest)

**Mines** — workers stay in the building, consuming food to produce ore:
- CoalMine: BREAD &rarr; COAL
- IronMine: BREAD &rarr; IRONORE
- GoldMine: BREAD &rarr; GOLDORE
- StoneMine: BREAD &rarr; STONE
- SulfurMine: BREAD &rarr; SULFUR

Mines extract from **ore veins** — finite deposits in mountain tiles. Geologists can prospect tiles to reveal ore type and richness before placing mines.

**Processing** — transform one material into another:
- Sawmill: LOG &rarr; BOARD
- Mill: GRAIN &rarr; FLOUR
- Bakery: FLOUR + WATER &rarr; BREAD
- AnimalRanch: GRAIN &rarr; PIG
- Slaughterhouse: PIG &rarr; MEAT
- IronSmelter: IRONORE + COAL &rarr; IRONBAR
- SmeltGold: GOLDORE + COAL &rarr; GOLDBAR
- WeaponSmith: IRONBAR + COAL &rarr; SWORD, BOW, or ARMOR
- ToolSmith: IRONBAR + COAL &rarr; AXE, HAMMER, ROD, PICKAXE, SAW, SCYTHE, or SHOVEL

**Farming** — workers plant and harvest within a configurable work area:
- GrainFarm: (plants grain) &rarr; GRAIN
- WaterworkHut: &rarr; WATER

**Race-Specific Drink Production:**
- Roman: Vinyard &rarr; WINE
- Viking: BeekeeperHut &rarr; HONEY; MeadMakerHut: HONEY &rarr; MEAD
- Mayan: AgaveFarmerHut &rarr; AGAVE; TequilaMakerHut: AGAVE &rarr; TEQUILA
- Trojan: SunflowerFarmerHut &rarr; SUNFLOWER; SunflowerOilMakerHut: SUNFLOWER &rarr; SUNFLOWEROIL

**Military:**
- GuardTowerSmall / GuardTowerBig: create territory, can garrison soldiers
- Castle: large territory, starting building
- Barrack: trains military units from weapons + gold + armor
- LookoutTower: extended vision range

**Residential:**
- ResidenceSmall: spawns 2 Carriers over time
- ResidenceMedium: spawns 4 Carriers
- ResidenceBig: spawns 6 Carriers

Residences are how the player grows their workforce — newly spawned carriers can become specialists or transport materials.

**Storage:**
- StorageArea: generic material warehouse with configurable filters (which materials to accept/output)

## Workers and Settlers

### Worker Types

Workers are non-selectable units that operate autonomously. Each building type requires a specific worker type.

**Common workers (all races):** Carrier, Builder, Digger, Woodcutter, Stonecutter, Forester, Farmer, Fisher, Hunter, Miner, Smelter, Smith, SawmillWorker, Miller, Baker, Butcher, AnimalFarmer, Waterworker, Healer, Donkey.

**Race-specific workers:** Winemaker (Roman), Beekeeper/Meadmaker (Viking), AgaveFarmer/Tequilamaker (Mayan), SunflowerFarmer/SunflowerOilMaker (Trojan).

### Worker Creation and Auto-Recruitment

Workers don't appear from nothing — every specialist starts as a **Carrier**. There are two paths from building completion to a working specialist:

**Path A — Direct Spawn (construction completion):**
When a building finishes construction, a new specialist unit is spawned directly inside the building at the door tile. This is the default for freshly constructed buildings. The worker is immediately claimed by the building and starts working.

**Path B — Auto-Recruitment (demand-driven):**
When a building needs a worker but none was spawned (e.g., the original worker died, or the building was configured without one), a **building demand** is created. The demand system then:

1. First searches for an **idle specialist** of the right type already in the population (e.g., a homeless Woodcutter wandering). If found, it dispatches them to walk to the building.
2. If no idle specialist exists, it finds an **idle Carrier** and recruits them.

**Carrier recruitment requires tools.** Most specialist types need a specific tool material:

| Specialist | Required Tool |
|-----------|--------------|
| Woodcutter | AXE |
| Builder | HAMMER |
| Digger | SHOVEL |
| Stonecutter | PICKAXE |
| Farmer | SCYTHE |
| Fisher | ROD |
| SawmillWorker | SAW |
| Miner | PICKAXE |

The system finds the nearest tool pile (produced by the ToolSmith), sends the carrier to pick it up, and **transforms** the carrier into the specialist. The carrier's entity type mutates (e.g., Carrier &rarr; Woodcutter), the tool is consumed, and the new specialist walks to their assigned building.

**If no idle carrier or tool is available**, the demand stays in the queue and retries each tick (~1 second). Buildings don't break — they just wait idle until a worker becomes available.

**At game start**, workers pre-placed on the map inside building footprints are automatically assigned to their matching building via initial worker assignment.

### How Workers Operate

1. A worker is assigned to a building (via spawn or recruitment)
2. The worker is **claimed** by the building
3. The worker's **search type** determines what it looks for (trees, stones, fish, crop tiles, etc.)
4. The worker searches within a **work area radius** around the building
5. When a target is found, the worker walks to it, performs work (animated), and produces output
6. Output goes to the building's output inventory as a material pile
7. The worker returns to the building and repeats

**Examples:**
- **Woodcutter**: searches for the nearest cuttable tree (growth stage READY) within ~30 tiles. Walks to tree, cuts it (tree becomes CUT stage), LOG appears. Returns to hut, repeats.
- **Stonecutter**: searches for stones. Mines them progressively (stones have 13 depletion stages). STONE produced.
- **Farmer**: finds empty tiles in work area, plants grain seeds. Returns later to harvest mature crops (GRAIN produced).
- **Forester**: finds empty tiles in work area, plants tree saplings. Trees grow through SMALL &rarr; MEDIUM &rarr; READY stages over time.
- **Miner**: stays in the mine building. Consumes BREAD from input inventory, extracts ore from the mountain tile, places output in building inventory.
- **Building-bound workers** (baker, miller, smith, smelter): stay in their building, consume input materials, produce output materials on a timer.

### Carriers

Carriers are the logistics backbone. They are **not selectable** and operate automatically:

1. When a building needs materials (construction site, mine needing bread, smelter needing ore), it creates a **resource request**
2. The logistics system matches the request to a **source** (another building's output inventory, or a free pile)
3. An **idle carrier** is assigned to fulfill the request
4. The carrier walks to the source, picks up the material, walks to the destination, drops it off
5. The carrier returns to the idle pool

**Transport priority** determines which requests are fulfilled first:
1. BOARD, STONE (building materials — highest priority)
2. BREAD, MEAT, FISH (food for mines)
3. COAL, ores
4. Metals, tools, weapons (lowest)

Carriers only operate within their player's territory. Materials are reserved when a carrier is assigned to prevent double-delivery.

## Economy and Production Chains

The economy is built on interconnected production chains. Here are the major ones:

### Wood Chain
```
Trees (landscape) --> WoodcutterHut --> LOG --> Sawmill --> BOARD
                  ForesterHut replants trees
```
BOARD is the primary building material. LOG is also used directly.

### Stone Chain
```
Stones (landscape) --> StonecutterHut --> STONE
Mountains          --> StoneMine (+ BREAD) --> STONE
```
STONE is the other primary building material.

### Food Chain (critical for mining)
```
GrainFarm --> GRAIN --> Mill --> FLOUR -+
                                       +--> Bakery --> BREAD
WaterworkHut --> WATER ----------------+

Alternative food:
FisherHut --> FISH
HunterHut --> MEAT
AnimalRanch (+ GRAIN) --> PIG --> Slaughterhouse --> MEAT
```
BREAD is consumed by all mines. Without food, mines cannot operate.

### Metal Chain
```
BREAD --> CoalMine --> COAL --------+
BREAD --> IronMine --> IRONORE --+  |
                                +--+--> IronSmelter --> IRONBAR
BREAD --> GoldMine --> GOLDORE --+  |
                                +--+--> SmeltGold --> GOLDBAR
```

### Military Chain
```
IRONBAR + COAL --> WeaponSmith --> SWORD / BOW / ARMOR
IRONBAR + COAL --> ToolSmith --> tools (AXE, PICKAXE, etc.)

SWORD/BOW + GOLDBAR + ARMOR --> Barrack --> Military Units
```

### Drink Chain (race-specific, one per race)
```
Roman:  Vinyard --> WINE
Viking: BeekeeperHut --> HONEY --> MeadMakerHut --> MEAD
Mayan:  AgaveFarmerHut --> AGAVE --> TequilaMakerHut --> TEQUILA
Trojan: SunflowerFarmerHut --> SUNFLOWER --> SunflowerOilMakerHut --> SUNFLOWEROIL
```

## Materials

41 material types exist. Key categories:

| Category | Materials |
|----------|-----------|
| Building materials | LOG, STONE, BOARD, GOLDBAR |
| Raw ores | COAL, IRONORE, GOLDORE, SULFUR |
| Metals | IRONBAR, GOLDBAR |
| Food | BREAD, MEAT, FISH, GRAIN, FLOUR, WATER |
| Livestock | PIG, GOAT, SHEEP, GOOSE (non-droppable) |
| Tools | AXE, PICKAXE, SAW, HAMMER, SCYTHE, ROD, SHOVEL |
| Weapons | SWORD, BOW, ARMOR, BATTLEAXE, BLOWGUN, CATAPULT, AMMO |
| Drinks | WINE, HONEY, MEAD, AGAVE, TEQUILA, SUNFLOWER, SUNFLOWEROIL |

Each building has an **inventory** with input and output slots. Each slot holds up to **8 items** of one material type. Carriers move materials between building inventories.

## Landscape and Map Objects

### Trees
Trees grow through stages: **SMALL &rarr; MEDIUM &rarr; READY &rarr; CUT**. Only READY trees can be harvested by woodcutters. Cut trees leave an empty tile that foresters can replant. Trees also spread naturally — new saplings grow near existing trees via **tree expansion**.

### Stones
Stones on grassland are finite resources with **13 visual depletion stages**. Stonecutters chip away at them progressively. When fully depleted, the stone disappears.

### Ore Veins
Mountain tiles contain ore deposits (coal, iron, gold, sulfur). **Geologists** prospect mountain tiles and place **ore signs** indicating type and richness (green = rich, yellow = medium, red = poor). Mines placed on these tiles extract ore until the vein is depleted.

### Crops
Farmable tiles cycle through: **EMPTY &rarr; SEEDLING &rarr; MEDIUM &rarr; READY &rarr; HARVESTED**. Farmers plant seeds on empty tiles within their work area and return to harvest when crops mature. Race-specific crops include grain (all), agave (Mayan), and sunflower (Trojan).

## Military

### Unit Types
Military units are **selectable** — the player directly commands them.

**Base types (all races):** Swordsman, Bowman — each with 3 experience levels (L1, L2, L3).

**Race-specific specialists (3 levels each):**
- Roman: Medic
- Viking: AxeWarrior
- Mayan: BlowgunWarrior
- Trojan: BackpackCatapultist

**Special units:** Priest, Pioneer, Thief, Geologist, Saboteur, Gardener.

### Training
Military units are trained at the **Barrack**. The barracks consumes weapons (SWORD or BOW), GOLDBAR, and ARMOR to transform an idle carrier into a soldier. Race-specific weapons produce race-specific specialists.

### Combat
Military units automatically detect nearby enemies within a scan radius. They pursue and engage in melee combat, dealing periodic damage. Units have health and can be killed in combat.

### Territory Warfare
Guard towers and castles can be **besieged** and captured by enemy forces. Destroying or capturing a player's territory-generating buildings shrinks their territory, cutting off buildings and workers from the economy.

## Storage Areas

StorageArea buildings serve as general-purpose warehouses. Players can configure **filters** per material:
- **Input only**: accept deliveries of this material
- **Output only**: allow carriers to take this material
- **Both**: accept and distribute
- **Disabled**: ignore this material entirely

This lets players control material flow — e.g., stockpiling weapons near barracks, or preventing food from being stored far from mines.

## Work Areas

Many buildings (farms, foresters, fishers, hunters, woodcutters, stonecutters) have a configurable **work area** — a circular radius around the building where the worker operates. Players can adjust work areas to avoid overlap between buildings or direct workers to specific resource patches.

## Population Growth

New settlers come from **Residence** buildings. Over time, residences spawn new Carriers (2/4/6 depending on size). These carriers join the idle pool and either:
- Get assigned transport jobs by the logistics system
- Get transformed into specialist workers when a building needs one
- Get recruited into military units at the barracks

Building more residences = faster population growth = more workers and soldiers.

## Races

Four playable races: **Roman, Viking, Mayan, Trojan** (plus Dark Tribe as enemy-only).

All races share the same core economy and building set. They differ in:
- **Drink production chain** (wine / mead / tequila / sunflower oil)
- **Military specialist** (medic / axe warrior / blowgun warrior / catapultist)
- **Visual appearance** (different sprite sets per race)
- **Building appearance** (race-specific architecture)

## Game Flow Summary

A typical game progresses through these phases:

1. **Bootstrap**: use starting piles to build a Sawmill, WoodcutterHut, StonecutterHut, and Residences
2. **Basic economy**: establish wood and stone production. Build ForesterHut to sustain tree supply
3. **Food production**: build GrainFarm, Mill, Bakery (and WaterworkHut) to produce BREAD
4. **Mining**: place mines on mountains (CoalMine, IronMine). They need BREAD to operate
5. **Metal processing**: build IronSmelter (IRONORE + COAL &rarr; IRONBAR)
6. **Tools and weapons**: ToolSmith for economy tools, WeaponSmith for military equipment
7. **Military buildup**: Barrack turns carriers into soldiers using weapons + gold + armor
8. **Territory expansion**: build Guard Towers to extend territory and access more resources
9. **Warfare**: send military units to attack enemy territory, siege their towers, destroy their economy
