/**
 * File: entry.server.tsx
 * Author: yuntongsoft
 * Date: 2026/08/02
 * Purpose: Server-side request handler — generates TraceID, sets security headers
 *
 * Dependencies: @remix-run/react, crypto
 * Used by: Remix server entry point
 */
import type { EntryContext } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { renderToString } from "react-dom/server";
import crypto from "crypto";
import { validateEnv } from "~/utils/env-validator";

// Validate env vars once at server startup (dev mode: first request triggers this)
let envValidated = false;
function ensureEnvValidated() {
  if (!envValidated) {
    validateEnv();
    envValidated = true;
  }
}

function generateTraceId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  ensureEnvValidated();

  const markup = renderToString(
    <RemixServer context={remixContext} url={request.url} />
  );

  responseHeaders.set("Content-Type", "text/html");

  const traceId = request.headers.get("X-Trace-Id") || generateTraceId();
  responseHeaders.set("X-Trace-Id", traceId);

  // Security headers
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  responseHeaders.set("Content-Security-Policy", "frame-ancestors https://admin.shopify.com https://*.myshopify.com");
  responseHeaders.set("X-XSS-Protection", "1; mode=block");
  responseHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  responseHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return new Response("<!DOCTYPE html>" + markup, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
