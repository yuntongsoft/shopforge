/**
 * File: utils/errors.ts
 * Author: yuntongsoft
 * Date: 2026/08/01
 * Purpose: Centralized error handling utilities.
 *
 * Provides type-safe error message extraction to replace the repetitive
 * `(error as Error).message` pattern scattered across the codebase.
 *
 * Usage:
 *   import { getErrorMessage } from "~/utils/errors";
 *   catch (error) {
 *     logger.error({ error: getErrorMessage(error) }, "Something failed");
 *   }
 */

/**
 * Extract a human-readable error message from an unknown caught value.
 *
 * Handles: Error instances, string throws, and arbitrary objects.
 * Always returns a non-empty string.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
