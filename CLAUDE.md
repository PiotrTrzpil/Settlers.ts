# Settlers.ts

A Settlers 4 (Siedler 4) browser-based remake using TypeScript, Vue 3, and WebGL.

## Stack

- **Framework**: Vue 3 (Composition API) + Vue Router
- **Build**: Vite 5, TypeScript ~5.4
- **Rendering**: WebGL2 with GLSL shaders (via `vite-plugin-glsl`)
- **Testing**: Vitest (unit), Playwright (e2e)
- **Package manager**: pnpm

## Project layout

```
src/
  components/     Vue components (debug panel, file browser, renderers)
  game/
    ai/           Behavior trees, tick logic
    commands/     Game commands (place_building, spawn, etc.)
    economy/      Building production, material types
    input/        Tile picker (pointer → tile coordinate mapping)
    renderer/     WebGL renderer, shader programs, texture management
      landscape/  Landscape renderer + terrain textures
      shaders/    Entity vertex/fragment shaders
    systems/      Hex grid, movement, pathfinding, placement, territory
  resources/
    file/         Binary readers, compression, Settlers file decoding
    gfx/          Graphics file format readers (GFX, GH, GIL, JIL, PIL, DIL)
    lib/          LIB archive format reader
    map/          Map loaders (original format + savegames)
  utilities/      File providers, logging, path helpers
  views/          Vue page components (map view, file views, etc.)
tests/
  unit/           Vitest specs (pathfinding, placement, economy, etc.)
  e2e/            Playwright specs + GamePage page object
docs/             Architecture docs, screenshots, setup guides
scripts/          Build helpers, game file import/export
```

## Commands

```sh
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # Type-check + production build
pnpm test:unit        # Run Vitest unit tests
pnpm test:watch       # Vitest in watch mode
npx playwright test   # Run Playwright e2e tests (builds + preview first)
pnpm lint             # ESLint (src/**/*.ts,*.vue)
```

## Key patterns

- **Path alias**: `@/` maps to `src/` (configured in vite.config.ts + tsconfig.json)
- **Debug bridge**: Game exposes `window.__settlers_debug__` for e2e tests and the debug panel
- **Page object**: E2e tests use `GamePage` (tests/e2e/game-page.ts) for navigation, waiting, and assertions
- **Test map**: `?testMap=true` query param loads a synthetic map (no game assets needed)
- **GLSL imports**: Shader files use `import x from './shaders/file.glsl'` via vite-plugin-glsl
- **Type declarations**: Ambient types live in `src/types/` (env.d.ts, glsl.d.ts, shims-vue.d.ts)

## Game assets

The app needs original Settlers 4 files for full functionality. See `docs/game-files-setup.md`.
Test maps and procedural textures work without game files.

## Notes

- The `.eslintrc.js` config uses CommonJS syntax but `package.json` has `"type": "module"` — linting is currently broken. Rename to `.eslintrc.cjs` to fix.
- Playwright `outputDir` writes to `tests/e2e/.results/` (gitignored).
- Screenshot baselines live in `tests/e2e/__screenshots__/` and are committed.
