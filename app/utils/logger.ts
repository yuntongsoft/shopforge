/**
 * File: logger.ts
 * Author: yuntongsoft
 * Date: 2026/08/02
 * Purpose: Structured logging — pino on server, console on client
 *
 * Usage:
 *   import { createLogger } from "~/utils/logger";
 *   const logger = createLogger({ module: "billing" });
 *   logger.info({ shop: "example.myshopify.com" }, "Subscription activated");
 */

const isBrowser = typeof window !== "undefined";

interface LoggerInstance {
  level: string;
  child: (context: Record<string, unknown>) => LoggerInstance;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
}

function createConsoleLogger(context: Record<string, unknown>): LoggerInstance {
  const prefix = context.module ? `[${context.module}]` : "";
  const noop = () => {};
  return {
    level: "debug",
    child: (ctx: Record<string, unknown>) => createConsoleLogger({ ...context, ...ctx }),
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    debug: noop,
    trace: noop,
  };
}

// Safe env access — "process" is not defined in browser bundles
const gProcess = (typeof globalThis !== "undefined" && (globalThis as any).process) || {};
const env: Record<string, string | undefined> = gProcess.env || {};

// Initialize logger — browser gets console, server gets pino
// Queue early logs to prevent loss during async pino initialization
let baseLogger: LoggerInstance;
const earlyLogQueue: Array<{ level: string; args: unknown[] }> = [];
const noop = () => {};

if (isBrowser) {
  baseLogger = createConsoleLogger({});
} else {
  // Temporary logger that queues calls until pino is ready
  baseLogger = {
    level: "debug",
    child: (ctx: Record<string, unknown>) => createConsoleLogger({ ...ctx }),
    info: (...args: unknown[]) => earlyLogQueue.push({ level: "info", args }),
    warn: (...args: unknown[]) => earlyLogQueue.push({ level: "warn", args }),
    error: (...args: unknown[]) => earlyLogQueue.push({ level: "error", args }),
    debug: noop,
    trace: noop,
  };

  import("pino").then((pino) => {
    const realLogger = pino.default({
      level: env.LOG_LEVEL || (env.NODE_ENV === "production" ? "info" : "debug"),
      ...(env.NODE_ENV !== "production" && {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
        },
      }),
    }) as unknown as LoggerInstance;

    // Flush queued early logs to the real logger
    for (const entry of earlyLogQueue) {
      (realLogger[entry.level as keyof LoggerInstance] as (...a: unknown[]) => void)(...entry.args);
    }
    earlyLogQueue.length = 0;

    baseLogger = realLogger;
  }).catch(() => {
    // pino not available — flush queue to console fallback
    const fallback = createConsoleLogger({});
    for (const entry of earlyLogQueue) {
      (fallback[entry.level as keyof LoggerInstance] as (...a: unknown[]) => void)(...entry.args);
    }
    earlyLogQueue.length = 0;
  });
}

export const logger = baseLogger;

/**
 * Create a child logger with context (module name, traceId, shopId, etc.)
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
