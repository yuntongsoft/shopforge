import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticatePage, authResponse } from "~/utils/shopify-auth.server";
import { apiError, apiSuccess } from "~/utils/api-response";
import { validateCsrfRequest } from "~/utils/csrf";
import { extractIdToken, verifySessionToken } from "~/utils/shopify-auth.server";
import { confirmPrivacyRequest, exportPrivacyRequest, listPrivacyRequests } from "~/services/privacy.server";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return apiSuccess(await listPrivacyRequests(auth.shop.shopifyDomain, url.searchParams.get("cursor")), undefined, headers);
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return apiError("invalid_request_id", 400, undefined, headers);
  const data = await exportPrivacyRequest(auth.shop.shopifyDomain, id);
  return new Response(JSON.stringify(data), { headers: { ...headers,
    "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="privacy-${id}.json"`,
  } });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  if (request.method !== "POST") return apiError("method_not_allowed", 405, undefined, headers);
  const token = extractIdToken(request);
  if (!token) return apiError("session_token_required", 401, undefined, headers);
  const actor = verifySessionToken(token).sub;
  let form: FormData;
  try { form = await validateCsrfRequest(request); }
  catch { return apiError("invalid_csrf_token", 403, undefined, headers); }
  const id = form.get("id");
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || form.get("reviewed") !== "true") {
    return apiError("manual_review_required", 400, undefined, headers);
  }
  const confirmed = await confirmPrivacyRequest(auth.shop.shopifyDomain, id, actor);
  return confirmed ? apiSuccess({ id, confirmed: true }, undefined, headers) : apiError("privacy_request_not_ready", 409, undefined, headers);
};
