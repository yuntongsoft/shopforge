/**
 * File: routes/_index.tsx
 * Author: yuntongsoft
 * Date: 2026/08/23
 * Purpose: Root route — redirects to Shopify App install or dashboard
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import prisma from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    return redirect(`/app?shop=${encodeURIComponent(shop)}`);
  }

  // No shop param — try to resolve from DB (dev environment)
  const firstShop = await prisma.shop.findFirst({
    where: { isDeleted: false },
    select: { shopifyDomain: true },
  });

  if (firstShop) {
    return redirect(`/app?shop=${encodeURIComponent(firstShop.shopifyDomain)}`);
  }

  return new Response("ShopForge — Shopify App Starter Kit", { status: 200 });
};
