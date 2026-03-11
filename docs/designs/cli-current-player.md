# CLI Current Player — Design

## Overview

Add a persistent "current player" to the CLI session so commands default to it without requiring `--p N` on every invocation. Supports switching between players (for AI debugging, multi-player inspection) via a `player` command.

## Summary for Review

- **Interpretation**: The CLI needs a sticky player context that defaults to the main human player (player 0 / `game.currentPlayer`) and can be changed mid-session. All player-scoped commands (`ls`, `econ`, `build`, `spawn`, `find`, etc.) already use `ctx.player` — the change is where that value comes from.

- **Key decisions**:
  1. **CLI-level state, not game-level**: The sticky player lives in `GameCli`, not `GameCore`. Multiple CLI sessions could theoretically target different players.
  2. **Default = `game.currentPlayer`**: On startup, the CLI player mirrors the game's local player (first human player from the map). No explicit `set` needed for the common case.
  3. **`--p N` still wins**: Per-command `--p` overrides the sticky player for that one command, so existing scripts/workflows don't break.
  4. **`player` command**: `player` (show current), `player <N>` (set), `player reset` (back to game default). Simple, no sub-objects.
  5. **Show player in prompt/output**: The `player` command prints the current player index + race name so you know who you're acting as.

- **Assumptions**: No need for "all players" mode — commands that need cross-player data (like a hypothetical `overview`) can be added later as separate commands. Per-command `--p` covers ad-hoc cross-player queries.

- **Scope**: Only the CLI player context plumbing + the `player` command. No changes to game logic. No WS protocol changes (player context is resolved browser-side before command execution).

## Conventions

- Optimistic programming: trust that player index is valid, throw with context if not
- Commands return `CliResult { ok, output }`; no exceptions for expected user errors (use `fail()`)
- Short primary command names (`b`, `ls`, `e`), longer aliases
- `ctx.player` is the single source of truth for all command handlers — no changes to individual commands needed

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | CLI player state | Store + resolve current player in GameCli | — | `src/game/cli/cli.ts` |
| 2 | Player command | `player` command to get/set the sticky player | 1 | `src/game/cli/commands/queries.ts` |

This is a small, two-part change. No new files needed.

## Shared Contracts

```typescript
// Addition to GameCli (cli.ts)
class GameCli {
    /** Sticky player override. null = use game.currentPlayer */
    private playerOverride: number | null = null;

    /** Get the effective CLI player (sticky override > game default). */
    get currentPlayer(): number { ... }

    /** Set the sticky player override. null resets to game default. */
    setPlayer(player: number | null): void { ... }
}
```

The `run()` method's player resolution becomes:
```
per-command --p  >  cli.playerOverride  >  game.currentPlayer
```

## Subsystem Details

### 1. CLI Player State
**Files**: `src/game/cli/cli.ts`
**Key decisions**:
- `playerOverride: number | null` field — `null` means "use game default"
- `setPlayer()` validates the player index exists in `game.playerRaces` before accepting, throws otherwise
- Expose `currentPlayer` getter for the `player` command to read
- Update the player resolution in `run()` (line ~106): `args['p'] ?? this.playerOverride ?? game.currentPlayer`

### 2. Player Command
**Files**: `src/game/cli/commands/queries.ts`
**Key decisions**:
- Name: `player`, aliases: `['p']` — NOTE: this shadows the `--p` flag name but they're different namespaces (command name vs flag). The flag `--p` still works as before.
- Actually, `p` as alias may conflict. Use `pl` as short alias instead to avoid confusion.
- Three forms:
  - `player` → show current player index, race, and whether it's the game default or an override
  - `player <N>` → set sticky player to N (validate exists)
  - `player reset` → clear override, back to game default
- Needs access to `GameCli.setPlayer()` and `GameCli.currentPlayer` — pass cli ref like `helpCommand` does
- Output example: `player=0 (Roman) [default]` or `player=2 (Mayan) [override]`

## File Map

### Modified Files
| File | Change |
|------|--------|
| `src/game/cli/cli.ts` | Add `playerOverride` field, `currentPlayer` getter, `setPlayer()` method. Update `run()` player resolution. |
| `src/game/cli/commands/queries.ts` | Add `playerCommand()` factory. Wire it in `createQueryCommands()`. |
| `src/game/cli/index.ts` | Pass `cli` ref to `playerCommand` (already done for `helpCommand` — same pattern). |

## Verification

1. **Default behavior unchanged**: Start CLI, run `player` → shows game's default player. Run `ls` → lists that player's buildings.
2. **Sticky override**: Run `player 1`, then `ls` → lists player 1's buildings. Run `econ` → shows player 1's economy. No `--p` needed.
3. **Per-command override still works**: With sticky player=1, run `ls --p 0` → lists player 0's buildings. Next `ls` → back to player 1.
4. **Reset**: Run `player reset` → back to game default. `player` shows `[default]`.
5. **Invalid player**: Run `player 99` → error with available player indices.
