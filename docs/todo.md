# Architecture TODOs

Remaining items from the modularity review (Feb 2026).

## Pending

### Add barrel file to renderer/

The `src/game/renderer/` directory lacks an `index.ts` barrel file. External code imports specific files directly, coupling consumers to internal structure.

**Action**: Create `src/game/renderer/index.ts` that exports the public API.

**Why**: Enables refactoring renderer internals without breaking dependents.

### Add test tier tags for selective CI runs

Tag e2e tests by tier (`@visual`, `@spatial`, `@economic`) to enable running subsets in CI.

**Action**: Add tags to test.describe blocks:
```typescript
test.describe('Building Rendering', { tag: '@visual' }, () => { ... });
test.describe('Unit Movement', { tag: '@spatial' }, () => { ... });
```

**Why**: Allows skipping WebGL-dependent tests in environments without GPU support.

## Completed

- ✅ Make `eventBus` required in `CommandContext`
- ✅ Convert all systems to `TickSystem` registration pattern
- ✅ Add barrel files to `audio/`, `commands/`, `economy/`
- ✅ Remove `internal/` re-exports from `placement/`
- ✅ Move `buildingStates` ownership out of `GameState`
