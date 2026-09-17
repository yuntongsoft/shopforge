/**
 * File: routes/auth.$.tsx
 * Author: yuntongsoft
 * Date: 2026/08/23
 * Purpose: OAuth entry point — Shopify redirects here after app installation
 *
 * How it works:
 *   1. Shopify OAuth flow redirects to /auth/login?shop=xxx
 *   2. authenticate.admin(request) handles the full OAuth handshake
 *   3. After auth, encrypted token is synced to Shop table
 *   4. Redirects to /app on success
 *
 * Dependencies: shopify.server, prisma, encryption, logger
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { registerShop } from "~/utils/shop-registration";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "auth" });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  logger.info(
    { path: url.pathname, hasCode: url.searchParams.has("code"), shop: shopParam },
    "OAuth entry route hit"
  );

  // authenticate.admin handles the full OAuth handshake automatically
  const { session } = await authenticate.admin(request);

  logger.info({ shop: session.shop }, "Shop authenticated via OAuth");

  // Register or update shop record (shared logic with auth.callback)
  await registerShop(session.shop, session.accessToken || "", session.scope || "");

  return redirect("/app");
};
