/**
 * File: routes/auth.login.tsx
 * Author: yuntongsoft
 * Date: 2026/08/23
 * Purpose: OAuth login entry point — initiates Shopify OAuth flow
 *
 * ARCHITECTURE NOTE:
 * This route MUST be simple — just pass through to shopify.login().
 * Do NOT add DB lookups or manual Location header extraction here.
 * The SDK Response contains internal cookies/state that must be preserved.
 * Manual extraction breaks the OAuth flow and causes redirect loops.
 *
 * For embedded apps with unstable_newEmbeddedAuthStrategy:
 * - No shop param → redirect to "/" (App Bridge re-enters with proper params)
 * - With shop param → transparent SDK passthrough
 *
 * Dependencies: shopify.server, logger
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import shopify from "~/shopify.server";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "auth.login" });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  logger.info({ path: url.pathname, shop, search: url.search }, "OAuth login route hit");

  // No shop param → redirect to home.
  // App Bridge will re-enter with proper params (id_token, shop) from the admin context.
  // Do NOT do DB lookup here — it causes redirect loops in embedded apps.
  if (!shop) {
    logger.info("No shop param, redirecting to /");
    return redirect("/");
  }

  try {
    logger.info({ shop }, "Calling shopify.login()");
    // Direct passthrough — preserves SDK internal cookies/state
    const response = await shopify.login(request);
    return response as Response;
  } catch (error) {
    // SDK throws Response for redirects — let Remix handle them natively
    if (error instanceof Response) throw error;
    logger.error({ shop, error: (error as Error)?.message }, "shopify.login() threw error");
    throw error;
  }
};
