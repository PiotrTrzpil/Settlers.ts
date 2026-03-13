# Deduplicate Utility Functions — Design

## Overview

Three pairs of identical/near-identical functions exist across the codebase. Extract each into a single shared location and update call sites to import from there. A fourth pair (`buildSnapshotConfig`) is just trivial object-literal wiring that doesn't warrant extraction — inline it instead.

## Current State

| Function | Location 1 | Location 2 | Identical? |
|----------|-----------|-----------|------------|
| `initCRC32Table` + `crc32` + `writeUint32BE` + `createPngChunk` | `scripts/gfx-export/cli.ts:80` | `src/resources/gfx/exporter/png-encoder.ts:11` | CRC32 table init differs cosmetically (ternary vs if/else); `crc32`, `writeUint32BE`, `createPngChunk` are identical |
| `buildSnapshotConfig` | `src/composables/useLogisticsDebug.ts:25` | `src/game/cli/commands/economy.ts:29` | Body identical; one takes `Game`, other takes `CliContext` (which has `.game`) |
| `buildingTypeNameSafe` | `src/game/features/logistics/bottleneck-detection.ts:25` | `src/game/features/logistics/logistics-snapshot.ts:156` | Identical (param type `number\|string` vs `number` — trivially unified) |
| `unitTypeNameSafe` | `src/game/features/logistics/bottleneck-detection.ts:29` | `src/game/features/logistics/logistics-snapshot.ts:160` | Identical (param type `number\|string` vs `UnitType`) |

## Summary for Review

- **Interpretation**: Extract each duplicated utility to one canonical location, then replace copies with imports.
- **Key decisions**:
  - The `*TypeNameSafe` pair moves to a shared helpers file within `logistics/` since both consumers are in that directory.
  - `buildSnapshotConfig` is NOT extracted — it's trivial `{ field: source.field }` wiring glue. Delete both copies; inline the object literal at each call site.
  - PNG helpers (`crc32`, `writeUint32BE`, `createPngChunk`) stay in `png-encoder.ts` and get exported; the script imports from there instead of inlining. The cli.ts comment "inline to avoid import issues" is stale — the script already imports from `src/resources/`.
- **Assumptions**: No new files needed for the `*TypeNameSafe` pair — a small helpers file in `logistics/` is cleaner than polluting an existing module's exports.
- **Scope**: Only the pairs listed. No other refactoring.

## Conventions

- Optimistic programming: no fallbacks on required values, `!` or throw instead of `?.`
- The `*TypeNameSafe` functions are intentionally defensive (`||`, `??`) — they format arbitrary subType values for debug display, which is a valid boundary
- Max 600 lines per TS file, max 250 lines per function
- Use `cclsp rename_symbol_strict` or `sd` for mass import changes

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | Logistics name helpers | Extract `buildingTypeNameSafe`, `unitTypeNameSafe` to shared file | — | `src/game/features/logistics/` |
| 2 | Snapshot config inline | Delete `buildSnapshotConfig` wrapper in both files; inline the object literal | — | `src/composables/useLogisticsDebug.ts`, `src/game/cli/commands/economy.ts` |
| 3 | PNG encoding helpers | Export CRC32/chunk helpers from `png-encoder.ts`, remove inline copy from cli | — | `src/resources/gfx/exporter/png-encoder.ts`, `scripts/gfx-export/cli.ts` |

## Shared Contracts

```typescript
// src/game/features/logistics/logistics-helpers.ts (NEW)
// Param type matches Entity.subType (number | string) — these are debug formatters
// that must handle arbitrary subType values, not just valid enum members
export function buildingTypeNameSafe(subType: number | string): string;
export function unitTypeNameSafe(subType: number | string): string;

// src/resources/gfx/exporter/png-encoder.ts (ADD exports)
export function crc32(data: Uint8Array, start?: number, length?: number): number;
export function writeUint32BE(arr: Uint8Array, value: number, offset: number): void;
export function createPngChunk(type: string, data: Uint8Array): Uint8Array;
```

## Subsystem Details

### 1 — Logistics Name Helpers
**Files**: new `src/game/features/logistics/logistics-helpers.ts`
**Key decisions**:
- Create a small helpers file rather than exporting from one of the existing modules, since neither `bottleneck-detection.ts` nor `logistics-snapshot.ts` is a natural "owner" of generic name formatting
- Use the wider param type `number | string` from bottleneck-detection (superset)
- Also move `entityLabel` here — it's only in bottleneck-detection but logically belongs with the name helpers

### 2 — Snapshot Config Inline
**Files**: `src/composables/useLogisticsDebug.ts`, `src/game/cli/commands/economy.ts`
**Key decisions**:
- Delete the `buildSnapshotConfig` function from both files — it's trivial `{ field: source.field }` glue that's clearer inline than hidden behind a function
- Each call site constructs the `SnapshotConfig` literal directly where it's used (one already has `game`, the other has `ctx.game` — no adapter needed)
- No shared extraction: each site writes its own 8-field object literal. This is 3 duplicate lines of field assignments, which is better than a premature abstraction

### 3 — PNG Encoding Helpers
**Files**: `src/resources/gfx/exporter/png-encoder.ts`, `scripts/gfx-export/cli.ts`
**Key decisions**:
- Export `crc32`, `writeUint32BE`, `createPngChunk` from `png-encoder.ts` (they're currently private)
- Keep `CRC32_TABLE` and `initCRC32Table` as module-private — only `crc32` needs to be exported
- In `cli.ts`: delete the inlined CRC32 table, `initCRC32Table`, `crc32`, `writeUint32BE`, `createPngChunk` (~40 lines). Import from `png-encoder.ts`
- Keep `cli.ts`'s own `encodePng` (async, uses Node.js `zlib.deflate`) — it's intentionally different from `png-encoder.ts`'s `encodePNGSync` (sync, stored blocks fallback for browser). Only the shared primitives are deduplicated

## File Map

### New Files
| File | Subsystem | Purpose |
|------|-----------|---------|
| `src/game/features/logistics/logistics-helpers.ts` | 1 | `buildingTypeNameSafe`, `unitTypeNameSafe`, `entityLabel` |

### Modified Files
| File | Change |
|------|--------|
| `src/game/features/logistics/bottleneck-detection.ts` | Remove `buildingTypeNameSafe`, `unitTypeNameSafe`, `entityLabel`; import from `logistics-helpers.ts` |
| `src/game/features/logistics/logistics-snapshot.ts` | Remove `buildingTypeNameSafe`, `unitTypeNameSafe`; import from `logistics-helpers.ts` |
| `src/composables/useLogisticsDebug.ts` | Delete `buildSnapshotConfig` function; inline the object literal at the call site |
| `src/game/cli/commands/economy.ts` | Delete `buildSnapshotConfig` function; inline the object literal at the call site |
| `src/resources/gfx/exporter/png-encoder.ts` | Add `export` to `crc32`, `writeUint32BE`, `createPngChunk` |
| `scripts/gfx-export/cli.ts` | Delete inlined CRC32 table + `crc32` + `writeUint32BE` + `createPngChunk` (~40 lines); import from `png-encoder.ts` |

## Verification
- `pnpm lint` passes (type-check + ESLint)
- `pnpm test:unit` passes — logistics snapshot and bottleneck tests still work
- `scripts/gfx-export/cli.ts` still produces valid PNG output (CRC32 + chunk encoding unchanged)
- No remaining duplicates: `grep -r 'buildingTypeNameSafe\|unitTypeNameSafe\|initCRC32Table'` shows each function defined exactly once
- No `buildSnapshotConfig` function exists anywhere — only inline object literals
