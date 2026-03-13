/**
 * Game CLI — public barrel and factory.
 *
 * Creates a fully-wired GameCli instance with all action + query commands registered.
 */

import type { GameCore } from '@/game/game-core';
import { GameCli } from './cli';
import { createActionCommands } from './commands/actions';
import { createQueryCommands } from './commands/queries';
import { createEconomyCommands } from './commands/economy';

export { GameCli } from './cli';
export type { CliResult, CliCommand, CliContext, OutputFormatter } from './types';

/** Create a GameCli with all built-in commands registered. */
export function createCli(game: GameCore): GameCli {
    const actionCmds = createActionCommands();
    const economyCmds = createEconomyCommands();
    const cli = new GameCli(game, [...actionCmds, ...economyCmds]);
    // Query commands need cli ref for help listing and log access — add after construction
    const queryCmds = createQueryCommands(() => cli.getCommands(), cli, cli);
    for (const cmd of queryCmds) {
        cli.registerCommand(cmd);
    }
    return cli;
}
