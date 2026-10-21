/**
 * Unit spawn / removal helpers for test simulations.
 * Extracted from test-simulation.ts — both go through the command pipeline, like the game.
 */

import { EntityType, UnitType, type Tile } from '@/game/entity';
import { Race } from '@/game/core/race';
import type { GameState } from '@/game/game-state';
import type { Command, CommandFailure, CommandResult, SpawnCommand, SpawnResult } from '@/game/commands';

type Execute = (cmd: Command) => CommandResult;
type ExecuteSpawn = (cmd: SpawnCommand) => SpawnResult | CommandFailure;

/** Spawn a unit at `tile` via `spawn_unit`. Throws if the command fails. */
export function spawnUnit(
    state: GameState,
    execute: ExecuteSpawn,
    tile: Tile,
    unitType: UnitType,
    player: number,
    race?: Race
): number {
    const result = execute({
        type: 'spawn_unit',
        unitType,
        x: tile.x,
        y: tile.y,
        player,
        race: race ?? state.playerRaces.get(player) ?? Race.Roman,
    });
    if (!result.success) {
        throw new Error(`Failed to spawn ${unitType} at (${tile.x}, ${tile.y}): ${result.error}`);
    }
    return result.entityId;
}

/**
 * Remove a unit via `remove_entity` — the same path combat death and scripting use
 * (GameState.removeEntity → entity:removed cleanup). Throws if it is no unit.
 */
export function killUnit(state: GameState, execute: Execute, unitId: number): void {
    const unit = state.getEntityOrThrow(unitId, 'killUnit');
    if (unit.type !== EntityType.Unit) {
        throw new Error(`killUnit: entity ${unitId} is ${EntityType[unit.type]}, not a unit`);
    }
    const result = execute({ type: 'remove_entity', entityId: unitId });
    if (!result.success) {
        throw new Error(`killUnit: failed to remove unit ${unitId}: ${result.error}`);
    }
}
