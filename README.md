# Settlers.ts

A browser-based remake of **The Settlers 4** (Die Siedler 4) built with TypeScript, Vue 3, and WebGL2.

## What's Working

### Rendering
- **WebGL2 terrain renderer** with hex-grid landscape, height maps, texture transitions, river rendering, and fog-of-war
- **Sprite batch renderer** — entities are drawn via a dynamic vertex buffer with sprites packed into a R16UI texture atlas storing raw palette indices
- **GPU palette lookup** — the original 8-bit palette is uploaded as a texture; the fragment shader maps palette indices to RGBA, with separate palettes per player for color tinting
- **Two-tier sprite cache** — decoded sprite atlas chunks are stored in-memory (survives HMR) and in IndexedDB via the Cache API (survives page refresh), compressed with lz4 and decompressed in parallel across workers
- **Parallel sprite decoding** across up to 8 Web Workers with zero-copy ArrayBuffer transfers
- **Isometric depth sorting** and spatial-grid viewport culling — only visible entities are submitted for rendering
- All five races render with their own building and unit sprite sets: Roman, Viking, Mayan, Dark Tribe, Trojan

### Economy and Logistics
- Full **production chain** simulation: woodcutting, sawmills, stone quarries, farms, mills, bakeries, fisheries, animal ranches, mines, smelters, smithies, and race-specific goods (wine, mead, tequila, sunflower oil)
- **Worker AI** driven by YAML job definitions — woodcutters, stonecutters, foresters, farmers, miners, carriers, builders, diggers, smiths, millers, butchers
- **Logistics dispatcher** matches resource requests to available supplies, assigns idle carriers, and tracks delivery status with stall detection
- **Building inventory** system with input/output slots and reservations
- **Territory** computed from castles and guard towers via BFS flood-fill; logistics respects territory boundaries
- **Service areas** for carrier zone assignment

### Construction
- Multi-phase **building construction**: foundation, building, completion with terrain leveling and worker spawning
- Buildings placed from a race-specific build palette in the UI

### World Simulation
- **Tree lifecycle** (growing, mature, cutting, cut) with procedural forest expansion
- **Stone depletion** with multi-stage visual feedback
- **Crop farming** (grain, sunflower, agave, beehives) with growth, harvest, and decay cycles

### Combat
- **Swordsmen and bowmen** with 3 experience levels, per-type stats (health, damage, cooldown), and level multipliers
- Units scan for enemies, pursue, and engage in combat

### File Format Readers
- GFX, GH, JIL, DIL, GIL, PIL, SIL, SND, LIB archives, MAP files (including savegames), ARA decryption, and GameData XML parsing
- Built-in viewers for all major file formats (GFX, GH, JIL, LIB, MAP)

### UI
- Build/Units/Goods placement panels, race selector, entity selection with detailed debug info
- Debug panel with performance stats, system toggles, and map tools
- Layer visibility controls (terrain, buildings, units, territory, paths, work areas)
- Logistics debug panel with live transport job tracking
- Feature toggle panel to enable/disable individual game systems at runtime

### Architecture
- **ECS-inspired** data-oriented design — entities are plain data, systems are stateless tick processors
- **Feature module** system with dependency-aware registration and topological ordering
- **Typed command pipeline** — all state changes (from UI, AI, or Lua) go through a unified command bus
- **Event bus** with grouped subscription cleanup
- Fixed-timestep game loop at 30 ticks/second with background throttling
- Auto-save to localStorage every 5 seconds with schema versioning

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A legal copy of **The Settlers 4** (e.g. *The Settlers History Collection* or *Settlers United* from Ubisoft)

### Set up game files

The app reads original Settlers 4 assets at runtime. On a Windows machine with the game installed, export them:

```powershell
.\scripts\export-game-files.ps1 -SourcePath "D:\path\to\settlers4"
```

Then import the zip(s) on your dev machine:

```sh
python3 scripts/import-game-files.py /path/to/zips
```

### Install and run

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. Add `?testMap=true` to load a synthetic test map without game assets.

## Development

```sh
pnpm lint             # Type-check + ESLint
pnpm test:unit        # Run Vitest unit tests
pnpm test:watch       # Vitest in watch mode
pnpm build            # Production build
npx playwright test   # E2E tests
```

## What Remains

- **Terrain rendering fixes** — river and desert tiles have visual artifacts and incorrect transitions that need fixing
- **Map object sprites** — many raw map objects are not yet mapped to the correct sprite; needs visual comparison with the original game
- **Settler sprite coverage** — not all settler types are linked to their sprite animations yet
- **Full logistics** — the current system handles basic supply/demand but lacks the full priority-based distribution, overflow handling, and transport optimization of the original
- **Trade** — no donkey or ship-based goods transport between your own buildings
- **Ships and waterways** — no harbors, ferries, or naval transport
- **Garrisoning** — soldiers don't man guard towers or castles yet
- **Fog of war** — darkness map renders but is static; no dynamic exploration or line-of-sight updates
- **Victory conditions** — no win/loss detection
- **Full construction** — settlers don't yet perform the full digging and multi-step building animation sequences from the original
- **War machines** — catapults, ballistae, and siege equipment are not implemented
- **Special units** — priests, geologists, thieves, pioneers, gardeners, and other non-combat specialists
- **Geology and mining** — no geologist resource searching on mountains; mines exist but lack full ore vein depletion and discovery mechanics
- **Magic** — no mana system or priest spells
- **Dark Tribe specifics** — unique Dark Tribe mechanics (e.g. conversion, mushroom-based economy quirks) are not implemented
- **AI players** — a behavior tree framework exists but no autonomous AI opponent logic is wired up
- **Multiplayer** — no networking layer
- **Sound** — infrastructure exists but sound playback is incomplete
- **Map editor** — no in-browser map creation tool

## Acknowledgments

This project is a fork of [tomsoftware/Settlers.ts](https://github.com/tomsoftware/Settlers.ts) by Thomas Schian, who built the original file format readers and WebGL map viewer that made this remake possible.

**The Settlers 4** was created by **Blue Byte** and published by **Ubisoft**. All original game assets, the names *Siedler* and *Settlers*, and related intellectual property belong to their respective owners. This project does not distribute any copyrighted game data.

Thanks to the Settlers 4 modding community whose documentation of file formats, game data structures, and scripting APIs has been invaluable.
