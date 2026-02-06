# Claude Code Best Practices for Settlers.ts

Guidance for Claude Code on **how to work efficiently** in this codebase. For project structure and commands, see [CLAUDE.md](../CLAUDE.md).

---

## Fast Feedback Loops

**Validate every change immediately.** Fastest to slowest:

| Check | Command | When |
|-------|---------|------|
| Type check | `vue-tsc --noEmit` | After TS changes |
| Single unit test | `pnpm test:unit -- pathfinding` | After logic changes |
| All unit tests | `pnpm test:unit` | Before commit |
| Build | `pnpm build` | Before e2e |
| Single e2e | `npx playwright test -g "name"` | After UI changes |
| All e2e | `npx playwright test` | Before push |

### Workflow

```
1. Read code       -> Read / Grep / Task(Explore)
2. Edit            -> Edit
3. Test            -> Bash("pnpm test:unit -- <spec>")
4. Fix & repeat
5. Full suite      -> Bash("pnpm test:unit")
6. Build           -> Bash("pnpm build")
7. E2e if needed   -> Bash("npx playwright test <spec>")
```

### Cross-Module Changes

If touching multiple modules, **always run e2e** even if unit tests pass:
```bash
pnpm test:unit && pnpm build && npx playwright test <spec>
```

---

## Command Chaining

**Sequential** (each depends on previous):
```bash
pnpm build && npx playwright test
```

**Parallel** (independent):
```
Bash("pnpm test:unit")
Bash("vue-tsc --noEmit")
```

**Pre-push validation**:
```bash
pnpm test:unit && pnpm build && npx playwright test
```

---

## LSP MCP (cclsp)

When available (local only, not cloud), **prefer LSP over grep/edit for refactoring**:

| Operation | Tool |
|-----------|------|
| Rename symbol | `mcp__cclsp__rename_symbol` |
| Find usages | `mcp__cclsp__find_references` |
| Go to definition | `mcp__cclsp__find_definition` |
| Check errors | `mcp__cclsp__get_diagnostics` |

Benefits: scope-aware, updates imports, handles re-exports.

---

## Reading Order

**Game logic**: `game-state.ts` → `commands/` → `systems/` → `tests/unit/`

**Rendering**: `renderer/renderer.ts` → `landscape/` → `shaders/`

**Input**: `input/input-state.ts` → `input/modes/` → `use-renderer.ts`

---

## Pitfalls

- **E2e requires build**: Always `pnpm build && npx playwright test`
- **Hex coordinates**: Odd/even Y rows have different offsets — test both
- **WebGL in unit tests**: jsdom has no WebGL — use e2e for rendering
- **Shader changes**: Require build to take effect in e2e
