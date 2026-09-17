/**
 * File: routes/auth.callback.tsx
 * Author: yuntongsoft
 * Date: 2026/08/23
 * Purpose: OAuth callback — handles post-installation shop registration
 *
 * Delegates to the shared registerShop() utility to avoid duplication
 * with auth.$.tsx.
 *
 * Dependencies: shopify.server, shop-registration, logger
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { registerShop } from "~/utils/shop-registration";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "auth.callback" });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  logger.info({ shop: session.shop, sessionId: session.id }, "Shop authenticated via callback");

  // Register or update shop record (shared logic with auth.$.tsx)
  await registerShop(session.shop, session.accessToken || "", session.scope || "");

  return redirect("/app");
};
