# Coding Guidelines

TypeScript and Vue patterns for this project.

## TypeScript

### Error Handling

**Never swallow exceptions.** Every layer has a strategy:

| Layer | Strategy |
|-------|----------|
| Data sources / enrichers | Log warning, return partial result |
| Storage / persistence | Log error, re-raise |
| API / HTTP handlers | Return appropriate HTTP status |

**Error messages must include context.** Include all relevant identifiers (entity ID, type name, state) so root cause can be traced. Never throw generic "not found" — always say what was being looked up and what was available.

```typescript
// BAD
throw new Error('not found');
if (!x) return null;

// GOOD
throw new Error(`Entity ${id} not found in ${systemName}. Available: ${[...map.keys()]}`);
throw new Error(`Cannot process ${type}: ${JSON.stringify(state)}`);
```

**Report errors eagerly** — fail fast at the source, not downstream. If a function receives invalid input, throw immediately with context rather than returning null and failing later.

### Optimistic Programming

**CRITICAL — read `docs/optimistic.md` before writing any code.** Violations are treated as bugs, not style issues.

### Avoid Meaningful Logic in Closures

Don't pass closures containing real logic into constructors or functions. Inline closures are hard to name, test, trace in stack traces, and read at the callsite. If a closure does more than forward a call or return a literal, extract it into a named method.

```typescript
// BAD — logic buried in a closure passed to a constructor
new SettlerTaskSystem({
  onJobComplete: (settler, job) => {
    this.inventory.credit(job.output);
    this.eventBus.emit('job-complete', { settler, job });
    if (job.type === 'construction') this.construction.finalize(job.buildingId);
  },
});

// GOOD — named method, traceable, testable
new SettlerTaskSystem({ onJobComplete: this.handleJobComplete.bind(this) });

private handleJobComplete(settler: Settler, job: Job): void {
  this.inventory.credit(job.output);
  this.eventBus.emit('job-complete', { settler, job });
  if (job.type === 'construction') this.construction.finalize(job.buildingId);
}
```

```typescript
// BAD — meaningful transformation hidden in an array pipeline
const results = items.map(item => {
  const base = this.registry.get(item.type)!;
  return { ...base, quantity: item.quantity * base.multiplier, label: formatLabel(base) };
});

// GOOD — named function makes the intent clear
const results = items.map(item => this.resolveItem(item));
```

Simple forwarding closures are fine — the rule is about logic that deserves a name:

```typescript
// OK — trivial, no hidden logic
button.onClick(() => this.close());
items.filter(x => x.active);
```

### Coding Style

- **Prefer async/await** over `.then()` chains
- **Path alias**: `@/` → `src/`
- **Lint**: Run `pnpm lint:fix` after changes. Fix errors, consider warnings.
- **Format**: Run `pnpm format` to apply Prettier formatting.

---

## Vue

### Components

- Composition API (`<script setup lang="ts">`)
- Feature modules follow registration pattern (see `docs/architecture/feature-modules.md`)
- Minimal public API per module — communicate through events

### Testing

- Vitest for unit tests, Playwright for e2e
- Always lint before e2e: `pnpm lint && npx playwright test`
- Use page objects (`GamePage`) for e2e navigation and assertions
- Never use `waitForTimeout()` — use semantic waiters (`waitForFrames()`, `waitForReady()`)

---

## Libraries Reference

| Purpose | Library |
|---------|---------|
| UI framework | Vue 3 (Composition API) |
| Rendering | WebGL2 + GLSL shaders |
| Audio | Howler |
| State management | Vue reactivity |
| Schema validation | Zod |
| Testing | Vitest (unit), Playwright (e2e) |
| Linting | ESLint 9, typescript-eslint, Prettier |
