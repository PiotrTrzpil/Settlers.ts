/**
 * Command execution — thin wrapper around CommandHandlerRegistry.
 *
 * Each command handler is registered with only the dependencies it needs.
 * See handlers/ directory for individual handler implementations.
 */

export { CommandHandlerRegistry } from './handler-registry';
export { registerAllHandlers, type CommandRegistrationDeps } from './register-handlers';
