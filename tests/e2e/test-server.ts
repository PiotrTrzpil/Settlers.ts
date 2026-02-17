/**
 * Shared test server configuration.
 *
 * Single source of truth for the Playwright web server port.
 * Used by playwright.config.ts, global-setup.ts, and source-hash.ts.
 */

/** Port for the Vite dev/preview server used by Playwright tests */
export const TEST_SERVER_PORT = 4173;
