# TypeScript 7.0 Migration — Design

## Overview

Migrate Settlers.ts from TypeScript 5.9.3 to TypeScript 7.0 (the Go-native rewrite, "Project Corsa"). TS 7.0 delivers ~10x faster compilation but drops several legacy compiler options and changes defaults. The project is already well-positioned (ESNext target, `strict: true`, `bundler` module resolution, heavy `import type` usage), so the migration is low-risk with focused tsconfig and tooling updates.

## Current State

- **TypeScript**: `~5.9.3` with `strict: true`, `target: ESNext`, `moduleResolution: bundler`
- **Type checker**: `vue-tsc` (wraps `tsc` for Vue SFC support)
- **Linting**: `typescript-eslint` v8.56 + `oxlint` (type-aware) in parallel
- **Enums**: ~60 regular enums, 4 `const enum` declarations — all used correctly
- **Namespaces**: 3 in `fengari.d.ts` (external type declaration) — no source-level namespaces
- **No decorators, no `/// <reference>`, no `.js` imports, no `require()`**
- **Path alias**: `@/*` → `./src/*` via `paths` (no `baseUrl`)

## Summary for Review

- **Interpretation**: Upgrade TypeScript from 5.9 → 7.0, stepping through 6.0 as the bridge version. Update all tooling (vue-tsc, typescript-eslint, oxlint) to TS 7.0-compatible versions. Fix any breaking tsconfig options and type errors.
- **Key decisions**:
  - Go straight to TS 7.0 — no TS 6.0 stepping stone needed (tsconfig is already clean of deprecated options)
  - Keep `const enum` declarations (TS 7.0 still supports them with `isolatedModules`)
  - Do NOT migrate enums to `as const` objects — enums are idiomatic in this project and TS 7.0 doesn't remove them
  - Remove `esModuleInterop` and `allowSyntheticDefaultImports` (redundant in TS 7.0's ESM-native mode)
- **Assumptions**: `vue-tsc` v3.x will ship TS 7.0 support (Vue Language Tools tracks TS majors quickly). `typescript-eslint` v9+ will support TS 7.0. If either lags, we pin and defer that subsystem.
- **Scope**: tsconfig changes, dependency upgrades, fix type errors. NOT a code style migration (no enum→const object, no namespace removal).

## Conventions

- Use `pnpm lint` (not `pnpm build`) to validate — run once, tee to `/tmp/lint.txt`
- Use `pnpm test:unit` to validate — run once, tee to `/tmp/test.txt`
- Optimistic programming: no defensive fallbacks, trust contracts
- Max 600 lines/file, 250 lines/function, complexity 15

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | TSConfig Migration | Update compiler options for TS 7.0 compatibility | — | `tsconfig.json`, `scripts/gfx-export/tsconfig.json` |
| 2 | Dependency Upgrades | Bump TS, vue-tsc, typescript-eslint, oxlint to TS 7.0-compatible versions | — | `package.json`, `pnpm-lock.yaml` |
| 3 | ESLint Config Update | Update eslint config for new typescript-eslint version if API changes | 2 | `eslint.config.mjs` |
| 4 | Type Error Fixes | Fix any new type errors introduced by stricter TS 7.0 checking | 1, 2 | `src/**/*.ts`, `src/**/*.vue`, `tests/**/*.ts` |
| 5 | Validation | Full lint + test pass to confirm zero regressions | 1–4 | — |

## Shared Contracts

No new types or APIs — this is a tooling migration. The contract is: **all existing code compiles and passes lint/tests with zero changes to runtime behavior.**

## Subsystem Details

### 1. TSConfig Migration
**Files**: `tsconfig.json`, `scripts/gfx-export/tsconfig.json`

**Changes to `tsconfig.json`:**
- Remove `esModuleInterop: true` — TS 7.0 enables ESM interop natively
- Remove `allowSyntheticDefaultImports: true` — implied by the above
- Remove `skipLibCheck: true` — evaluate if still needed; re-add only if third-party `.d.ts` files cause errors
- Keep `target: "ESNext"` — still valid (TS 7.0 drops `es5` but ESNext is fine)
- Keep `moduleResolution: "bundler"` — still valid (TS 7.0 drops `node10`, not `bundler`)
- Keep `strict: true` — already set (TS 7.0 makes this the default, but explicit is fine)
- Keep `types: ["vite/client", "node"]` — already explicit (TS 7.0 defaults `types` to `[]`)
- Verify `paths` works without `baseUrl` — already the case, no change needed

**Changes to `scripts/gfx-export/tsconfig.json`:**
- Remove `esModuleInterop: true`, `skipLibCheck: true` (same rationale)
- Keep `module: "NodeNext"`, `moduleResolution: "NodeNext"` — still valid in TS 7.0
- Keep explicit `rootDir: "."` and `outDir: "./dist"` — TS 7.0 changes rootDir inference, but explicit values are safe

**Key decision**: If removing `skipLibCheck` causes third-party `.d.ts` errors, re-add it. Don't fix upstream type bugs.

### 2. Dependency Upgrades
**Files**: `package.json`

**Upgrade matrix:**

| Package | Current | Target | Notes |
|---------|---------|--------|-------|
| `typescript` | `~5.9.3` | `~7.0.x` | Core upgrade |
| `vue-tsc` | `^3.2.5` | Latest TS 7.0-compatible | Check Vue Language Tools releases |
| `typescript-eslint` | `^8.56.0` | `^9.x` or latest TS 7.0-compatible | May need major bump |
| `oxlint` | `^1.54.0` | Latest | Verify `--type-aware` still works with TS 7.0 |
| `oxlint-tsgolint` | `^0.16.0` | Latest | Companion plugin for oxlint |
| `tsx` | `^4.21.0` | Latest | Uses esbuild, not tsc — likely unaffected |

**Process:**
1. `pnpm add -D typescript@~7.0`
2. `pnpm add -D vue-tsc@latest`
3. `pnpm add -D typescript-eslint@latest`
4. `pnpm add -D oxlint@latest oxlint-tsgolint@latest`
5. `pnpm install`

**Key decision**: If `typescript-eslint` doesn't yet support TS 7.0, check if the current version works anyway (it often does with minor version mismatches). If not, temporarily pin and track the upstream issue.

### 3. ESLint Config Update
**Files**: `eslint.config.mjs`

- If `typescript-eslint` ships a major version bump (v8 → v9), review their migration guide for config API changes
- Verify `projectService: true` still works (this is the modern approach, likely stable)
- Verify `vue-eslint-parser` compatibility with the new `typescript-eslint` parser
- Check if any type-aware rules changed names or behavior

### 4. Type Error Fixes
**Files**: Various `src/**/*.ts`, `tests/**/*.ts`

Expected low volume based on codebase analysis:
- **`const enum` across `isolatedModules`**: Already using `isolatedModules: true` — const enums are already restricted to declaration-only usage. No changes expected.
- **Stricter type narrowing**: TS 7.0 may narrow some types differently. Fix on a case-by-case basis.
- **`esModuleInterop` removal**: Default imports from CJS modules (`import foo from 'cjs-pkg'`) may need to become `import * as foo from 'cjs-pkg'`. Scan for affected imports if errors appear.

**Process**: Run `vue-tsc --noEmit`, collect errors, fix in batches.

### 5. Validation
- `pnpm lint 2>&1 | tee /tmp/lint.txt` — must pass clean
- `pnpm test:unit 2>&1 | tee /tmp/test.txt` — must pass clean
- `pnpm build` — must succeed
- Manual smoke test: `pnpm dev`, load test map (`?testMap=true`), verify game runs

## File Map

### Modified Files
| File | Change |
|------|--------|
| `tsconfig.json` | Remove deprecated options, verify remaining |
| `scripts/gfx-export/tsconfig.json` | Same |
| `package.json` | Bump TS + tooling dependencies |
| `pnpm-lock.yaml` | Auto-generated |
| `eslint.config.mjs` | Update if typescript-eslint API changes |
| `src/**/*.ts` (if needed) | Fix type errors from stricter checking |

### New Files
None expected.

## Verification

1. **Type-check passes**: `vue-tsc --noEmit` exits 0
2. **Lint passes**: `pnpm lint` exits 0 with no new errors
3. **All unit tests pass**: `pnpm test:unit` — same pass count as before
4. **Build succeeds**: `pnpm build` produces working output
5. **Runtime smoke test**: Dev server loads test map without console errors
