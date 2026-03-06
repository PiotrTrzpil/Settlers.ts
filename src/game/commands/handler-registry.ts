import type { Command, CommandResult } from './command-types';

type BoundHandler = (cmd: any) => CommandResult;

/**
 * Registry that maps command types to pre-bound handlers.
 * Dependencies are injected at registration time, not at dispatch.
 */
export class CommandHandlerRegistry {
    private handlers = new Map<string, BoundHandler>();

    register<T extends Command['type']>(type: T, handler: BoundHandler): void {
        if (this.handlers.has(type)) {
            throw new Error(`Handler already registered for command type '${type}'`);
        }
        this.handlers.set(type, handler);
    }

    execute(cmd: Command): CommandResult {
        const handler = this.handlers.get(cmd.type);
        if (!handler) {
            throw new Error(`No handler registered for command type '${cmd.type}'`);
        }
        return handler(cmd);
    }
}
