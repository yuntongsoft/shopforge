/**
 * File: logger.server.ts
 * Purpose: Server-only re-export of the shared logger.
 *
 * This .server variant guarantees the module is never bundled into client code
 * and provides a stable mock target for tests.
 */
export { createLogger } from "~/utils/logger";
