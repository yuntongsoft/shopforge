/**
 * File: routes/auth.login.tsx
 * Author: yuntongsoft
 * Date: 2026/08/23
 * Purpose: OAuth login entry point — initiates Shopify OAuth flow
 *
 * Shopify redirects here when authentication is needed.
 * This route MUST call shopify.login() (not authenticate.admin())
 * because the SDK throws if authenticate.admin() is called from the login path.
 *
 * Dependencies: shopify.server, logger
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import shopify from "~/shopify.server";
import prisma from "~/db.server";
import { bounceRedirect, bounceToShopifyUrl } from "~/utils/shopify-auth.server";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "auth.login" });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  logger.info({ path: url.pathname, shop, search: url.search }, "OAuth login route hit");

  // No shop param — try to resolve from DB (dev environment)
  if (!shop) {
    const firstShop = await prisma.shop.findFirst({
      where: { isDeleted: false },
      select: { shopifyDomain: true },
    });

    if (firstShop) {
      logger.info({ resolvedShop: firstShop.shopifyDomain }, "No shop param, resolved from DB");
      // Use bounceRedirect to escape iframe — 302 gets blocked by X-Frame-Options
      return bounceRedirect(`/auth/login?shop=${firstShop.shopifyDomain}`);
    }

    // No shops in DB — redirect to root
    logger.warn({}, "No shop param and no shops in DB, redirecting to /");
    return redirect("/");
  }

  try {
    const response = await shopify.login(request);

    const hasStatus = "status" in response;
    const hasHeaders = "headers" in response;

    if (hasStatus && hasHeaders) {
      // shopify.login() returns a 302 redirect — use bounceRedirect to escape iframe
      const loginResponse = response as Response;
      const location = loginResponse.headers.get("Location");
      if (location) {
        logger.info({ shop, redirectUrl: location }, "Bouncing to Shopify OAuth");
        return bounceToShopifyUrl(location);
      }
      return loginResponse;
    } else {
      logger.error({ shop, errorBody: JSON.stringify(response) }, "shopify.login() returned LoginError");
      return redirect("/");
    }
  } catch (error) {
    if (error instanceof Response) {
      // SDK throws Response for OAuth redirects — bounce to escape iframe
      const location = error.headers.get("Location");
      if (location) {
        logger.info({ shop, redirectUrl: location }, "Bouncing SDK redirect to top window");
        return bounceToShopifyUrl(location);
      }
      throw error;
    }
    logger.error({ shop, error: (error as Error)?.message }, "shopify.login() threw error");
    throw error;
  }
};
